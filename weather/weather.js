(() => {
'use strict';
/* Ported from the standalone weather page. Changes for the combined site: no theme menu (the site is one theme), state blocks from HK.state,
   class names that no longer clash with site.css, and no inline style="" (the site CSP blocks it): dynamic sizes go in data-sty and are applied here. */
const stLoad = t => HK.state('loading', {title: t || 'Loading…', compact: true});
const stErr = (t, b) => HK.state('error', {title: t, body: b, compact: true});
const stEmpty = (t, b) => HK.state('empty', {title: t, body: b, compact: true});
const paintSty = n => {
  if (n.nodeType !== 1) return;
  [n, ...n.querySelectorAll('[data-sty]')].filter(e => e.hasAttribute('data-sty')).forEach(e => {
    e.getAttribute('data-sty').split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0) e.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); });
    e.removeAttribute('data-sty');
  });
};
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(paintSty))).observe(document.body, {childList: true, subtree: true});

/* =========================================================================
   CONFIGURATION
   ========================================================================= */
const API = 'https://data.weather.gov.hk/weatherAPI';
const TZ = 'Asia/Hong_Kong';
const REFRESH_MS = 5 * 60 * 1000;          // refresh every 5 minutes while visible
const STORE_KEY = 'hkwx.region';
const CACHE_KEY = 'hkwx.cache.v1';

/* Each location is keyed to an HKO temperature station (names confirmed from the
   live Current Weather Report). The other fields are the nearest matching stations
   in other datasets; they are matched by name against live data, and the app always
   labels which station a number came from. If no name matches, it says so. */
const R = (id, name, area, district, o = {}) => ({
  id, name, area, district,
  temp: o.temp || name,
  gauge: o.gauge || [name],
  wind: o.wind || [name],
  hum: o.hum || [name],
  vis: o.vis || ['Central'],
  tide: o.tide || 'QUB'
});
const REGIONS = [
  R('happy-valley','Happy Valley','Hong Kong Island','Wan Chai',{wind:['Happy Valley','North Point','Central Pier'],hum:['Happy Valley','Hong Kong Park']}),
  R('hong-kong-park','Hong Kong Park','Hong Kong Island','Central & Western District',{gauge:['The Peak','Happy Valley'],wind:['Central Pier','Star Ferry']}),
  R('shau-kei-wan','Shau Kei Wan','Hong Kong Island','Eastern District',{wind:['Shau Kei Wan','North Point'],vis:['Sai Wan Ho']}),
  R('stanley','Stanley','Hong Kong Island','Southern District',{wind:['Stanley','Hong Kong Sea School','Waglan Island'],vis:['Waglan Island']}),
  R('wong-chuk-hang','Wong Chuk Hang','Hong Kong Island','Southern District',{wind:['Wong Chuk Hang','Stanley']}),
  R('hko','Hong Kong Observatory','Kowloon','Yau Tsim Mong',{wind:['Star Ferry',"King's Park"]}),
  R('kai-tak','Kai Tak Runway Park','Kowloon','Kowloon City',{gauge:['Kai Tak'],wind:['Kai Tak'],hum:['Kai Tak Runway Park','Kai Tak']}),
  R('kings-park',"King's Park",'Kowloon','Yau Tsim Mong',{wind:["King's Park",'Star Ferry']}),
  R('kowloon-city','Kowloon City','Kowloon','Kowloon City',{gauge:["King's Park",'Hong Kong Observatory'],wind:['Kai Tak']}),
  R('kwun-tong','Kwun Tong','Kowloon','Kwun Tong',{wind:['Kwun Tong','Kai Tak']}),
  R('sham-shui-po','Sham Shui Po','Kowloon','Sham Shui Po',{wind:['Sham Shui Po',"King's Park"]}),
  R('wong-tai-sin','Wong Tai Sin','Kowloon','Wong Tai Sin',{gauge:['Kwun Tong','Kai Tak'],wind:['Wong Tai Sin','Kai Tak']}),
  R('lau-fau-shan','Lau Fau Shan','New Territories','Yuen Long',{vis:['Chek Lap Kok'],tide:'TBT'}),
  R('sai-kung','Sai Kung','New Territories','Sai Kung',{vis:['Waglan Island'],tide:'TMW'}),
  R('sha-tin','Sha Tin','New Territories','Sha Tin',{tide:'TPK'}),
  R('shek-kong','Shek Kong','New Territories','Yuen Long',{vis:['Chek Lap Kok'],tide:'TBT'}),
  R('ta-kwu-ling','Ta Kwu Ling','New Territories','North District',{tide:'TBT'}),
  R('tai-mei-tuk','Tai Mei Tuk','New Territories','Tai Po',{tide:'TPK'}),
  R('tai-po','Tai Po','New Territories','Tai Po',{gauge:['Tai Po','Tai Po Market'],wind:['Tai Po Kau','Tai Po'],tide:'TPK'}),
  R('tseung-kwan-o','Tseung Kwan O','New Territories','Sai Kung',{vis:['Sai Wan Ho'],tide:'TMW'}),
  R('tsing-yi','Tsing Yi','New Territories','Kwai Tsing',{gauge:['Sham Shui Po','Tsuen Wan Ho Koon'],tide:'KCT'}),
  R('ho-koon','Tsuen Wan Ho Koon','New Territories','Tsuen Wan',{wind:['Tsuen Wan Ho Koon','Tsuen Wan'],tide:'KCT'}),
  R('shing-mun','Tsuen Wan Shing Mun Valley','New Territories','Tsuen Wan',{gauge:['Tsuen Wan Shing Mun Valley','Tsuen Wan Ho Koon'],wind:['Tsuen Wan','Tsing Yi'],tide:'KCT'}),
  R('tuen-mun','Tuen Mun','New Territories','Tuen Mun',{vis:['Chek Lap Kok'],tide:'LOP'}),
  R('yuen-long','Yuen Long Park','New Territories','Yuen Long',{gauge:['Yuen Long Park','Wetland Park','Lau Fau Shan'],wind:['Wetland Park','Lau Fau Shan'],vis:['Chek Lap Kok'],tide:'TBT'}),
  R('chek-lap-kok','Chek Lap Kok','Islands','Islands District',{gauge:['Hong Kong International Airport','Chek Lap Kok'],vis:['Chek Lap Kok'],tide:'CLK'}),
  R('cheung-chau','Cheung Chau','Islands','Islands District',{vis:['Chek Lap Kok'],tide:'CCH'})
];
const AREAS = ['Hong Kong Island','Kowloon','New Territories','Islands'];

/* Hourly computer-forecast points (HKO station codes) and air-quality stations for each place.
   The first forecast code that exists is used; the page always says which one.
   Air quality: [general station, roadside station if one is close]. */
const EXTRA = {
  'happy-valley':  {ocf:['HPV','HKP','HKO'], aq:['Eastern','Causeway Bay']},
  'hong-kong-park':{ocf:['HKP','HKO'], aq:['Central/Western','Central']},
  'shau-kei-wan':  {ocf:['SKW','HKO'], aq:['Eastern']},
  'wong-chuk-hang':{ocf:['HKS','HKO'], aq:['Southern']},
  'stanley':       {ocf:['STY','HKS','HKO'], aq:['Southern']},
  'hko':           {ocf:['HKO'], aq:['Sham Shui Po','Mong Kok']},
  'kings-park':    {ocf:['KP','HKO'], aq:['Sham Shui Po','Mong Kok']},
  'kowloon-city':  {ocf:['KLT','HKO'], aq:['Kwun Tong']},
  'kai-tak':       {ocf:['SE1','KLT','HKO'], aq:['Kwun Tong']},
  'kwun-tong':     {ocf:['KTG','HKO'], aq:['Kwun Tong']},
  'sham-shui-po':  {ocf:['SSP','HKO'], aq:['Sham Shui Po','Mong Kok']},
  'wong-tai-sin':  {ocf:['WTS','HKO'], aq:['Kwun Tong']},
  'sha-tin':       {ocf:['SHA','HKO'], aq:['Sha Tin']},
  'tai-po':        {ocf:['TPO','SHA'], aq:['Tai Po']},
  'tai-mei-tuk':   {ocf:['PLC','TPO','SHA'], aq:['Tai Po']},
  'tseung-kwan-o': {ocf:['JKB','HKO'], aq:['Tseung Kwan O']},
  'sai-kung':      {ocf:['SKG','JKB','HKO'], aq:['Tseung Kwan O']},
  'ho-koon':       {ocf:['TWN','TW','HKO'], aq:['Tsuen Wan']},
  'shing-mun':     {ocf:['TW','TWN','HKO'], aq:['Tsuen Wan']},
  'tsing-yi':      {ocf:['TY1','HKO'], aq:['Kwai Chung']},
  'tuen-mun':      {ocf:['TUN','HKO'], aq:['Tuen Mun']},
  'yuen-long':     {ocf:['YLP','LFS','HKO'], aq:['Yuen Long']},
  'lau-fau-shan':  {ocf:['LFS','YLP','HKO'], aq:['Yuen Long']},
  'shek-kong':     {ocf:['SEK','YLP','HKO'], aq:['Yuen Long']},
  'ta-kwu-ling':   {ocf:['TKL','SEK','HKO'], aq:['North']},
  'chek-lap-kok':  {ocf:['HKA','HKO'], aq:['Tung Chung']},
  'cheung-chau':   {ocf:['CCH','HKO'], aq:['Tung Chung']}
};
REGIONS.forEach(r => Object.assign(r, {ocf:['HKO'], aq:[]}, EXTRA[r.id] || {}));
const OCF_NAMES = {HPV:'Happy Valley',HKP:'Hong Kong Park',HKO:'Hong Kong Observatory',SKW:'Shau Kei Wan',HKS:'Wong Chuk Hang',
  STY:'Stanley',KP:"King's Park",KLT:'Kowloon City',SE1:'Kai Tak Runway Park',KTG:'Kwun Tong',SSP:'Sham Shui Po',WTS:'Wong Tai Sin',
  SHA:'Sha Tin',TPO:'Tai Po',YCT:'Tai Po (Yuen Chau Tsai)',PLC:'Tai Mei Tuk',JKB:'Tseung Kwan O',SKG:'Sai Kung',TWN:'Tsuen Wan Ho Koon',
  TW:'Tsuen Wan Shing Mun Valley',TY1:'Tsing Yi',TUN:'Tuen Mun',YLP:'Yuen Long Park',LFS:'Lau Fau Shan',SEK:'Shek Kong',
  TKL:'Ta Kwu Ling',HKA:'Chek Lap Kok',CCH:'Cheung Chau'};

