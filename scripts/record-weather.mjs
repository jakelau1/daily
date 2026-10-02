// Runs inside the GitHub Action (Node 20). Uses only official Hong Kong government feeds.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(process.env.WEATHER_DIR || '.', 'data');
const HKO = 'https://data.weather.gov.hk/weatherAPI/opendata';
const KEEP_HOURS = 36;
// Every forecast point the page might ask for (HKO station codes).
const OCF_CODES = ['HPV','HKP','HKO','SKW','HKS','STY','KP','KLT','SE1','KTG','SSP','WTS','SHA','TPO','YCT','PLC',
  'JKB','SKG','TWN','TW','TY1','TU1','YLP','LFS','SEK','TKL','HKA','CCH'];

async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.text();
}
const json = async url => { const t = (await text(url)).trim(); return t ? JSON.parse(t) : null; };
// A missing file just means "start fresh". A file that exists but can't be read is kept as a
// backup (e.g. data/history.damaged-2026-09-29T02-31-00Z.json) and flagged with a warning
// that shows on the run's page in the Actions tab, instead of being silently replaced.
async function readJSON(file, fallback) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return fallback; }
  try { return JSON.parse(text); } catch (e) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = file.replace(/\.json$/, `.damaged-${stamp}.json`);
    await copyFile(file, backup);
    console.log(`::warning file=${file}::${file} could not be read (${e.message}). Kept a copy as ${backup} and started this file again from empty.`);
    return fallback;
  }
}
async function writeIfChanged(file, obj) {
  const s = JSON.stringify(obj);
  let old = null; try { old = await readFile(file, 'utf8'); } catch {}
  if (old !== s) { await writeFile(file, s); console.log('Updated', file); }
}

await mkdir(DIR, { recursive: true });

// 1) Observation history: hourly temperatures (all stations) and rain-gauge totals.
const histFile = path.join(DIR, 'history.json');
const hist = await readJSON(histFile, { temps: [], gauges: [] });
hist.temps ||= []; hist.gauges ||= [];
try {
  const rhr = await json(`${HKO}/weather.php?dataType=rhrread&lang=en`);
  const t = rhr?.temperature?.recordTime;
  if (t && !hist.temps.some(e => e.t === t)) {
    const v = {};
    for (const d of rhr.temperature.data || []) if (typeof d.value === 'number') v[d.place] = d.value;
    hist.temps.push({ t, v });
  }
} catch (e) { console.error('Current weather report:', e.message); }
try {
  const hr = await json(`${HKO}/hourlyRainfall.php?lang=en`);
  const t = hr?.obsTime;
  if (t && !hist.gauges.some(e => e.t === t)) {
    const v = {};
    for (const d of hr.hourlyRainfall || []) v[d.automaticWeatherStation] = d.value;
    hist.gauges.push({ t, v });
  }
} catch (e) { console.error('Hourly rainfall:', e.message); }
const cutoff = Date.now() - KEEP_HOURS * 3600e3;
const tidy = a => a.filter(e => Date.parse(e.t) >= cutoff).sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
hist.temps = tidy(hist.temps); hist.gauges = tidy(hist.gauges);
await writeIfChanged(histFile, hist);

// 2) Backup copy of the hourly computer forecast (the Observatory updates it about every 2 hours).
//    The recorder runs every 10 minutes, so first check one point and skip the rest if nothing is new.
const ocfFile = path.join(DIR, 'ocf.json');
const ocf = await readJSON(ocfFile, { stations: {} });
let ocfNew = true;
try {
  const probe = await json('https://maps.weather.gov.hk/ocf/dat/HKO.xml');
  ocfNew = !probe || !ocf.stations.HKO || String(probe.LastModified) !== String(ocf.stations.HKO.LastModified);
} catch (e) { /* fetch them all below */ }
if (!ocfNew) console.log('Hourly forecast unchanged since the last run.');
for (const code of ocfNew ? OCF_CODES : []) {
  try {
    const j = await json(`https://maps.weather.gov.hk/ocf/dat/${code}.xml`);
    if (!j || !Array.isArray(j.HourlyWeatherForecast)) continue;
    ocf.stations[code] = {
      LastModified: j.LastModified, ModelTime: j.ModelTime,
      DailyForecast: (j.DailyForecast || []).slice(0, 3),
      HourlyWeatherForecast: j.HourlyWeatherForecast.slice(0, 72)
    };
  } catch (e) { /* this code isn't a forecast point; skip */ }
}
await writeIfChanged(ocfFile, ocf);

// 3) Rain nowcast for the next 2 hours at one central grid point (a rough fallback copy for the "now" display; the Android app reads the file itself).
//    The Observatory's file covers the whole region (about 2.7 MB); only four numbers are kept.
const NOWCAST_AT = { lat: 22.3019, lon: 114.1742 };  // the Observatory's headquarters
try {
  const rows = (await text('https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv')).trim().split(/\r?\n/).slice(1)
    .map(l => l.split(',')).filter(r => r.length >= 5);
  let best = null, bestD = Infinity;
  for (const r of rows) {
    const d = (+r[2] - NOWCAST_AT.lat) ** 2 + (+r[3] - NOWCAST_AT.lon) ** 2;
    if (d < bestD) { bestD = d; best = r; }
  }
  if (!best) throw new Error('no rows');
  const iso = t => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00+08:00`;
  const mine = rows.filter(r => r[2] === best[2] && r[3] === best[3]);
  await writeIfChanged(path.join(DIR, 'nowcast.json'), {
    updated: iso(best[0]), lat: +best[2], lon: +best[3],
    periods: mine.map(r => ({ end: iso(r[1]), mm: +r[4] })).sort((a, b) => a.end.localeCompare(b.end))
  });
} catch (e) { console.error('Rain nowcast:', e.message); }

// 4) Backup copy of the air-quality feeds.
try {
  const ind = await text('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_Eng.xml');
  const range = await text('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhirss_Eng.xml');
  await writeIfChanged(path.join(DIR, 'aqhi.json'), { ind, range });
} catch (e) { console.error('AQHI:', e.message); }
