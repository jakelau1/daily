// Weather relay for the "now" display, run on Cloudflare Workers (free plan).
// The Observatory's rain nowcast and hourly forecast and the EPD's air-quality feeds don't let other sites' pages
// read them (no CORS permission), and GitHub's scheduled recorder runs hours late, so the display asks this relay
// instead. It fetches the official files when asked, keeps them for a few minutes, and answers in the same shapes
// as the recorder's copies in weather/data/:
//   GET /ocf      {"stations": {"HPV": {...}, "HKP": {...}, "HKO": {...}}}   hourly forecast (as ocf.json)
//   GET /aqhi     {"ind": "<rss…>", "range": "<rss…>"}                      air quality (as aqhi.json)
//   GET /nowcast  {"updated", "lat", "lon", "periods": [{"end", "mm"}]}      2-hour rain nowcast (as nowcast.json)
// Only the official addresses below are ever fetched, and only pages on ALLOWED_ORIGINS get an answer.
// Nothing is stored except Cloudflare's short-lived cache; no schedule data ever passes through here.

const DEFAULT_ORIGINS = 'https://jakelau1.github.io';
const OCF_POINTS = ['HPV', 'HKP', 'HKO'];              // Happy Valley, Hong Kong Park, Observatory (as the Weather page)
const NOWCAST_POINT = ',22.268,114.182,';               // grid point nearest the Happy Valley weather station
const KEEP = { ocf: 600, aqhi: 300, nowcast: 180 };     // seconds an answer is reused

const SOURCES = {
  ocf: async () => {
    const stations = {};
    await Promise.all(OCF_POINTS.map(async code => {
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
  // The file covers the whole region (about 2.7 MB); only the four rows for one grid point are kept.
  nowcast: async () => {
    const text = await upstream('https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv');
    const rows = [];
    for (let i = text.indexOf(NOWCAST_POINT); i !== -1; i = text.indexOf(NOWCAST_POINT, i + 1)) {
      const start = text.lastIndexOf('\n', i) + 1, end = text.indexOf('\n', i);
      rows.push(text.slice(start, end === -1 ? undefined : end).trim().split(','));
    }
    if (!rows.length) throw new Error('grid point not found in the nowcast');
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

    // Reuse a recent answer (Cloudflare's cache, per data centre), so the official servers are asked at most every
    // few minutes however often the display asks.
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(`https://relay.cache/${key}`);
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return reply(await hit.text(), 200, origin, KEEP[key]);
    }
    try {
      const body = JSON.stringify(await SOURCES[key]());
      if (cache) ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'cache-control': `public, max-age=${KEEP[key]}` } })));
      return reply(body, 200, origin, KEEP[key]);
    } catch (e) {
      return reply({ error: String(e.message || e) }, 502, origin, 0);
    }
  }
};