/* "Good times" rules — kept here so they are easy to see and change. */
const GOOD = {
  firstHour: 6,          // ignore hours before 6 a.m.
  maxHeatIndex: 32,      // °C. US National Weather Service "extreme caution" starts at 32°C
  minTemp: 12,           // °C
  worstAir: 2            // allow AQHI health risk up to "Moderate" (1 Low, 2 Moderate, 3 High...)
};
const RAIN_ICONS = new Set([53, 54, 62, 63, 64, 65]);
const TIDE_NAMES = {CCH:'Cheung Chau',CLK:'Chek Lap Kok',CMW:'Chi Ma Wan',KCT:'Kwai Chung',KLW:'Ko Lau Wan',LOP:'Lok On Pai',
  MWC:'Ma Wan',QUB:'Quarry Bay',SPW:'Shek Pik',TAO:'Tai O',TBT:'Tsim Bei Tsui',TMW:'Tai Miu Wan',TPK:'Tai Po Kau',WAG:'Waglan Island'};

/* HKO weather icon codes (from HKO's published icon list) */
const ICON_LABEL = {50:'Sunny',51:'Sunny periods',52:'Sunny intervals',53:'Sunny periods with a few showers',54:'Sunny intervals with showers',
  60:'Cloudy',61:'Overcast',62:'Light rain',63:'Rain',64:'Heavy rain',65:'Thunderstorms',
  70:'Fine',71:'Fine',72:'Fine',73:'Fine',74:'Fine',75:'Fine',76:'Mainly cloudy',77:'Mainly fine',
  80:'Windy',81:'Dry',82:'Humid',83:'Fog',84:'Mist',85:'Haze',90:'Hot',91:'Warm',92:'Cool',93:'Cold'};

function iconLabel(code) {
  code = +code;
  if (code >= 700 && code < 760) return code % 10 === 1 ? 'Mainly cloudy' : 'Mainly fine';
  if (code === 62) return 'Light rain';
  return ICON_LABEL[code] || 'Weather code ' + code;
}

/* =========================================================================
   SMALL HELPERS
   ========================================================================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s ?? '').toLowerCase().replace(/[’'`.]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const isNum = v => v !== '' && v !== null && v !== undefined && isFinite(+v);
const list = v => Array.isArray(v) ? v : (v ? [v] : []);

function hkParts(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(d).forEach(x => p[x.type] = x.value);
  return {y:+p.year, m:+p.month, d:+p.day, hh:+p.hour, mm:+p.minute, ymd:`${p.year}${p.month}${p.day}`, iso:`${p.year}-${p.month}-${p.day}`};
}
const fmtTime = d => d ? new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d) : '';
const fmtDateTime = d => d ? new Intl.DateTimeFormat('en-GB',{timeZone:TZ,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d) : '';
const toDate = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
function stamp12(s) { // "202609281000" (HKT) -> Date
  s = String(s || '').trim();
  if (!/^\d{12}$/.test(s)) return null;
  return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00+08:00`);
}
function ago(d) {
  if (!d) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
}
function hhmmToMin(t) { const m = String(t||'').match(/(\d{1,2}):?(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function fmtHHMM(t) { const m = String(t||'').match(/(\d{1,2}):?(\d{2})/); return m ? `${m[1].padStart(2,'0')}:${m[2]}` : '–'; }

/* Match a station name against live data, forgiving small differences like
   "King's Park" vs "Kings Park" or "Tsing Yi" vs "Tsing Yi Shell Oil Depot". */
function findStation(items, candidates, nameOf) {
  const byNorm = items.map(it => [norm(nameOf(it)), it]);
  for (const c of candidates) { const n = norm(c); const hit = byNorm.find(([k]) => k === n); if (hit) return hit[1]; }
  for (const c of candidates) { const n = norm(c); const hit = byNorm.find(([k]) => k.startsWith(n) || n.startsWith(k)); if (hit) return hit[1]; }
  return null;
}

function parseCSV(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== '')).map(r => r.map(x => x.trim()));
}
// Station CSVs: header row, then [datetime, station, value, ...]
const csvRows = text => { const r = parseCSV(text); return r.length > 1 ? r.slice(1).filter(x => x.length >= 3) : []; };

/* =========================================================================
   NETWORK
   ========================================================================= */
async function get(url, type = 'json') {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, {signal: ctl.signal, referrerPolicy: 'no-referrer', credentials: 'omit'});
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    const t = await r.text();
    if (type === 'text') return t;
    const s = t.trim();
    return s ? JSON.parse(s) : null;
  } finally { clearTimeout(timer); }
}
function sources(region) {
  const n = hkParts();
  const od = `${API}/opendata/opendata.php`;
  return {
    rhr:     () => get(`${API}/opendata/weather.php?dataType=rhrread&lang=en`),
    fnd:     () => get(`${API}/opendata/weather.php?dataType=fnd&lang=en`),
    flw:     () => get(`${API}/opendata/weather.php?dataType=flw&lang=en`),
    warnsum: () => get(`${API}/opendata/weather.php?dataType=warnsum&lang=en`),
    warninfo:() => get(`${API}/opendata/weather.php?dataType=warningInfo&lang=en`),
    swt:     () => get(`${API}/opendata/weather.php?dataType=swt&lang=en`),
    hourly:  () => get(`${API}/opendata/hourlyRainfall.php?lang=en`),
    ltmv:    () => get(`${od}?dataType=LTMV&lang=en&rformat=json`),
    srs:     () => get(`${od}?dataType=SRS&rformat=json&year=${n.y}&month=${n.m}&day=${n.d}`),
    mrs:     () => get(`${od}?dataType=MRS&rformat=json&year=${n.y}&month=${n.m}&day=${n.d}`),
    hlt:     () => get(`${od}?dataType=HLT&station=${region.tide}&rformat=json&year=${n.y}&month=${n.m}&day=${n.d}`),
    qem:     () => get(`${API}/opendata/earthquake.php?dataType=qem&lang=en`),
    felt:    () => get(`${API}/opendata/earthquake.php?dataType=feltearthquake&lang=en`),
    // Not requested: the Observatory's 1-minute temperature and humidity and 10-minute wind files
    // (…/hko_data/regional-weather/latest_1min_temperature.csv, latest_1min_humidity.csv,
    // latest_10min_wind.csv). Its server doesn't allow web pages on other sites to read them, so
    // every request failed. Temperature and humidity come from the hourly report instead; wind
    // shows "Unavailable". The code that reads them is kept (S.temp, S.hum, S.wind), so adding
    // these three lines back is enough if the Observatory ever allows it.
    ocf:     () => loadOCF(region),
    aqhi:    () => loadAQHI(),
    hist:    () => get('./data/history.json')
  };
}
/* Hourly forecast and air quality.
   First choice: the copy your GitHub Action saves next to this page (./data/…).
   Second choice: the government server directly (may be blocked by the browser).
   If both fail, the error says exactly why, in plain words, so the page can show it. */
function why(e) {
  if (!e) return 'unknown problem';
  if (e.name === 'AbortError') return 'timed out';
  if (/404/.test(e.message)) return 'not found';
  if (e instanceof TypeError) return 'blocked or unreachable';
  return e.message;
}
const ocfList = r => [...new Set([...r.ocf, 'HKO'])];
async function loadOCF(r) {
  let copyWhy, directWhy;
  const codes = ocfList(r);
  try {
    const all = await get('./data/ocf.json');
    const stations = {};
    for (const c of codes) if (all && all.stations && all.stations[c]) stations[c] = all.stations[c];
    if (Object.keys(stations).length) return {via: 'copy', stations};
    copyWhy = 'has no forecast for this place';
  } catch (e) { copyWhy = why(e); }
  const stations = {};
  for (const c of codes) {
    try {
      const j = await get(`https://maps.weather.gov.hk/ocf/dat/${c}.xml`);
      if (j && Array.isArray(j.HourlyWeatherForecast)) stations[c] = j;
    } catch (e) { directWhy = why(e); if (directWhy === 'blocked or unreachable') break; }
  }
  if (Object.keys(stations).length) return {via: 'direct', stations};
  throw new Error(`saved copy: ${copyWhy}; Observatory server: ${directWhy || 'no matching forecast point'}`);
}
async function loadAQHI() {
  let copyWhy;
  try {
    const c = await get('./data/aqhi.json');
    if (c && c.ind) return {ind: c.ind, range: c.range, via: 'copy'};
    copyWhy = 'empty';
  } catch (e) { copyWhy = why(e); }
  try {
    const [ind, range] = await Promise.all([
      get('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_Eng.xml', 'text'),
      get('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhirss_Eng.xml', 'text')]);
    return {ind, range, via: 'direct'};
  } catch (e) {
    throw new Error(`saved copy: ${copyWhy}; EPD server: ${why(e)}`);
  }
}

