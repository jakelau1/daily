// Trail closures. Fetched live from AFCD's dataset on the CSDI Portal once per visit; if
// that fails, or the data doesn't make sense, the saved copy from the pipeline is used.
import { CLOSURES_LIVE_URL, CLOSURES_TIMEOUT_MS, HK_LAT, HK_LON, DATA } from './config.js';
import { loadJSON } from './data.js';
import { afcdDate } from './format.js';

const inHK = ([lon, lat]) => lat >= HK_LAT[0] && lat <= HK_LAT[1] && lon >= HK_LON[0] && lon <= HK_LON[1];

// Applies fn to every [x, y] pair in a LineString or MultiLineString.
function mapCoords(geom, fn) {
  const line = l => l.map(fn);
  if (geom?.type === 'LineString') return { type: geom.type, coordinates: line(geom.coordinates) };
  if (geom?.type === 'MultiLineString') return { type: geom.type, coordinates: geom.coordinates.map(line) };
  throw new Error(`unexpected geometry ${geom?.type}`);
}
const allCoords = geom => geom.type === 'LineString' ? geom.coordinates : geom.coordinates.flat();

// This server can return latitude/longitude in either order. Every coordinate must land in
// Hong Kong, as given or with the two numbers swapped; otherwise the live data is rejected.
export function checkCoordinates(geom) {
  const pts = allCoords(geom);
  if (!pts.length || pts.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) throw new Error('bad coordinates');
  if (pts.every(inHK)) return geom;
  if (pts.every(([a, b]) => inHK([b, a]))) return mapCoords(geom, ([a, b]) => [b, a]);
  throw new Error('coordinates outside Hong Kong');
}

// One tidy record per closure, the same shape whether it came live or from the saved copy.
function normalise(f) {
  const p = f.properties || {};
  if (!p.TRAIL_ID || !p.STATUS_TC) throw new Error('closure without trail ID or status');
  const afcdEn = (p.status_en || p.STATUS_EN || '').trim();
  const statusEn = p.STATUS_TC.trim() === '暫停使用' ? 'Suspended from use'   // approved wording
    : /^temporary closed$/i.test(afcdEn) ? 'Temporarily closed'                 // AFCD's "Temporary closed"
    : afcdEn;
  const kind = /diversion|改道/i.test(statusEn + p.STATUS_TC) ? 'diversion' : 'closed';
  return {
    trailId: p.TRAIL_ID.trim(),
    nameEn: (p.TRAIL_NAME_EN || '').trim(), nameTc: (p.TRAIL_NAME_TC || '').trim(),
    statusEn, statusTc: p.STATUS_TC.trim(), kind,
    partial: /\(partial\)|（部分）|\(部分\)/i.test(`${p.TRAIL_NAME_EN} ${p.TRAIL_NAME_TC}`),
    since: afcdDate(p.EFFECTIVE_DATE), sinceRaw: p.EFFECTIVE_DATE,
    until: (p.EXPECTED_EXPIRY_DATE || '').trim(),
    geometry: checkCoordinates(f.geometry),
  };
}

async function fetchLive() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CLOSURES_TIMEOUT_MS);
  try {
    const r = await fetch(CLOSURES_LIVE_URL, { signal: ctl.signal, referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j?.features)) throw new Error('no features list');
    return j.features.map(normalise);
  } finally { clearTimeout(timer); }
}

// Returns { items, source: 'live' | 'snapshot', asOf: Date, liveError }.
export async function loadClosures() {
  try {
    return { items: await fetchLive(), source: 'live', asOf: new Date() };
  } catch (liveError) {
    console.warn('Live closures unavailable, using saved copy:', liveError.message);
    const snap = await loadJSON(DATA.closures);
    return { items: snap.features.map(normalise), source: 'snapshot', asOf: new Date(snap.snapshot_downloaded_at), liveError };
  }
}

// How a route is affected: 'closed', 'partly' (closed in part), 'diversion', or null.
export function routeStatus(items) {
  if (!items.length) return null;
  if (items.some(c => c.kind === 'closed' && !c.partial)) return 'closed';
  if (items.some(c => c.kind === 'closed')) return 'partly';
  return 'diversion';
}

export function byTrail(items) {
  const m = new Map();
  for (const c of items) (m.get(c.trailId) || m.set(c.trailId, []).get(c.trailId)).push(c);
  return m;
}
