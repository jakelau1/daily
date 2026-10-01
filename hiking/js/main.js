// Hiking page start-up, and moving between the route list, a route, and "About".
// The address bar follows along (#lt_3, #about), so the back button and shared links work.
import { DATA, HK_BOUNDS } from './config.js';
import { loadJSON } from './data.js';
import { createMap, drawTrails, trailColours, showRoute, clearRoute, scrubTo, drawClosures, fit, fitOpening } from './map.js';
import { buildRoutes, directions } from './routes.js';
import { loadClosures, routeStatus, byTrail } from './closures.js';
import { addLayerControls } from './layers.js';
import './theme.js';
import { renderList, renderRoute, renderAbout, updateClosureNote, setSize, coverFor, focusHeading } from './panel.js';

const statusEl = document.getElementById('status');
function setStatus(text, isError = false) {
  statusEl.textContent = text; statusEl.classList.toggle('err', isError);
  clearTimeout(setStatus.t);
  if (text && isError) setStatus.t = setTimeout(() => setStatus(''), 6000);
}

const map = createMap(document.getElementById('map'));
const state = { routes: null, closures: null, closureMap: new Map(), trailsBounds: null, dir: new Map(), fromList: false, view: null };

// Room the map should leave for the panel when framing something.
// Room the map should leave around a route: enough for the Start/Finish labels (centred on
// the route's ends) to show in full, clear of the credit box, the buttons and the panel.
const padding = size => ({ topLeft: [70, 84], bottomRight: [70, coverFor(size) + 36] });

const ctx = {
  get routes() { return state.routes; },
  get closures() { return state.closures; },
  statusOf: id => routeStatus(state.closureMap.get(id) || []),
  closuresFor: id => state.closureMap.get(id) || [],
  onOpen: id => { state.fromList = true; location.hash = id; },
  onBack: () => { if (state.fromList && history.length > 1) history.back(); else location.hash = ''; },
  onDirection: key => { state.dir.set(currentRouteId(), key); openRoute(currentRouteId(), false); },
  onScrub: (d, len) => scrubTo(map, d, len),
};
const currentRouteId = () => decodeURIComponent(location.hash.slice(1));

function openRoute(id, refit = true) {
  const r = state.routes.get(id);
  const key = state.dir.get(id) || 'forward';
  if (refit && state.view !== 'route') setSize('half');
  state.view = 'route';
  renderRoute(ctx, r, key);
  const bounds = showRoute(map, r, key, directions(r));
  if (refit) { fit(map, bounds, padding('half')); focusHeading(); }
}

function route() {
  map.closePopup();
  const h = currentRouteId();
  if (h === 'about' || h.startsWith('about-')) {
    clearRoute(map);
    state.view = 'about';
    setSize('full');
    renderAbout({ ...ctx, attribution: state.attribution, manifest: state.manifest });
    const anchor = h !== 'about' && document.getElementById(h);
    if (anchor) anchor.scrollIntoView({ block: 'start' }); else focusHeading();
    return;
  }
  if (state.routes.has(h)) return openRoute(h);
  const was = state.view;
  clearRoute(map);
  state.view = 'list';
  renderList(ctx);
  if (was === 'route' || was === 'about') setSize(was === 'about' ? 'peek' : 'half');
  state.fromList = false;
}

function pick(id) { state.fromList = state.view === 'list'; location.hash = id; }

async function start() {
  const [trails, stats, attribution, manifest] = await Promise.all(
    [DATA.trails, DATA.stats, DATA.attribution, DATA.manifest].map(loadJSON));
  state.routes = buildRoutes(trails, stats);
  state.attribution = attribution; state.manifest = manifest;
  state.trailsBounds = drawTrails(map, state.routes, pick);

  // Opening view: all trails, framed in the space above the panel.
  if (!state.routes.has(currentRouteId())) fitOpening(map, state.trailsBounds, padding('peek'));
  setStatus('');
  const closureGroup = L.layerGroup().addTo(map);
  addLayerControls(map, closureGroup, setStatus);
  // When the colours change, redraw the lines in the new colours.
  window.addEventListener('themechange', () => {
    trailColours();
    if (state.closures) drawClosures(closureGroup, state.closures.items, state.routes);
    if (state.view === 'route') openRoute(currentRouteId(), false);
  });
  window.addEventListener('hashchange', route);
  route();

  // Closures arrive a moment later (fetched live once per visit, or the saved copy).
  const cl = await loadClosures();
  state.closures = cl;
  state.closureMap = byTrail(cl.items);
  drawClosures(closureGroup, cl.items, state.routes);
  if (state.view === 'list') renderList(ctx); else if (state.view === 'route') openRoute(currentRouteId(), false); else updateClosureNote(cl);
}

start().catch(e => {
  map.fitBounds(HK_BOUNDS);
  setStatus('Couldn’t load the trails. Please try again later.', true);
  clearTimeout(setStatus.t);
  console.error(e);
});