/* =========================================================================
   STATE
   ========================================================================= */
let S = {};            // latest data, keyed as in sources()
let E = {};            // per-source error messages
let lastFetch = null;
let region = pickRegion();
let tab = 'temp';

function pickRegion() {
  const fromHash = location.hash.slice(1);
  let id = REGIONS.some(r => r.id === fromHash) ? fromHash : null;
  if (!id) { try { id = localStorage.getItem(STORE_KEY); } catch (e) {} }
  return REGIONS.find(r => r.id === id) || REGIONS.find(r => r.id === 'hko') || REGIONS[0];
}
function setRegion(r) {
  region = r;
  try { localStorage.setItem(STORE_KEY, r.id); } catch (e) {}
  history.replaceState(null, '', '#' + r.id);
  renderAll();
  // Tide station depends on the location, so fetch it again.
  const src = sources(region);
  src.hlt().then(v => { S.hlt = v; delete E.hlt; }).catch(e => { E.hlt = e.message; S.hlt = null; }).finally(renderSkySea);
  src.ocf().then(v => { S.ocf = v; delete E.ocf; }).catch(e => { E.ocf = e.message; S.ocf = null; }).finally(() => { renderHourly(); renderOutside(); });
}

// The Refresh button is a round ↻ icon; while loading it turns (or, with reduced motion, fades).
function refreshing(on) {
  const b = $('#refresh');
  b.classList.toggle('busy', on); b.setAttribute('aria-busy', String(on)); b.title = on ? 'Refreshing…' : 'Refresh now';
}
async function refresh() {
  refreshing(true);
  const src = sources(region);
  const keys = Object.keys(src);
  const results = await Promise.allSettled(keys.map(k => src[k]()));
  let ok = 0;
  results.forEach((res, i) => {
    const k = keys[i];
    if (res.status === 'fulfilled') { S[k] = res.value; delete E[k]; ok++; }
    else { E[k] = res.reason && res.reason.name === 'AbortError' ? 'timed out' : (res.reason && res.reason.message) || 'failed'; }
  });
  if (ok) {
    lastFetch = new Date();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({t: lastFetch.getTime(), S})); } catch (e) {}
  }
  refreshing(false);
  renderAll();
  if (!ok) {
    $('#status').innerHTML = HK.state('error', {title: "Couldn't reach the Hong Kong Observatory", body: navigator.onLine === false ? 'You appear to be offline. Data will refresh when you reconnect.' : "Check your connection and try again. If it keeps happening while other sites work, the Observatory's server may be refusing requests from web pages.", action: 'Try again'});
  }
}

/* =========================================================================
   ICONS — a single line-drawn set so every condition looks consistent
   ========================================================================= */
let uid = 0;
const CLOUD = 'M13 36H35A7 7 0 0 0 35.5 22.1A10 10 0 0 0 16.4 19.6A8 8 0 0 0 13 36Z';
function sunG(cx, cy, r) {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, c = Math.cos(a), n = Math.sin(a);
    s += `<line x1="${(cx+c*(r+3.5)).toFixed(1)}" y1="${(cy+n*(r+3.5)).toFixed(1)}" x2="${(cx+c*(r+6.5)).toFixed(1)}" y2="${(cy+n*(r+6.5)).toFixed(1)}"/>`;
  }
  return s;
}
function moonG(cx, cy, r, k, waxing) { // k = lit fraction 0..1
  if (k <= 0.02) return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke-dasharray="2 3"/>`;
  if (k >= 0.98) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" fill-opacity=".25"/>`;
  const rx = (r * Math.abs(1 - 2 * k)).toFixed(2);
  const sweep = k < 0.5 ? 0 : 1;
  const lit = `M${cx} ${cy-r}A${r} ${r} 0 0 1 ${cx} ${cy+r}A${rx} ${r} 0 0 ${sweep} ${cx} ${cy-r}Z`;
  const flip = waxing ? '' : ` transform="translate(${2*cx} 0) scale(-1 1)"`;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke-opacity=".45"/><path d="${lit}" fill="currentColor" fill-opacity=".3"${flip}/>`;
}
function behindCloud(back, dx, dy, sc) {
  const id = 'm' + (++uid);
  const t = `translate(${dx} ${dy}) scale(${sc})`;
  return `<defs><mask id="${id}"><rect width="48" height="48" fill="#fff"/><path d="${CLOUD}" transform="${t}" fill="#000" stroke="#000" stroke-width="6"/></mask></defs>` +
         `<g mask="url(#${id})">${back}</g><path d="${CLOUD}" transform="${t}"/>`;
}
const drops = (n, long) => {
  const xs = n === 2 ? [20, 28] : n === 3 ? [17, 24, 31] : [14, 20, 26, 32];
  return xs.map(x => `<line x1="${x}" y1="40" x2="${x - 2}" y2="${long ? 46 : 44}"/>`).join('');
};
const thermo = level => `<path d="M21 30V9a3 3 0 0 1 6 0v21a6 6 0 1 1-6 0z"/><line x1="24" y1="${34 - level}" x2="24" y2="33" stroke-width="4"/>`;
function wxIcon(code, cls = 'wx') {
  code = +code;
  let g;
  const sunPeriods = (drop) => behindCloud(sunG(17, 16, 6), 7, 6, .8) + (drop ? drops(2) : '');
  const sunIntervals = (drop) => behindCloud(sunG(19, 15, 6), 1, 5, .95) + (drop ? drops(3) : '');
  switch (code) {
    case 50: g = sunG(24, 24, 8); break;
    case 51: g = sunPeriods(false); break;
    case 52: g = sunIntervals(false); break;
    case 53: g = sunPeriods(true); break;
    case 54: g = sunIntervals(true); break;
    case 60: g = behindCloud(`<path d="${CLOUD}" transform="translate(8 -8) scale(.75)"/>`, -1, 2, 1); break;
    case 61: g = `<path d="${CLOUD}" transform="translate(-1 0)" fill="currentColor" fill-opacity=".25"/>`; break;
    case 62: g = `<path d="${CLOUD}" transform="translate(0 -4)"/>` + drops(2); break;
    case 63: g = `<path d="${CLOUD}" transform="translate(0 -4)"/>` + drops(3); break;
    case 64: g = `<path d="${CLOUD}" transform="translate(0 -4)" fill="currentColor" fill-opacity=".2"/>` + drops(4, true); break;
    case 65: g = `<path d="${CLOUD}" transform="translate(0 -5)" fill="currentColor" fill-opacity=".2"/><path d="M26 34l-5 7h5l-3 6" />`; break;
    case 70: g = moonG(24, 24, 11, 0, true); break;
    case 71: g = moonG(24, 24, 11, .2, true); break;
    case 72: g = moonG(24, 24, 11, .5, true); break;
    case 73: g = moonG(24, 24, 11, 1, true); break;
    case 74: g = moonG(24, 24, 11, .6, false); break;
    case 75: g = moonG(24, 24, 11, .2, false); break;
    case 76: g = behindCloud(moonG(17, 16, 7, .5, true), 1, 5, .95); break;
    case 701: case 702: case 711: case 712: case 721: case 722: case 741: case 742: case 751: case 752: {
      const ph = {70:[0,true],71:[.2,true],72:[.5,true],74:[.6,false],75:[.2,false]}[Math.floor(code / 10)];
      g = code % 10 === 1 ? behindCloud(moonG(17, 16, 7, ph[0], ph[1]), 1, 5, .95) : behindCloud(moonG(17, 16, 8, ph[0], ph[1]), 9, 8, .75);
      break; }
    case 77: g = behindCloud(moonG(17, 16, 8, .5, true), 9, 8, .75); break;
    case 80: g = '<path d="M8 18h22a5 5 0 1 0-5-5"/><path d="M8 26h30a5 5 0 1 1-5 5"/><path d="M8 34h14"/>'; break;
    case 81: g = '<path d="M24 8c6 9 10 14 10 20a10 10 0 0 1-20 0c0-6 4-11 10-20z"/><line x1="12" y1="40" x2="36" y2="12"/>'; break;
    case 82: g = '<path d="M24 8c6 9 10 14 10 20a10 10 0 0 1-20 0c0-6 4-11 10-20z" fill="currentColor" fill-opacity=".25"/>'; break;
    case 83: g = '<line x1="8" y1="18" x2="40" y2="18"/><line x1="12" y1="25" x2="36" y2="25"/><line x1="8" y1="32" x2="40" y2="32"/><line x1="14" y1="39" x2="34" y2="39"/>'; break;
    case 84: g = '<g stroke-dasharray="3 4"><line x1="8" y1="18" x2="40" y2="18"/><line x1="8" y1="26" x2="40" y2="26"/><line x1="8" y1="34" x2="40" y2="34"/></g>'; break;
    case 85: g = sunG(24, 17, 6) + '<line x1="8" y1="31" x2="40" y2="31"/><line x1="12" y1="38" x2="36" y2="38"/>'; break;
    case 90: g = thermo(22); break;
    case 91: g = thermo(15); break;
    case 92: g = thermo(8); break;
    case 93: g = thermo(3) + '<line x1="34" y1="10" x2="42" y2="10"/>'; break;
    default: g = '<circle cx="24" cy="24" r="12"/><path d="M20 20a4 4 0 1 1 5 4v3"/><circle cx="24" cy="32" r=".6"/>';
  }
  return `<svg class="${cls}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>`;
}

