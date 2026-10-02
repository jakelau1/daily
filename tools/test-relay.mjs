// Tests the relay program (relay/worker.js) directly, with fake government servers and a fake cache: no network, no Cloudflare.
//   node tools/test-relay.mjs
// Checks: only the allowed site gets answers; the page's choice of places is read, checked and used (forecast points; the rain grid
// point nearest a position); answers for different places are cached separately; bad choices are refused; with no choice the answer
// is for the Observatory; the program text holds none of the private sensitive terms.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../relay/worker.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0, failures = 0;
const check = (ok, msg) => { checks++; if (!ok) { failures++; console.log('  FAIL ' + msg); } };

// ---- fakes ----
const asked = [];
const GRID = [[22.302, 114.174], [22.285, 114.191], [22.35, 114.2]];            // three grid points of a fake rain file
const csv = ['header'].concat(GRID.flatMap(([la, lo]) => [1, 2, 3, 4].map(i => `20261001120000,2026100112${i}000,${la},${lo},${(la * 10 % 3) + i}`))).join('\n');
globalThis.fetch = async (url) => {
  asked.push(String(url));
  if (/ocf\/dat\/(\w+)\.xml/.test(url)) {
    const code = /dat\/(\w+)\.xml/.exec(url)[1];
    if (code === 'ZZZZ') return new Response('no', { status: 404 });
    return new Response(JSON.stringify({ LastModified: '20261001120000', ModelTime: 'x', DailyForecast: [{}, {}, {}, {}], HourlyWeatherForecast: new Array(100).fill({}) , code }), { status: 200 });
  }
  if (/aqhi/.test(url)) return new Response('<rss/>', { status: 200 });
  if (/Gridded_rainfall_nowcast/.test(url)) return new Response(csv, { status: 200 });
  return new Response('?', { status: 500 });
};
const store = new Map();
globalThis.caches = { default: {
  match: async req => { const h = store.get(req.url); return h ? new Response(h) : undefined; },
  put: async (req, res) => { store.set(req.url, await res.text()); }
} };
const pending = [];
const ctx = { waitUntil: p => { pending.push(p); } };      // Cloudflare finishes background work after replying; the test waits for it
const ORIGIN = 'https://jakelau1.github.io';
const ask = async (pathAndQuery, origin = ORIGIN, method = 'GET') => {
  const res = await worker.fetch(new Request('https://relay.example' + pathAndQuery, { method, headers: origin ? { origin } : {} }), {}, ctx);
  await Promise.all(pending.splice(0));
  return res;
};
const json = async r => JSON.parse(await r.text());

console.log('Who may ask');
check((await ask('/ocf', 'https://other.example')).status === 403, 'another site must be refused');
check((await ask('/ocf', '')).status === 403, 'a request with no origin must be refused');
check((await ask('/ocf', ORIGIN, 'POST')).status === 405, 'only GET is allowed');
check((await ask('/nothing')).status === 404, 'unknown address must be 404');

console.log('Forecast points');
store.clear(); asked.length = 0;
let r = await ask('/ocf');
check(r.status === 200 && Object.keys((await json(r)).stations).join() === 'HKO', 'with no choice the answer is for the Observatory only');
store.clear(); asked.length = 0;
r = await ask('/ocf?points=hkp,HKO,hkp');
let j = await json(r);
check(r.status === 200 && Object.keys(j.stations).sort().join() === 'HKO,HKP', `two named points (repeats and lower case tidied): ${Object.keys(j.stations)}`);
check(j.stations.HKO.DailyForecast.length === 3 && j.stations.HKO.HourlyWeatherForecast.length === 72, 'answers are trimmed to 3 days and 72 hours');
check(asked.length === 2 && asked.every(u => /^https:\/\/maps\.weather\.gov\.hk\/ocf\/dat\/[A-Z0-9]+\.xml$/.test(u)), `only the Observatory's forecast files may be fetched: ${asked.join(' ')}`);
for (const bad of ['?points=', '?points=../x', '?points=A', '?points=ABCDE', '?points=A1,B2,C3,D4,E5,F6,G7', '?points=HKO%2F..', '?points=HKO;x']) {
  const rr = await ask('/ocf' + bad);
  check(rr.status === 400, `${bad} should be refused (400), got ${rr.status}`);
}
store.clear(); asked.length = 0;
await ask('/ocf?points=HKP'); await ask('/ocf?points=HKP'); await ask('/ocf?points=HKO');
check(asked.length === 2, `different places are cached separately and the same place once: ${asked.length} upstream requests (expected 2)`);

console.log('Rain grid point');
store.clear();
r = await ask('/nowcast');
j = await json(r);
check(r.status === 200 && j.lat === 22.302 && j.lon === 114.174 && j.periods.length === 4, `no choice: nearest to the Observatory (${j.lat}, ${j.lon}, ${j.periods && j.periods.length} periods)`);
r = await ask('/nowcast?at=22.28,114.19'); j = await json(r);
check(j.lat === 22.285 && j.lon === 114.191, `nearest grid point to a position: ${j.lat}, ${j.lon}`);
r = await ask('/nowcast?at=22.34,114.21'); j = await json(r);
check(j.lat === 22.35 && j.lon === 114.2, `another position picks another point: ${j.lat}, ${j.lon}`);
check(Number.isFinite(j.periods[0].mm) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\+08:00$/.test(j.periods[0].end), 'periods have a time and an amount');
for (const bad of ['?at=', '?at=1,2', '?at=22.3', '?at=22.3,114.2,5', '?at=abc,def', '?at=40,114', '?at=22.3,200', '?at=22.3;114.2']) {
  const rr = await ask('/nowcast' + bad);
  check(rr.status === 400, `${bad} should be refused (400), got ${rr.status}`);
}
store.clear(); asked.length = 0;
await ask('/nowcast?at=22.285,114.191'); await ask('/nowcast?at=22.2850,114.1910'); await ask('/nowcast?at=22.35,114.2');
check(asked.length === 2, `positions are cached by their rounded value: ${asked.length} downloads (expected 2)`);

console.log('Air quality and errors');
r = await ask('/aqhi'); check(r.status === 200 && 'ind' in (await json(r)), 'air quality still answers');
r = await ask('/ocf?points=ZZZZ'); check(r.status === 502, `an unknown forecast point gives a 502 (upstream 404), got ${r.status}`);

console.log('No private terms in the program');
let terms = [];
try { terms = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'config.json'), 'utf8')).sensitiveTerms || []; } catch { console.log('      (no private term list here: skipped)'); }
const text = fs.readFileSync(path.join(ROOT, 'relay', 'worker.js'), 'utf8').toLowerCase();
const leaked = terms.filter(t => text.includes(String(t).toLowerCase()));
check(leaked.length === 0, `relay/worker.js contains ${leaked.length} private term(s)`);

console.log(`\n${checks} checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
