// Weather relay for the "now" display, run on Cloudflare Workers (free plan).
// The Observatory's rain nowcast and hourly forecast and the EPD's air-quality feeds don't let other sites' pages
// read them (no CORS permission), and GitHub's scheduled recorder runs hours late, so the display asks this relay
// instead. It fetches the official files when asked, keeps them for a few minutes, and answers in the same shapes
// as the recorder's copies in weather/data/:
//   GET /ocf?points=HKO,HKP   {"stations": {"HKO": {...}, "HKP": {...}}}        hourly forecast (as ocf.json)
//   GET /aqhi     {"ind": "<rss…>", "range": "<rss…>"}                      air quality (as aqhi.json)
//   GET /nowcast?at=22.302,114.174   {"updated", "lat", "lon", "periods": [{"end", "mm"}]}   2-hour rain nowcast (as nowcast.json)
// The places are chosen by the page in each request (up to 6 forecast points; one latitude and longitude, used to pick the nearest
// grid point). Nothing about any place is written into this program: with no choice given it answers for the Observatory.
// Only the official addresses below are ever fetched, and only pages on ALLOWED_ORIGINS get an answer.
// Nothing is stored except Cloudflare's short-lived cache; no schedule data ever passes through here.

const DEFAULT_ORIGINS = 'https://jakelau1.github.io';
const DEFAULT_POINTS = ['HKO'];                          // forecast point when the page names none: the Observatory
const DEFAULT_AT = { lat: 22.302, lon: 114.174 };       // rain grid point when the page names none: the Observatory
const MAX_POINTS = 6;
const KEEP = { ocf: 600, aqhi: 300, nowcast: 180 };     // seconds an answer is reused

// What the page asked for, checked: forecast point codes (2 to 4 capital letters or digits) and a position inside Hong Kong.
// Returns null if a choice is malformed (the page gets a 400), else the normalised choice, which is also part of the cache key.
function choice(key, params) {
  if (key === 'ocf') {
    const raw = params.get('points');
    if (raw === null) return { points: DEFAULT_POINTS };
    const points = [...new Set(raw.split(',').map(x => x.trim().toUpperCase()))];
    return points.length && points.length <= MAX_POINTS && points.every(c => /^[A-Z0-9]{2,4}$/.test(c)) ? { points } : null;
  }
  if (key === 'nowcast') {
    const raw = params.get('at');
    if (raw === null) return { at: DEFAULT_AT };
    const m = /^(\d{1,2}(?:\.\d{1,4})?),(\d{2,3}(?:\.\d{1,4})?)$/.exec(raw.trim());
    if (!m) return null;
    const lat = Math.round(+m[1] * 1000) / 1000, lon = Math.round(+m[2] * 1000) / 1000;
    return lat >= 22.1 && lat <= 22.6 && lon >= 113.8 && lon <= 114.5 ? { at: { lat, lon } } : null;
  }
  return {};
}
const cacheName = (key, c) => key + (c.points ? '?points=' + c.points.join(',') : c.at ? '?at=' + c.at.lat + ',' + c.at.lon : '');

const SOURCES = {
  ocf: async c => {
    const stations = {};
    await Promise.all(c.points.map(async code => {
      const j = JSON.parse(await upstream(`https://maps.weather.gov.hk/ocf/dat/${code}.xml`));
      stations[code] = {
        LastModified: j.LastModified, ModelTime: j.ModelTime,
        DailyForecast: (j.DailyForecast || []).slice(0, 3),
        HourlyWeatherForecast: (j.HourlyWeatherForecast || []).slice(0, 72)
      };
    }));
    return { stations };
  },
  aqhi: async () => {
    const [ind, range] = await Promise.all([
      upstream('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_Eng.xml'),
      upstream('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhirss_Eng.xml')]);
    return { ind, range };
  },
  // The file covers the whole region (about 2.7 MB); only the rows for the grid point nearest the chosen position are kept.
  nowcast: async c => {
    const text = await upstream('https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv');
    const all = text.trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(r => r.length >= 5);
    let best = null, bestD = Infinity;
    for (const r of all) {
      const d = (+r[2] - c.at.lat) ** 2 + (+r[3] - c.at.lon) ** 2;
      if (d < bestD) { bestD = d; best = r; }
    }
    if (!best) throw new Error('no grid point found in the nowcast');
    const rows = all.filter(r => r[2] === best[2] && r[3] === best[3]);
    const iso = t => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00+08:00`;
    return {
      updated: iso(rows[0][0]), lat: +rows[0][2], lon: +rows[0][3],
      periods: rows.map(r => ({ end: iso(r[1]), mm: +r[4] })).sort((a, b) => a.end.localeCompare(b.end))
    };
  }
};

async function upstream(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'daily-now-relay (personal display; github.com/jakelau1/daily)' } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.text();
}

function reply(body, status, origin, maxAge) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'vary': 'Origin',
      'cache-control': `public, max-age=${maxAge}`,
      'x-content-type-options': 'nosniff'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const origins = (env && env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(/\s*,\s*/);
    const origin = request.headers.get('origin') || '';
    const key = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
    if (request.method !== 'GET') return new Response('Only GET', { status: 405 });
    if (!origins.includes(origin)) return new Response('Not for this site', { status: 403 });
    if (!SOURCES[key]) return reply({ error: 'unknown address' }, 404, origin, 0);
    const chosen = choice(key, new URL(request.url).searchParams);
    if (!chosen) return reply({ error: 'bad choice of place' }, 400, origin, 0);

    // Reuse a recent answer (Cloudflare's cache, per data centre), so the official servers are asked at most every
    // few minutes however often the display asks.
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(`https://relay.cache/${cacheName(key, chosen)}`);
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return reply(await hit.text(), 200, origin, KEEP[key]);
    }
    try {
      const body = JSON.stringify(await SOURCES[key](chosen));
      if (cache) ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'cache-control': `public, max-age=${KEEP[key]}` } })));
      return reply(body, 200, origin, KEEP[key]);
    } catch (e) {
      return reply({ error: String(e.message || e) }, 502, origin, 0);
    }
  }
};