/* Wind direction -> arrow showing where the wind is blowing TO */
const COMPASS = {n:0,north:0,nne:22.5,ne:45,northeast:45,ene:67.5,e:90,east:90,ese:112.5,se:135,southeast:135,sse:157.5,
  s:180,south:180,ssw:202.5,sw:225,southwest:225,wsw:247.5,w:270,west:270,wnw:292.5,nw:315,northwest:315,nnw:337.5};
function windArrow(dir) {
  const deg = COMPASS[norm(dir).replace(/ /g,'')];
  if (deg === undefined) return '';
  return `<svg class="arrow" viewBox="0 0 16 16" data-sty="transform:rotate(${deg}deg)" aria-hidden="true"><path d="M8 2v11M4 9l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
const DIR_SHORT = {north:'N',northeast:'NE',east:'E',southeast:'SE',south:'S',southwest:'SW',west:'W',northwest:'NW'};
const dirShort = d => DIR_SHORT[norm(d).replace(/ /g,'')] || d;

/* =========================================================================
   DERIVED DATA
   ========================================================================= */
function temps() {
  // Prefer the 1-minute CSV if loaded (not requested at present; see sources()); else the hourly report.
  const out = new Map();
  const rhr = S.rhr && S.rhr.temperature;
  const rt = rhr ? toDate(rhr.recordTime) : null;
  list(rhr && rhr.data).forEach(d => { if (isNum(d.value)) out.set(norm(d.place), {name: d.place, v: +d.value, t: rt, src: 'hourly report'}); });
  if (S.temp) csvRows(S.temp).forEach(r => {
    if (!isNum(r[2])) return;
    const key = norm(r[1]);
    const keys = [...out.keys()];
    const match = keys.find(k => k === key) || keys.find(k => k.startsWith(key) || key.startsWith(k));
    out.set(match || key, {name: (out.get(match) || {}).name || r[1], v: +r[2], t: stamp12(r[0]), src: '1-minute reading'});
  });
  return out;
}
function tempFor(r, T = temps()) {
  const n = norm(r.temp);
  return T.get(n) || [...T.values()].find(x => norm(x.name).startsWith(n)) || null;
}
function sunTimes() {
  const j = S.srs;
  if (!j || !Array.isArray(j.fields) || !Array.isArray(j.data) || !j.data.length) return null;
  const f = j.fields.map(x => String(x));
  const iR = f.findIndex(x => /rise/i.test(x)), iS = f.findIndex(x => /set/i.test(x) && !/rise/i.test(x));
  const today = hkParts().iso;
  const row = j.data.find(r => String(r[0]).includes(today)) || j.data[0];
  if (iR < 0 || iS < 0) return null;
  return {rise: row[iR], set: row[iS], tran: row[f.findIndex(x => /tran/i.test(x))]};
}
function moonTimes() {
  const j = S.mrs;
  if (!j || !Array.isArray(j.fields) || !Array.isArray(j.data) || !j.data.length) return null;
  const f = j.fields.map(String);
  const today = hkParts().iso;
  const row = j.data.find(r => String(r[0]).includes(today)) || j.data[0];
  const g = re => { const i = f.findIndex(x => re.test(x)); return i >= 0 ? row[i] : ''; };
  return {rise: g(/rise/i), set: g(/set/i)};
}
function tides() {
  const j = S.hlt;
  if (!j || !Array.isArray(j.data) || !j.data.length) return null;
  const n = hkParts();
  const row = j.data.find(r => +r[0] === n.m && +r[1] === n.d) || (j.data.length === 1 ? j.data[0] : null);
  if (!row) return null;
  const ev = [];
  for (let i = 0; i < row.length - 1; i++) {
    const t = String(row[i]).trim(), h = String(row[i+1]).trim();
    if (/^\d{1,2}:?\d{2}$/.test(t) && t.replace(':','').length >= 3 && /^-?\d+(\.\d+)?$/.test(h)) { ev.push({t: fmtHHMM(t), h: +h}); i++; }
  }
  ev.forEach((e, i) => {
    const nb = [ev[i-1], ev[i+1]].filter(Boolean);
    e.high = nb.length ? nb.every(x => e.h > x.h) : null;
  });
  return ev.length ? ev : null;
}

/* =========================================================================
   RENDER
   ========================================================================= */
function renderAll() {
  document.title = `Weather · ${region.name}`;
  $('#place-name').textContent = region.name;
  renderWarnings(); renderHero(); renderReadings(); renderNotices();
  renderFlw(); renderOutside(); renderHourly(); renderDays(); renderAcross(); renderSkySea(); renderQuake(); renderFooter();
}

function renderHero() {
  const T = tempFor(region);
  const rhr = S.rhr || {};
  const code = list(rhr.icon)[0];
  $('#now-temp').innerHTML = T ? `${Math.round(T.v)}<span class="deg">°</span>` : '–';
  $('#now-cond').innerHTML = code ? `${wxIcon(code)}<span>${esc(iconLabel(code))}</span>` : '';
  let sub = '';
  if (T) sub = `${esc(region.name)} station, ${T.v.toFixed(1)}°C at ${fmtTime(T.t)}`;
  else if (S.rhr) sub = `No reading from the ${esc(region.temp)} station right now.`;
  const f0 = S.fnd && list(S.fnd.weatherForecast)[0];
  if (f0 && f0.forecastDate === hkParts().ymd && f0.forecastMaxtemp) sub += `<br>Today ${f0.forecastMintemp.value}–${f0.forecastMaxtemp.value}°C`;
  if (sub) $('#now-sub').innerHTML = sub;
  paintSky(code);
}

function paintSky(code) {
  const now = hkParts(), m = now.hh * 60 + now.mm;
  const st = sunTimes();
  const rise = st ? hhmmToMin(st.rise) : 6 * 60 + 20, set = st ? hhmmToMin(st.set) : 18 * 60 + 20;
  const phase = (m < rise - 40 || m > set + 40) ? 'night' : (m < rise + 40) ? 'dawn' : (m > set - 40) ? 'dusk' : 'day';
  code = +code;
  const grey = [60,61,62,63,64,65,76].includes(code);
  const P = {
    night: grey ? ['#18222b','#34424c','#0b131a','#101b23',1] : ['#0c1b2e','#2a4462','#08121c','#0e1a26',1],
    dawn:  grey ? ['#4b5866','#a9a9a4','#1f2e30','#26353c',.6] : ['#35527a','#f0b58c','#1c2d33','#233640',.6],
    day:   grey ? ['#6d7f8b','#c3ccd0','#35493f','#42565e',0] : ['#3f86c4','#cfe6f3','#2c4a3e','#3a535c',0],
    dusk:  grey ? ['#3c4654','#9a8f8b','#18252a','#1f2d35',.8] : ['#2c3d6b','#ee9a6a','#152228','#1b2a33',.8]
  }[phase];
  const h = $('#hero'), st2 = h.style;
  st2.setProperty('--sky-top', P[0]); st2.setProperty('--sky-bot', P[1]);
  st2.setProperty('--ridge', P[2]); st2.setProperty('--towers', P[3]); st2.setProperty('--lit', P[4]);
  st2.setProperty('--turf', {night:'#16301f',dawn:'#2a5238',day:'#2f6b45',dusk:'#1f3d2a'}[phase]);
  h.classList.toggle('raining', [53,54,62,63].includes(code));
  h.classList.toggle('pouring', [64,65].includes(code));
  h.classList.toggle('hazy', [83,84,85].includes(code));
  document.querySelector('meta[name="theme-color"]').setAttribute('content', P[0]);
  drawSkyline(phase, code);
}

function drawSkyline(phase, code) {
  // A stylised valley: hills behind, a ring of residential towers, lit windows after dark.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let towers = '', windows = '';
  let x = -4;
  while (x < 404) {
    const w = 10 + Math.floor(rnd() * 10), hgt = 26 + Math.floor(rnd() * 44);
    const y = 120 - hgt;
    towers += `<rect x="${x}" y="${y}" width="${w}" height="${hgt + 1}"/>`;
    for (let wy = y + 4; wy < 116; wy += 5) for (let wx = x + 2; wx < x + w - 2; wx += 4)
      if (rnd() < 0.22) windows += `<rect x="${wx}" y="${wy}" width="1.6" height="2"/>`;
    x += w + 1 + Math.floor(rnd() * 3);
  }
  const hills = 'M0 64C30 44 58 40 92 50S150 30 196 22S262 40 300 34S360 50 400 38V120H0Z';
  const hv = region.id === 'happy-valley'
    ? '<path d="M-10 120C60 104 340 104 410 120Z" fill="var(--turf)"/><path d="M-10 118C60 103 340 103 410 118" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>'
    : '';
  $('#skyline').innerHTML =
    `<path d="${hills}" fill="var(--ridge)"/>` +
    `<g fill="var(--towers)">${towers}</g>` +
    `<g fill="#ffd98a" class="lit">${windows}</g>` + hv;
}

function renderReadings() {
  const rhr = S.rhr || {};
  const cells = [];
  // Rain in the past hour: the nearest gauge first, district maximum as context.
  const hr = S.hourly && list(S.hourly.hourlyRainfall);
  const g = hr && findStation(hr, region.gauge, x => x.automaticWeatherStation);
  const dist = rhr.rainfall && list(rhr.rainfall.data).find(d => norm(d.place) === norm(region.district));
  let rainV = '–', rainS = '';
  if (g) {
    rainV = g.value === 'M' ? 'Maintenance' : `${esc(g.value)} mm`;
    rainS = `${esc(g.automaticWeatherStation)} gauge, hour to ${fmtTime(toDate(S.hourly.obsTime))}`;
  }
  if (dist) {
    const dv = dist.main === 'TRUE' ? 'under maintenance' : `${isNum(dist.min) ? dist.min + '–' : ''}${dist.max} mm`;
    if (!g) rainV = dist.main === 'TRUE' ? 'Maintenance' : `${isNum(dist.min) ? dist.min + '–' : ''}${dist.max} mm`;
    rainS += `${rainS ? '<br>' : ''}Range across ${esc(dist.place)}: ${esc(dv)}`;
  }
  cells.push(['Rain, past hour', rainV, rainS || (E.hourly ? 'Unavailable' : '')]);

  // Humidity: nearby station from the 1-minute CSV if loaded (not requested at present), else the Observatory's own reading.
  let humV = '–', humS = '';
  const hc = S.hum ? csvRows(S.hum) : [];
  const hrow = hc.length && findStation(hc, region.hum, r => r[1]);
  if (hrow && isNum(hrow[2])) { humV = `${hrow[2]}%`; humS = `${esc(hrow[1])}, ${fmtTime(stamp12(hrow[0]))}`; }
  else if (rhr.humidity && list(rhr.humidity.data)[0]) {
    const h0 = list(rhr.humidity.data)[0];
    humV = `${h0.value}%`; humS = `${esc(h0.place)}, ${fmtTime(toDate(rhr.humidity.recordTime))}`;
  }
  cells.push(['Humidity', humV, humS || (E.rhr ? 'Unavailable' : '')]);

  // Wind
  let wV = '–', wS = 'Unavailable';   // no wind source at present; see sources()
  if (S.wind) {
    const rows = csvRows(S.wind);
    const w = findStation(rows, region.wind, r => r[1]);
    if (w) {
      const [t, name, dir, spd, gust] = w;
      if (/n\/a/i.test(dir) && /n\/a/i.test(spd)) wV = 'No data';
      else if (/calm/i.test(dir) || spd === '') wV = 'Calm';
      else wV = `${windArrow(dir)}${esc(dirShort(dir))} ${esc(spd)}<span class="small"> km/h</span>`;
      wS = `${esc(name)}${isNum(gust) ? `, gusts ${esc(gust)} km/h` : ''}, ${fmtTime(stamp12(t))}`;
    } else wS = 'No wind station mapped near here — see Across Hong Kong';
  }
  cells.push(['Wind', wV, wS]);

  // UV index (daytime only; HKO reports it for King's Park)
  const uv = rhr.uvindex && typeof rhr.uvindex === 'object' ? list(rhr.uvindex.data)[0] : null;
  cells.push(['UV index', uv ? `${esc(uv.value)} <span class="small">${esc(uv.desc || '')}</span>` : 'None now',
    uv ? `${esc(uv.place)}, ${esc(String(rhr.uvindex.recordDesc || '').toLowerCase())}` : 'Reported in daylight hours']);

  // Visibility
  let vV = '–', vS = E.ltmv ? 'Unavailable' : '';
  if (S.ltmv && Array.isArray(S.ltmv.data)) {
    const v = findStation(S.ltmv.data, region.vis, r => r[1]) || S.ltmv.data[0];
    if (v) { vV = esc(v[2]); vS = `${esc(v[1])}, ${fmtTime(stamp12(v[0]))}`; }
  }
  cells.push(['Visibility', vV, vS]);

  // Lightning in the past hour
  const lt = rhr.lightning && list(rhr.lightning.data).filter(d => String(d.occur) === 'true');
  cells.push(['Lightning, past hour', lt && lt.length ? 'Recorded' : 'None reported',
    lt && lt.length ? esc(lt.map(d => d.place).join(', ')) : '']);

  // Air quality (EPD)
  const aqs = aqhiStations();
  const gen = aqs.find(a => a.name === region.aq[0]);
  const road = region.aq[1] && aqs.find(a => a.name === region.aq[1]);
  const fc = aqhiForecast();
  let aqS = gen ? `${esc(gen.name)} general station${road ? `; roadside ${esc(road.name)}: ${esc(road.v)}` : ''}${gen.time ? ', ' + esc(gen.time.slice(-5)) : ''}` : (E.aqhi ? `Unavailable (${esc(E.aqhi)})` : '');
  if (fc && fc[0]) aqS += `${aqS ? '<br>' : ''}Forecast ${esc(fc[0].period.toLowerCase())}: ${esc(fc[0].general.toLowerCase())}`;
  cells.push(['Air quality (AQHI)', gen ? `${esc(gen.v)} <span class="small">${esc(gen.risk.toLowerCase())}</span>` : '–', aqS]);

  $('#readings').innerHTML = cells.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${v}${s ? `<small>${s}</small>` : ''}</dd></div>`).join('');
  const code = list(rhr.icon)[0];
  $('#now-note').textContent = code
    ? `The weather picture (“${ICON_LABEL[code] || code}”) is the Observatory's territory-wide summary, updated ${fmtTime(toDate(rhr.iconUpdateTime))}. Other numbers come from the named stations.`
    : '';
}

