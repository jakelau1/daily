// The map: Lands Department base map and labels, the required credit, trail lines, the
// selected route, and closures. Uses Leaflet (the global L), loaded before this module.
import { BASEMAP_URL, LABEL_URL, MIN_ZOOM, MAX_ZOOM, HK_BOUNDS, TILE_BOUNDS, LANDSD_DISCLAIMER_URL } from './config.js';
import { esc, dateText } from './format.js';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wide = matchMedia('(min-width: 60rem)');

export function createMap(el) {
  const map = L.map(el, {
    zoomControl: false, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
    maxBounds: HK_BOUNDS, maxBoundsViscosity: 0.8, attributionControl: false,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);

  // Map API terms: no large bursts of requests. Leaflet only asks for the tiles on screen,
  // and these settings stop it asking for tiles during zoom animations.
  const tileOptions = { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, bounds: TILE_BOUNDS, updateWhenZooming: false };
  L.tileLayer(BASEMAP_URL, { ...tileOptions, className: 'basemap' }).addTo(map);

  // Panes, bottom to top: trails, selected route, closures, place names, then Leaflet's markers.
  for (const [name, z] of [['highlight', 410], ['closures', 420], ['labels', 450]]) {
    map.createPane(name).style.zIndex = z;
  }
  map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(LABEL_URL, { ...tileOptions, pane: 'labels', className: 'labels' }).addTo(map);

  // The Lands Department's logo and notice must be on the map face. On phones the route
  // panel covers the bottom of the map, so the credit sits at the top left there.
  const credit = L.control.attribution({ prefix: false });
  credit.addAttribution(
    `<a class="landsd-credit" href="${LANDSD_DISCLAIMER_URL}" target="_blank" rel="noopener noreferrer">` +
    '&copy; Map from Lands Department<span class="landsd-logo" role="img" aria-label="Lands Department logo"></span></a>');
  const place = () => credit.setPosition(wide.matches ? 'bottomright' : 'topleft');
  place(); credit.addTo(map);
  wide.addEventListener('change', place);
  return map;
}

// ---------- Trail lines ----------

let trailLayer, routesRef, onPick;

// All routes as green lines with a thin edge (white on the light map, dark on the dark one).
// Tapping near one or more lines picks a route; where several lines meet, a small menu asks which one.
export function drawTrails(map, routes, pick) {
  routesRef = routes; onPick = pick;
  const renderer = L.canvas({ padding: 0.3 });
  const features = { type: 'FeatureCollection', features: [...routes.values()].map(r => r.feature) };
  const edge = L.geoJSON(features, { renderer, interactive: false,
    style: { weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' } });
  const line = L.geoJSON(features, { renderer, interactive: false,
    style: { weight: 3, opacity: 1, lineCap: 'round', lineJoin: 'round' } });
  trailLayer = L.layerGroup([edge, line]).addTo(map);
  trailLayer.line = line; trailLayer.edge = edge;
  trailColours();
  map.on('click', e => chooseAt(map, e));
  return line.getBounds();
}

// Sets the trail colours from the page's current colours; called again when they change.
export function trailColours() {
  trailLayer?.line.setStyle({ color: css('--trail') });
  trailLayer?.edge.setStyle({ color: css('--trail-edge') });
}

function routesNear(map, latlng, px = 14) {
  const p = map.latLngToLayerPoint(latlng), found = [];
  for (const r of routesRef.values()) {
    const g = r.feature.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    let best = Infinity;
    for (const ln of lines) {
      let prev = null;
      for (const [lon, lat] of ln) {
        const q = map.latLngToLayerPoint([lat, lon]);
        if (prev) best = Math.min(best, L.LineUtil.pointToSegmentDistance(p, prev, q));
        prev = q;
      }
    }
    if (best <= px) found.push([best, r]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

function chooseAt(map, e) {
  const near = routesNear(map, e.latlng);
  if (!near.length) return;
  if (near.length === 1) return onPick(near[0].id);
  const html = '<h4>Which route?</h4>' + near.slice(0, 8).map(r =>
    `<p><button type="button" class="back-btn" data-route="${esc(r.id)}">${esc(r.p.name_en)}</button></p>`).join('');
  const pop = L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(html).openOn(map);
  pop.getElement().addEventListener('click', ev => {
    const id = ev.target.closest('[data-route]')?.dataset.route;
    if (id) { map.closePopup(pop); onPick(id); }
  });
}

// ---------- Selected route ----------

let selected = null, scrubDot = null, path = null;

// Highlights one route, dims the others, and marks where the chosen direction starts.
export function showRoute(map, r, dirKey, dirInfo) {
  clearRoute(map);
  trailLayer.line.setStyle({ opacity: 0.45 }); trailLayer.edge.setStyle({ opacity: 0.4 });
  const opts = { pane: 'highlight', interactive: false, lineCap: 'round', lineJoin: 'round' };
  const edge = L.geoJSON(r.feature, { style: { ...opts, color: css('--route-edge'), weight: 9, opacity: 1 } });
  const line = L.geoJSON(r.feature, { style: { ...opts, color: css('--route'), weight: 5, opacity: 1 } });
  const layers = [edge, line];

  // Start / finish labels for the chosen direction, above the place names. For branching
  // routes these are the ends of the profiled path.
  const [a, b] = dirKey === 'forward' ? [r.s.start, r.s.end] : [r.s.end, r.s.start];
  const label = (ll, text, cls) => L.marker([ll[1], ll[0]], { interactive: false, keyboard: false, zIndexOffset: 1000,
    icon: L.divIcon({ className: 'divicon-reset', iconSize: null, html: `<span class="end-label ${cls}">${esc(text)}</span>` }) });
  if (dirInfo.kind === 'branching') layers.push(label(a, 'Profile start', ''), label(b, 'Profile end', 'finish'));
  else if (r.s.loop) layers.push(label(a, dirInfo.startVerified ? 'Start & finish' : 'Start & finish (not verified)', ''));
  else if (dirInfo.kind === 'confirmed') layers.push(label(a, 'Start', ''), label(b, 'Finish', 'finish'));
  else layers.push(label(a, 'This end first', ''), label(b, 'Other end', 'finish'));
  selected = L.layerGroup(layers).addTo(map);

  // For moving along the profile: the line as a list of points, measured from the start.
  path = r.s.branching ? null : measure(r.feature.geometry.coordinates, dirKey === 'reverse');
  return line.getBounds();
}

export function clearRoute(map) {
  if (selected) map.removeLayer(selected);
  if (scrubDot) map.removeLayer(scrubDot);
  selected = scrubDot = path = null;
  trailLayer?.line.setStyle({ opacity: 1 }); trailLayer?.edge.setStyle({ opacity: 0.85 });
}

function measure(coords, reverse) {
  const c = reverse ? [...coords].reverse() : coords;
  const out = [[0, c[0]]];
  for (let i = 1; i < c.length; i++) {
    const [lon1, lat1] = c[i - 1], [lon2, lat2] = c[i];
    const k = Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    out.push([out[i - 1][0] + Math.hypot((lon2 - lon1) * 111320 * k, (lat2 - lat1) * 110574), c[i]]);
  }
  return out;
}

// Shows the spot `d` metres along the profile (profileLength long) on the map. The web copy
// of each line is simplified, so positions are scaled to fit: approximate, not surveyed.
export function scrubTo(map, d, profileLength) {
  if (d == null || !path) { if (scrubDot) { map.removeLayer(scrubDot); scrubDot = null; } return; }
  const target = d / profileLength * path[path.length - 1][0];
  const i = Math.max(1, path.findIndex(p => p[0] >= target));
  const [d0, a] = path[i - 1], [d1, b] = path[Math.min(i, path.length - 1)];
  const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
  const ll = [a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t];
  if (!scrubDot) scrubDot = L.circleMarker(ll, { pane: 'highlight', radius: 7, weight: 3, color: css('--route-edge'), fillColor: css('--route'), fillOpacity: 1, interactive: false }).addTo(map);
  else scrubDot.setLatLng(ll);
}

// ---------- Closures ----------

// Closed sections as red dashed lines (diversions amber, with longer gaps), each with an
// edge, and a description when tapped. Partial closures show only the closed part.
// Drawn into `group`, which the layer switcher turns on and off.
export function drawClosures(group, items, routes) {
  group.clearLayers();
  const renderer = L.svg({ pane: 'closures' });
  const layers = [];
  for (const c of items) {
    const feature = { type: 'Feature', geometry: c.geometry, properties: {} };
    const colour = c.kind === 'diversion' ? css('--diversion') : css('--closed');
    layers.push(L.geoJSON(feature, { renderer, pane: 'closures', interactive: false, style: { color: css('--closure-edge'), weight: 8, opacity: 0.95 } }));
    const line = L.geoJSON(feature, { renderer, pane: 'closures', bubblingMouseEvents: false,
      style: { color: colour, weight: 4.5, opacity: 1, dashArray: c.kind === 'diversion' ? '2 7' : '7 5', lineCap: 'butt' } });
    line.bindPopup(closurePopup(c, routes.get(c.trailId)), { maxWidth: 280 });
    layers.push(line);
  }
  layers.forEach(l => group.addLayer(l));
}

export function closurePopup(c, route) {
  const since = c.since ? `Since ${dateText(c.since)}` : '';
  const until = /further notice/i.test(c.until) ? 'until further notice' : (c.until ? `expected until ${esc(c.until)}` : '');
  // AFCD's diversion line lies on the route itself: it marks the section being diverted
  // around, not the way round it, so the wording must not invite anyone to follow it.
  if (c.kind === 'diversion') return `<h4>This section is diverted</h4>`
    + `<p>${esc(c.nameEn)}<br><span class="muted">${esc(c.nameTc)}</span></p>`
    + `<p>${since ? `${since}. ` : ''}Follow the diversion signs on site. This line marks the section being diverted, not the way round it.</p>`
    + (route ? `<p><a href="#${esc(route.id)}">Route details</a></p>` : '');
  return `<h4>${esc(c.statusEn)} · ${esc(c.statusTc)}</h4>`
    + `<p>${esc(c.nameEn)}<br><span class="muted">${esc(c.nameTc)}</span></p>`
    + `<p>${[since, until].filter(Boolean).join(', ')}</p>`
    + (route ? `<p><a href="#${esc(route.id)}">Route details</a></p>` : '');
}

// Opening view: all trails in the space above the panel. On a phone the map can't zoom out
// far enough to fit them side to side, so there is spare room above and below; the trails
// are lined up near the top, so the spare room is sea to the south rather than blank
// mainland to the north.
export function fitOpening(map, bounds, padding) {
  map.fitBounds(bounds, { paddingTopLeft: padding.topLeft, paddingBottomRight: padding.bottomRight, animate: false });
  const top = map.latLngToContainerPoint(bounds.getNorthWest()).y;
  const want = padding.topLeft[1];
  if (top > want) map.panBy([0, top - want], { animate: false });
}

export function fit(map, bounds, padding) {
  map.fitBounds(bounds, { paddingTopLeft: padding.topLeft, paddingBottomRight: padding.bottomRight, animate: !reducedMotion(), maxZoom: 16 });
}
