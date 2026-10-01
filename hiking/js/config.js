// Settings shared by the Hiking page. Every outside server the page contacts is listed
// here, and must also be allowed in the Content-Security-Policy in ../index.html.

// Lands Department Map API (checked 2026-09-28):
//   https://portal.csdi.gov.hk/csdi-webpage/apidoc/TopographicMapAPI
//   https://portal.csdi.gov.hk/csdi-webpage/apidoc/MapLabelAPI
// "Old versions will be removed at any time without notice", so if the map goes blank,
// check the version on those pages first.
export const MAP_API_VERSION = 'v1.0.0';
const MAP_API = `https://mapapi.geodata.gov.hk/gs/api/${MAP_API_VERSION}/xyz`;
export const BASEMAP_URL = `${MAP_API}/basemap/WGS84/{z}/{x}/{y}.png`;
export const LABEL_URL = `${MAP_API}/label/hk/en/WGS84/{z}/{x}/{y}.png`;  // the site is in English
export const MIN_ZOOM = 10;   // the topographic map covers zoom 10-20
export const MAX_ZOOM = 20;

// How far the map can be moved: Hong Kong, with room to the south. On a tall phone screen
// the zoomed-out view is taller than Hong Kong; the extra room lets the opening view put the
// trails near the top, with sea below. South of the tiles (about 21.7) the map background,
// which is the tiles' own sea colour, shows instead; no tiles are requested there.
export const HK_BOUNDS = [[21.45, 113.80], [22.58, 114.45]];
// Where tiles are requested: a little wider than HK_BOUNDS, so the edges of the screen
// aren't left blank when zoomed out. Leaflet still asks only for the tiles on screen.
export const TILE_BOUNDS = [[21.85, 113.45], [22.85, 114.80]];

// Copyright notice and logo required by the Map API terms, in the form used by
// LandsD's own sample code.
export const LANDSD_DISCLAIMER_URL = 'https://api.portal.hkmapservice.gov.hk/disclaimer';

// Live closures: AFCD "Closed Trails in Country Parks" on the CSDI Portal (dataset
// afcd_rcd_1742550096880_1424). Fetched once per visit; if it fails or looks wrong, the page
// uses the saved copy in data/closed_trails.geojson and shows that copy's date.
export const CLOSURES_LIVE_URL = 'https://portal.csdi.gov.hk/server/services/common/afcd_rcd_1742550096880_1424/MapServer/WFSServer'
  + '?service=WFS&version=2.0.0&request=GetFeature&typeNames=csdi:CPISDBOCLOSED_TRAIL_IN_CP_GDB'
  + '&outputFormat=GEOJSON&srsName=EPSG:4326&count=1000';
// The whole download must finish within this time (it usually takes about 1 second),
// otherwise the saved copy is used.
export const CLOSURES_TIMEOUT_MS = 6000;
// Roughly where Hong Kong is. Every live coordinate must fall in here (after swapping
// latitude and longitude if the server returned them the other way round).
export const HK_LAT = [22.1, 22.6];
export const HK_LON = [113.8, 114.5];

// Distance posts appear from this zoom level, when their labels are readable.
export const POSTS_MIN_ZOOM = 15;

// Pipeline output, copied into ./data/ (see the website README).
export const DATA = {
  trails: 'data/trails.geojson',
  stats: 'data/route_stats.json',
  closures: 'data/closed_trails.geojson',
  posts: 'data/distance_posts.geojson',
  campsites: 'data/campsites.geojson',
  visitorCentres: 'data/visitor_centres.geojson',
  attribution: 'data/attribution.json',
  manifest: 'data/manifest.json',
};