function renderWarnings() {
  const ws = S.warnsum && typeof S.warnsum === 'object' ? Object.entries(S.warnsum) : [];
  const chips = [];
  for (const [key, w] of ws) {
    if (!w || w.actionCode === 'CANCEL') continue;
    let cls = '', label = w.name || key;
    if (key === 'WRAIN') { const c = {WRAINA:['amber','Amber rainstorm'],WRAINR:['red','Red rainstorm'],WRAINB:['black','Black rainstorm']}[w.code]; if (c) [cls, label] = c; }
    else if (key === 'WTCSGNL') { cls = 'tc'; const m = String(w.code).match(/^TC(\d+)(\w*)$/); label = m ? `Signal <b>No. ${m[1]}${m[2] ? ' ' + m[2] : ''}</b>` : esc(w.type || w.name); }
    else if (key === 'WFIRE') { cls = w.code === 'WFIRER' ? 'fire-r' : 'fire-y'; label = w.code === 'WFIRER' ? 'Red fire danger' : 'Yellow fire danger'; }
    chips.push(`<button class="wchip ${cls}" data-code="${esc(key)}">${key === 'WTCSGNL' ? label : esc(label)}</button>`);
  }
  $('#warnings').innerHTML = chips.length ? `<div class="wrap">${chips.join('')}</div>` : '';
  $('#warnings').querySelectorAll('.wchip').forEach(b => b.onclick = () => showWarning(b.dataset.code));
}
function showWarning(code) {
  const box = $('#warn-detail');
  if (!box.hidden && box.dataset.code === code) { box.hidden = true; return; }
  const d = S.warninfo && list(S.warninfo.details).find(x => x.warningStatementCode === code);
  box.dataset.code = code;
  box.innerHTML = `<div class="wrap">${d ? list(d.contents).map(p => `<p>${esc(p)}</p>`).join('') + `<p class="small dim">Updated ${fmtDateTime(toDate(d.updateTime))}</p>` : '<p>No further details published.</p>'}</div>`;
  box.hidden = false;
}

function renderNotices() {
  const rhr = S.rhr || {};
  const parts = [];
  list(rhr.warningMessage).filter(Boolean).forEach(m => parts.push(`<p>${esc(m)}</p>`));
  list(rhr.rainstormReminder).filter(Boolean).forEach(m => parts.push(`<p>${esc(m)}</p>`));
  list(rhr.specialWxTips).filter(Boolean).forEach(m => parts.push(`<p>${esc(m)}</p>`));
  list(rhr.tcmessage).filter(Boolean).forEach(m => parts.push(`<p>${esc(m)}</p>`));
  if (S.swt && Array.isArray(S.swt.swt)) S.swt.swt.forEach(t => parts.push(`<p>${esc(t.desc)} <span class="small muted">${fmtDateTime(toDate(t.updateTime))}</span></p>`));
  $('#notices').hidden = !parts.length;
  $('#notice-body').innerHTML = parts.join('');
}

function renderFlw() {
  const f = S.flw;
  if (!f) { $('#flw').innerHTML = (E.flw ? stErr('The local forecast is unavailable right now.', 'Details: ' + E.flw) : stLoad()); return; }
  let h = '';
  if (f.forecastPeriod) h += `<h3>${esc(f.forecastPeriod)}</h3>`;
  if (f.forecastDesc) h += `<p class="lede">${esc(f.forecastDesc)}</p>`;
  if (f.outlook) h += `<h3>Outlook</h3><p>${esc(f.outlook)}</p>`;
  if (f.generalSituation) h += `<h3>General situation</h3><p>${esc(f.generalSituation)}</p>`;
  if (f.tcInfo) h += `<p class="note">${esc(f.tcInfo)}</p>`;
  if (f.fireDangerWarning) h += `<p class="note">${esc(f.fireDangerWarning)}</p>`;
  if (f.updateTime) h += `<p class="small muted">Issued ${fmtDateTime(toDate(f.updateTime))}</p>`;
  $('#flw').innerHTML = h;
}

/* ---------- Air quality (EPD RSS feeds) ---------- */
const parseXML = t => new DOMParser().parseFromString(String(t || ''), 'application/xml');
function aqhiStations() {
  if (!S.aqhi || !S.aqhi.ind) return [];
  return [...parseXML(S.aqhi.ind).querySelectorAll('item')].map(it => {
    const name = (it.querySelector('title') || {}).textContent || '';
    const d = (it.querySelector('description') || {}).textContent || '';
    const m = d.match(/(General|Roadside) Stations?:\s*(10\+|\d+)\s+(Very High|Low|Moderate|High|Serious)/i);
    const t = d.match(/(\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2})\s*$/);
    return m ? {name: name.trim(), type: m[1], v: m[2], risk: m[3], time: t ? t[1] : ''} : null;
  }).filter(Boolean);
}
function aqhiForecast() {
  if (!S.aqhi || !S.aqhi.range) return null;
  const item = [...parseXML(S.aqhi.range).querySelectorAll('item')].find(i => /forecast/i.test((i.querySelector('title') || {}).textContent || ''));
  if (!item) return null;
  const text = new DOMParser().parseFromString((item.querySelector('description') || {}).textContent || '', 'text/html').body.textContent;
  const out = []; const re = /<([^>]+)>([^<]*)/g; let m;
  while ((m = re.exec(text))) {
    const g = m[2].match(/General Stations:\s*([A-Za-z ]+?)(?=Roadside|$)/i);
    out.push({period: m[1].trim(), general: g ? g[1].trim() : ''});
  }
  return out.length ? out : null;
}
const riskRank = s => { s = String(s).toLowerCase(); return s.includes('serious') ? 5 : s.includes('very high') ? 4 : s.includes('high') ? 3 : s.includes('moderate') ? 2 : s.includes('low') ? 1 : 0; };
function aqhiWindows() {
  const fc = aqhiForecast(); if (!fc) return [];
  const midnight = Date.parse(hkParts().iso + 'T00:00:00+08:00');
  return fc.map(p => {
    const m = p.period.match(/(today|tomorrow)\s*(a\.?\s*m|p\.?\s*m)/i); if (!m) return null;
    const start = midnight + (/tomorrow/i.test(m[1]) ? 864e5 : 0) + (/p/i.test(m[2]) ? 12 * 3600e3 : 0);
    return {start, end: start + 12 * 3600e3, rank: riskRank(p.general), text: p.general};
  }).filter(Boolean);
}

/* ---------- Hourly: recorded (from your GitHub Action) + forecast (HKO computer forecast) ---------- */
const HOUR = 3600e3;
const hourKey = d => { const p = hkParts(d); return p.ymd + String(p.hh).padStart(2, '0'); };
/* Not every forecast point forecasts everything (Happy Valley's has temperature only).
   So each element is taken from the first point in the place's list that forecasts it,
   and the page names the source of each. */
const ELEMENTS = {temp: 'ForecastTemperature', rh: 'ForecastRelativeHumidity', wx: 'ForecastWeather'};
function ocfSources() {
  const st = (S.ocf && S.ocf.stations) || {};
  const src = {};
  for (const [k, field] of Object.entries(ELEMENTS))
    src[k] = ocfList(region).find(c => st[c] && list(st[c].HourlyWeatherForecast).some(h => h[field] !== undefined && h[field] !== null)) || null;
  src.pop = ocfList(region).find(c => st[c] && list(st[c].DailyForecast).some(d => d.ForecastChanceOfRain)) || null;
  return src;
}
function ocfHours() {
  const m = new Map(), st = (S.ocf && S.ocf.stations) || {}, src = ocfSources();
  for (const [k, field] of Object.entries(ELEMENTS)) {
    if (!src[k]) continue;
    list(st[src[k]].HourlyWeatherForecast).forEach(h => {
      if (h[field] === undefined || h[field] === null) return;
      const key = String(h.ForecastHour);
      if (!m.has(key)) m.set(key, {ForecastHour: key});
      m.get(key)[field] = h[field];
    });
  }
  return m;
}
const stName = c => OCF_NAMES[c] || c;
function ocfCredit() {
  const s = ocfSources();
  if (!s.temp) return '';
  const parts = [`temperature for ${stName(s.temp)}`];
  if (s.rh) parts.push(s.rh === s.temp ? 'humidity for the same point' : `humidity for ${stName(s.rh)}`);
  if (s.wx) parts.push(s.wx === s.temp ? 'weather for the same point' : `rain and weather for ${stName(s.wx)}`);
  else parts.push('no rain forecast available nearby');
  return parts.join(', ');
}
function histTemp(k) {
  const H = S.hist; if (!H || !Array.isArray(H.temps)) return null;
  const e = H.temps.find(x => hourKey(new Date(x.t)) === k); if (!e || !e.v) return null;
  const n = Object.keys(e.v).find(x => norm(x) === norm(region.temp));
  return n !== undefined && isNum(e.v[n]) ? +e.v[n] : null;
}
function histRain(slotStart) {
  // Rain gauge total for the hour ending at the end of this slot (accepting readings up to 15 min off).
  const H = S.hist; if (!H || !Array.isArray(H.gauges)) return null;
  const end = slotStart.getTime() + HOUR; let best = null;
  for (const g of H.gauges) {
    const dt = Math.abs(Date.parse(g.t) - end);
    if (dt > 15 * 60e3 || (best && dt >= best.dt)) continue;
    const hit = findStation(Object.keys(g.v || {}), region.gauge, x => x);
    if (hit) best = {dt, v: g.v[hit], name: hit, t: g.t};
  }
  return best;
}
function buildSlots() {
  const base = Math.floor(Date.now() / HOUR) * HOUR - 12 * HOUR;   // HK has no daylight saving, so UTC hour boundaries line up
  const O = ocfHours(), cur = tempFor(region);
  return Array.from({length: 24}, (_, i) => {
    const d = new Date(base + i * HOUR), k = hourKey(d), f = O.get(k);
    const s = {i, d, k, hh: hkParts(d).hh, f};
    if (i < 12) { s.t = histTemp(k); s.rain = histRain(d); }
    else if (i === 12) s.t = cur ? cur.v : null;
    else s.t = f && isNum(f.ForecastTemperature) ? +f.ForecastTemperature : null;
    return s;
  });
}
const iconAt = (code, x, y, size) => wxIcon(code).replace('<svg class="wx"', `<svg x="${x}" y="${y}" width="${size}" height="${size}"`);
function hourlyChart(slots) {
  const CW = 40, W = CW * 24, H = 222, top = 48, bot = 118;
  const temps = slots.map(s => s.t).filter(isNum);
  if (!temps.length) return '<p class="muted small">No hourly numbers are available yet.</p>';
  const lo = Math.floor(Math.min(...temps)) - 1, hi = Math.ceil(Math.max(...temps)) + 1;
  const x = i => i * CW + CW / 2, y = v => bot - (v - lo) / (hi - lo) * (bot - top);
  let g = `<rect x="${12 * CW}" y="0" width="${CW}" height="${H}" class="nowband"/>`;
  g += `<text x="${6 * CW}" y="32" class="cap">Recorded</text><text x="${18 * CW}" y="32" class="cap">Forecast</text>`;
  slots.forEach(s => { g += `<text x="${x(s.i)}" y="14" class="hl${s.i === 12 ? ' now' : ''}">${s.i === 12 ? 'Now' : String(s.hh).padStart(2, '0')}</text>`; });
  const seg = (from, to, cls) => {
    let d = '', pen = false;
    for (let i = from; i <= to; i++) { const s = slots[i]; if (isNum(s.t)) { d += `${pen ? 'L' : 'M'}${x(i)} ${y(s.t).toFixed(1)}`; pen = true; } else pen = false; }
    return d ? `<path d="${d}" class="${cls}"/>` : '';
  };
  g += seg(0, 12, 'tline') + seg(12, 23, 'tline fut');
  slots.forEach(s => {
    if (!isNum(s.t)) return;
    g += `<circle cx="${x(s.i)}" cy="${y(s.t).toFixed(1)}" r="2.6" class="cdot${s.i > 12 ? ' fut' : ''}"/>` +
         `<text x="${x(s.i)}" y="${(y(s.t) - 8).toFixed(1)}" class="tv">${Math.round(s.t)}°</text>`;
  });
  slots.forEach(s => { const c = s.i >= 12 && s.f && s.f.ForecastWeather; if (c) g += iconAt(c, x(s.i) - 13, 130, 26); });
  const rains = slots.filter(s => s.rain && isNum(s.rain.v)).map(s => +s.rain.v);
  const maxR = Math.max(5, ...rains);
  slots.forEach(s => {
    if (!s.rain) return;
    if (!isNum(s.rain.v)) { g += `<text x="${x(s.i)}" y="${H - 4}" class="rv">M</text>`; return; }
    const hgt = (+s.rain.v) / maxR * 44;
    g += `<rect x="${x(s.i) - 9}" y="${(H - 16 - hgt).toFixed(1)}" width="18" height="${Math.max(hgt, 1).toFixed(1)}" class="rbar"/><text x="${x(s.i)}" y="${H - 4}" class="rv">${+s.rain.v}</text>`;
  });
  return `<div class="chart-scroll"><svg class="hchart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Temperature for the past 12 hours and next 12 hours">${g}</svg></div>`;
}
function renderHourly() {
  const slots = buildSlots();
  const past = slots.slice(0, 12).filter(s => isNum(s.t)).map(s => s.t);
  const fut = slots.slice(13).filter(s => isNum(s.t)).map(s => s.t);
  const src = ocfSources();
  const rainSoon = slots.slice(12).filter(s => s.f && RAIN_ICONS.has(+s.f.ForecastWeather));
  const popDay = src.pop && list(S.ocf.stations[src.pop].DailyForecast).find(d => String(d.ForecastDate) === hkParts().ymd);
  const lines = [];
  if (fut.length) {
    const rainText = !src.wx ? '' : rainSoon.length
      ? `, with rain in the forecast around ${rainSoon.map(s => String(s.hh).padStart(2, '0') + ':00').join(', ')}`
      : ', with no rain in the hourly forecast';
    lines.push(`<p class="lede">${Math.round(Math.min(...fut))}–${Math.round(Math.max(...fut))}°C over the next 12 hours${rainText}.</p>`);
    lines.push(`<p class="small muted">Hourly computer forecast: ${esc(ocfCredit())}.${popDay && popDay.ForecastChanceOfRain ? ` Chance of rain today (${esc(stName(src.pop))}): ${esc(popDay.ForecastChanceOfRain)}.` : ''}</p>`);
  } else {
    lines.push(E.ocf ? stErr("The hourly forecast couldn't be loaded", 'Details: ' + E.ocf + '. If the saved copy is "not found", the recorder has not published yet.') : stLoad('Loading the hourly forecast…'));
  }
  const pastN = slots.slice(0, 12).filter(s => isNum(s.t));
  if (pastN.length >= 2) lines.push(`<p class="small muted">Past 12 hours at the ${esc(region.temp)} station: ${Math.min(...past).toFixed(1)}–${Math.max(...past).toFixed(1)}°C, from ${pastN.length} of 12 hours recorded.</p>`);
  else if (pastN.length === 1) lines.push(`<p class="small muted">Only 1 of the past 12 hours has been recorded so far (${String(pastN[0].hh).padStart(2, '0')}:00, ${pastN[0].t.toFixed(1)}°C). More appear each time the recorder runs.</p>`);
  else lines.push(stEmpty('No past hours recorded yet', 'They appear once the recorder has been running for a while.'));
  $('#hourly-summary').innerHTML = lines.join('');
  const enough = slots.filter(s => isNum(s.t)).length >= 2;
  $('#hourly-toggle').hidden = !enough;
  if (!enough) { $('#hourly-chart').hidden = true; $('#hourly-toggle').setAttribute('aria-expanded', 'false'); $('#hourly-toggle').textContent = 'Show hour by hour'; }
  const g = slots.find(s => s.rain);
  $('#hourly-chart').innerHTML = hourlyChart(slots) +
    `<p class="legend">Solid line: temperature recorded at the ${esc(region.temp)} station. Dashed line: the Observatory's automatic computer forecast (${esc(ocfCredit())}). Gaps mean no reading was recorded for that hour. ` +
    `Icons: forecast conditions for each 3-hour block. Blue bars: rain at the ${g ? esc(g.rain.name) : ''} gauge, in mm, over roughly that hour (gauge totals are for 1-hour periods that can end up to 15 minutes after the hour; M means under maintenance).</p>`;
}
function scrollChartToNow() {
  const sc = document.querySelector('#hourly-chart .chart-scroll');
  if (sc) sc.scrollLeft = 12 * 40 + 20 - sc.clientWidth / 2;
}

/* ---------- Good times to be outside ---------- */
function heatIndexC(tc, rh) {
  // US National Weather Service heat index (Rothfusz regression with adjustments), converted to °C.
  const T = tc * 9 / 5 + 32;
  let hi = 0.5 * (T + 61 + ((T - 68) * 1.2) + rh * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T - 0.05481717 * rh * rh
       + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
    if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  }
  return (hi - 32) * 5 / 9;
}
function renderOutside() {
  const box = $('#outside-body');
  const O = ocfHours();
  if (!O.size) { box.innerHTML = E.ocf ? stErr('This needs the hourly forecast', "It couldn't be loaded (details under Next 24 hours).") : stLoad(); return; }
  const aq = aqhiWindows();
  const base = Math.floor(Date.now() / HOUR) * HOUR;
  const hrs = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(base + i * HOUR), hh = hkParts(d).hh;
    if (hh < GOOD.firstHour) continue;
    const f = O.get(hourKey(d));
    if (!f || !isNum(f.ForecastTemperature)) continue;
    const t = +f.ForecastTemperature, rh = isNum(f.ForecastRelativeHumidity) ? +f.ForecastRelativeHumidity : null;
    // Each 3-hourly icon is treated as covering the hour before and after its timestamp.
    const ic = [0, -1, 1].map(o => O.get(hourKey(new Date(d.getTime() + o * HOUR)))).map(x => x && x.ForecastWeather).find(Boolean);
    const hi = rh === null ? t : heatIndexC(t, rh);
    const air = aq.find(w => d.getTime() >= w.start && d.getTime() < w.end);
    const why = [];
    if (RAIN_ICONS.has(+ic)) why.push('rain');
    if (hi >= GOOD.maxHeatIndex) why.push('hot');
    if (t < GOOD.minTemp) why.push('cold');
    if (air && air.rank > GOOD.worstAir) why.push('air quality');
    hrs.push({d, hh, t, hi, why, ok: !why.length});
  }
  if (!hrs.length) { box.innerHTML = stEmpty('Not enough forecast hours to work this out'); return; }
  const wins = [];
  hrs.forEach(h => {
    const last = wins[wins.length - 1];
    if (h.ok && last && h.d - last.end === 0) { last.end = new Date(h.d.getTime() + HOUR); last.maxHi = Math.max(last.maxHi, h.hi); }
    else if (h.ok) wins.push({start: h.d, end: new Date(h.d.getTime() + HOUR), maxHi: h.hi});
  });
  const warn = S.warnsum && Object.entries(S.warnsum).some(([k, w]) => w && w.actionCode !== 'CANCEL' && ['WRAIN','WTCSGNL','WTS','WHOT','WCOLD','WL','WMSGNL','WFNTSA','WTMW'].includes(k));
  let h = warn ? '<p class="caution">Weather warnings are in force. Check them before going out; this list does not take them into account.</p>' : '';
  if (wins.length) {
    h += '<ul class="windows">' + wins.map(w => {
      const label = hkParts(w.start).d !== hkParts().d ? ' tomorrow' : '';
      return `<li><span class="win">${fmtTime(w.start)}–${fmtTime(w.end)}${label ? `<span class="small muted">${label}</span>` : ''}</span><span class="why">feels up to ${Math.round(w.maxHi)}°C</span></li>`;
    }).join('') + '</ul>';
  } else {
    const counts = {}; hrs.forEach(x => x.why.forEach(r => counts[r] = (counts[r] || 0) + 1));
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([r]) => r);
    h += `<p>No hour between ${String(GOOD.firstHour).padStart(2, '0')}:00 and midnight in the next 24 hours meets every condition. Main reason${main.length > 1 ? 's' : ''}: ${esc(main.join(', '))}.</p>`;
  }
  const hottest = hrs.reduce((a, b) => b.hi > a.hi ? b : a);
  if (hottest.hi >= GOOD.maxHeatIndex) h += `<p class="small muted">Hottest-feeling hour: ${fmtTime(hottest.d)}${hkParts(hottest.d).d !== hkParts().d ? ' tomorrow' : ''}, heat index about ${Math.round(hottest.hi)}°C.</p>`;
  const src = ocfSources();
  if (!src.wx) h += '<p class="caution">No nearby point has a rain forecast, so rain is not taken into account.</p>';
  if (!src.rh) h += '<p class="caution">No nearby point has a humidity forecast, so "feels like" uses temperature alone and will understate the heat.</p>';
  h += `<details class="flw"><summary>How this is worked out</summary><p class="small muted">Uses the Observatory's hourly computer forecast (${esc(ocfCredit())}). An hour counts if there's no rain forecast for that 3-hour block, the heat index (temperature and humidity combined into how hot it feels, using the US National Weather Service formula) stays below ${GOOD.maxHeatIndex}°C, it's at least ${GOOD.minTemp}°C, and air quality isn't forecast high or worse. UV isn't included because there is no UV forecast in the open data.</p></details>`;
  box.innerHTML = h;
}

function renderDays() {
  const days = S.fnd ? list(S.fnd.weatherForecast) : [];
  if (!days.length) { $('#days').innerHTML = `<li>${E.fnd ? stErr('The multi-day forecast is unavailable right now.', 'Details: ' + E.fnd) : stLoad()}</li>`; return; }
  $('#multiday-title').textContent = `Next ${days.length} days`;
  $('#fnd-sit').textContent = S.fnd.generalSituation || '';
  const lo = Math.min(...days.map(d => +d.forecastMintemp.value)), hi = Math.max(...days.map(d => +d.forecastMaxtemp.value));
  const span = Math.max(hi - lo, 1);
  $('#days').innerHTML = days.map((d, i) => {
    const mn = +d.forecastMintemp.value, mx = +d.forecastMaxtemp.value;
    const ds = String(d.forecastDate);
    const date = new Date(`${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}T12:00:00+08:00`);
    const dLabel = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, day: 'numeric', month: 'short'}).format(date);
    return `<li class="day"><button aria-expanded="false" data-i="${i}">
      <span class="dname">${esc(String(d.week || '').slice(0,3))}<span class="ddate">${dLabel}</span></span>
      ${wxIcon(d.ForecastIcon)}
      <span class="lo num">${mn}°</span>
      <span><span class="bar"><i data-sty="left:${(mn-lo)/span*100}%;width:${Math.max((mx-mn)/span*100,4)}%"></i></span>
        <span class="psr">${d.PSR ? `Significant rain: ${esc(String(d.PSR).toLowerCase())}` : ''}</span></span>
      <span class="num">${mx}°</span></button>
      <div class="more"><p>${esc(d.forecastWeather)}</p><p class="muted">${esc(d.forecastWind)}. Humidity ${esc(d.forecastMinrh.value)}–${esc(d.forecastMaxrh.value)}%.</p></div></li>`;
  }).join('');
  $('#days').querySelectorAll('.day > button').forEach(b => b.onclick = () => {
    const li = b.parentElement; const open = li.classList.toggle('open'); b.setAttribute('aria-expanded', open);
  });
}

function renderAcross() {
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const body = $('#across-body');
  if (tab === 'temp') {
    const T = temps();
    if (!T.size) { body.innerHTML = stEmpty('No temperature readings yet'); return; }
    const vals = [...T.values()].map(x => x.v), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 1);
    let h = '<ul class="xrows">';
    for (const area of AREAS) {
      h += `<li class="area">${area}</li>`;
      for (const r of REGIONS.filter(r => r.area === area)) {
        const t = tempFor(r, T);
        h += `<li class="${r.id === region.id ? 'here' : ''}"><button data-r="${r.id}">${esc(r.name)}</button>
          <span class="bar"><i data-sty="left:0;width:${t ? Math.max((t.v - lo) / span * 100, 3) : 0}%"></i></span>
          <span class="v">${t ? t.v.toFixed(1) + '°' : '–'}</span></li>`;
      }
    }
    body.innerHTML = h + '</ul><p class="small muted mt-m">Tap a place to make it your main view. Bars run from the coolest to the warmest station right now.</p>';
    body.querySelectorAll('button[data-r]').forEach(b => b.onclick = () => { setRegion(REGIONS.find(r => r.id === b.dataset.r)); window.scrollTo({top: 0, behavior: 'smooth'}); });
  } else if (tab === 'rain') {
    const rf = S.rhr && S.rhr.rainfall;
    if (!rf) { body.innerHTML = stEmpty('No rainfall report yet'); return; }
    const rows = list(rf.data), mx = Math.max(1, ...rows.map(d => +d.max || 0));
    body.innerHTML = `<p class="small muted">Highest rainfall recorded in each district, ${fmtTime(toDate(rf.startTime))}–${fmtTime(toDate(rf.endTime))}.</p><ul class="xrows">` +
      rows.map(d => `<li class="${norm(d.place) === norm(region.district) ? 'here' : ''}"><span>${esc(d.place)}</span>
        <span class="bar"><i class="rainbar" data-sty="left:0;width:${d.main === 'TRUE' ? 0 : (+d.max || 0) / mx * 100}%"></i></span>
        <span class="v">${d.main === 'TRUE' ? 'maint.' : (isNum(d.min) ? d.min + '–' : '') + d.max + ' mm'}</span></li>`).join('') + '</ul>';
  } else {
    if (!S.wind) { body.innerHTML = stEmpty('Wind readings are switched off', "The Observatory's wind feed can't be read by web pages, so this view stays empty for now."); return; }
    const rows = csvRows(S.wind);
    const here = findStation(rows, region.wind, r => r[1]);
    body.innerHTML = `<p class="small muted">10-minute mean wind, with the strongest gust. Arrows show where the wind is blowing to.</p><ul class="xrows">` +
      rows.map(r => {
        const [, name, dir, spd, gust] = r;
        const v = /n\/a/i.test(spd) ? 'N/A' : (/calm/i.test(dir) || spd === '') ? 'Calm' : `${spd} km/h`;
        return `<li class="${r === here ? 'here' : ''}"><span>${esc(name)}</span><span>${windArrow(dir)}${esc(dirShort(dir))}</span>
          <span class="v">${esc(v)}${isNum(gust) ? `<br><span class="small muted">g ${esc(gust)}</span>` : ''}</span></li>`;
      }).join('') + '</ul>';
  }
}

function renderSkySea() {
  const st = sunTimes(), mt = moonTimes(), td = tides();
  const fnd = S.fnd || {};
  let h = '<div class="pairs">';
  h += `<div><h3>Sunrise</h3><div class="big">${st ? fmtHHMM(st.rise) : '–'}</div></div>`;
  h += `<div><h3>Sunset</h3><div class="big">${st ? fmtHHMM(st.set) : '–'}</div></div>`;
  h += `<div><h3>Moonrise</h3><div class="big">${mt && mt.rise ? fmtHHMM(mt.rise) : '–'}</div></div>`;
  h += `<div><h3>Moonset</h3><div class="big">${mt && mt.set ? fmtHHMM(mt.set) : '–'}</div></div>`;
  const sea = fnd.seaTemp;
  if (sea && isNum(sea.value)) h += `<div><h3>Sea surface</h3><div class="big">${sea.value}°</div><div class="small muted">${esc(sea.place)}, ${fmtDateTime(toDate(sea.recordTime))}</div></div>`;
  list(fnd.soilTemp).forEach(s => { if (isNum(s.value)) h += `<div><h3>Soil, ${esc(s.depth && s.depth.value)} ${esc(s.depth && s.depth.unit)} down</h3><div class="big">${s.value}°</div><div class="small muted">${esc(s.place)}</div></div>`; });
  h += '</div>';
  h += `<h3 class="mt-l">Tides at ${esc(TIDE_NAMES[region.tide] || region.tide)} today</h3>`;
  if (td) h += `<div class="tides">${td.map(e => `<span><b>${e.high === null ? '' : e.high ? 'High' : 'Low'}</b> ${e.t} <span class="muted">${e.h.toFixed(1)} m</span></span>`).join('')}</div>
    <p class="small muted mt-s">Predicted astronomical tides. Real water levels can differ, especially in strong winds or storm surge.</p>`;
  else h += E.hlt ? stErr("Tide predictions aren't available", 'The open data service has none for this year right now.') : stLoad();
  $('#skysea-body').innerHTML = h;
}

function renderQuake() {
  const q = S.qem && !Array.isArray(S.qem) ? S.qem : list(S.qem)[0];
  const f = Array.isArray(S.felt) ? S.felt[0] : S.felt;
  let h = '';
  if (q && q.mag) h += `<h3>Latest quick earthquake message</h3><p>Magnitude ${esc(q.mag)}, ${esc(q.region)}. <span class="muted">${fmtDateTime(toDate(q.ptime))} HKT</span></p>`;
  else h += E.qem ? stErr('Earthquake information is unavailable right now.') : stEmpty('No recent quick earthquake message');
  if (f && (f.details || f.mag)) h += `<h3>Last tremor felt in Hong Kong</h3><p>${f.mag ? `Magnitude ${esc(f.mag)}, ${esc(f.region || '')}. ` : ''}${f.intensity ? `Intensity ${esc(f.intensity)}. ` : ''}<span class="muted">${fmtDateTime(toDate(f.ptime))}</span></p>` +
    list(f.details).map(p => `<p class="small">${esc(p)}</p>`).join('');
  $('#quake-body').innerHTML = h;
}

const SOURCE_NAMES = {rhr:'current weather', fnd:'9-day forecast', flw:'written forecast', warnsum:'warnings', warninfo:'warning details',
  swt:'weather tips', hourly:'rain gauges', ltmv:'visibility', srs:'sunrise', mrs:'moonrise', hlt:'tides', qem:'earthquakes',
  felt:'felt tremors', wind:'wind', temp:'1-minute temperatures', hum:'humidity', ocf:'hourly forecast', aqhi:'air quality',
  hist:'recorded history (GitHub Action)'};
function renderFooter() {
  const failed = Object.keys(E);
  $('#footer-time').innerHTML = lastFetch
    ? `Last checked ${fmtTime(lastFetch)} (${ago(lastFetch)}).${failed.length ? ` Some sources didn't respond: ${esc(failed.map(k => SOURCE_NAMES[k] || k).join(', '))}.` : ''}`
    : '';
  const st = $('#status');
  if (lastFetch && Date.now() - lastFetch > 20 * 60000) st.innerHTML = HK.state('stale', {title: `Showing saved data from ${fmtDateTime(lastFetch)}`, body: 'Live data will replace it as soon as the Observatory answers.', compact: true});
  else if (lastFetch) st.innerHTML = '';
}

function renderPicker() {
  const T = temps();
  $('#picker-body').innerHTML = AREAS.map(a => `<h3>${a}</h3><ul>` + REGIONS.filter(r => r.area === a).map(r => {
    const t = tempFor(r, T);
    return `<li><button data-r="${r.id}" aria-current="${r.id === region.id}"><span>${esc(r.name)}</span><span class="num muted">${t ? t.v.toFixed(1) + '°' : ''}</span></button></li>`;
  }).join('') + '</ul>').join('');
  $('#picker-body').querySelectorAll('button[data-r]').forEach(b => b.onclick = () => { $('#picker').close(); setRegion(REGIONS.find(r => r.id === b.dataset.r)); });
}

/* =========================================================================
   WIRING
   ========================================================================= */
$('#place-btn').onclick = () => { renderPicker(); $('#picker').showModal(); };
$('#picker-close').onclick = () => $('#picker').close();
$('#picker').addEventListener('click', e => { if (e.target === $('#picker')) $('#picker').close(); });
$('#refresh').onclick = refresh;
HK.onRetry($('#status'), refresh);
$('#hourly-toggle').onclick = () => {
  const c = $('#hourly-chart'), b = $('#hourly-toggle'), open = c.hidden;
  c.hidden = !open; b.setAttribute('aria-expanded', open); b.textContent = open ? 'Hide hour by hour' : 'Show hour by hour';
  if (open) scrollChartToNow();
};
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderAcross(); });
window.addEventListener('hashchange', () => { const r = pickRegion(); if (r !== region) setRegion(r); });

let timer = setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(timer); return; }
  timer = setInterval(refresh, REFRESH_MS);
  if (!lastFetch || Date.now() - lastFetch > 2 * 60000) refresh();
});

// Show the last saved data instantly (if any), then fetch fresh data.
try {
  const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (c && c.S) { S = c.S; lastFetch = new Date(c.t); }
} catch (e) {}
renderAll();
refresh();
})();
