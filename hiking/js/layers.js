// Layers that can be switched on and off: closures, campsites, visitor centres, distance
// posts; and the "My location" button.
import { DATA, POSTS_MIN_ZOOM } from './config.js';
import { loadJSON } from './data.js';
import { esc, titleCase } from './format.js';

const pin = (cls, text, title) => ({
  keyboard: true, title, alt: title, riseOnHover: true,
  icon: L.divIcon({ className: 'divicon-reset', iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
    html: `<span class="pin ${cls}" aria-hidden="true">${text}</span>` }),
});
const ll = f => [f.geometry.coordinates[1], f.geometry.coordinates[0]];
// "Excluded Area" and "Outside Country Park and Special Area" aren't parks; they are left
// out, as for routes (DECISIONS.md, Checkpoint 2).
const NOT_PARKS = /^(excluded area|outside country park and special area)$/i;
const parkLine = (en, tc) => en && !NOT_PARKS.test(en.trim()) ? `<p><b>Park:</b> ${both(titleCase(en), tc)}</p>` : '';
const both = (en, tc) => `${esc(en)}${tc ? `<br><span class="muted">${esc(tc)}</span>` : ''}`;

async function campsites() {
  const d = await loadJSON(DATA.campsites);
  return L.layerGroup(d.features.map(f => {
    const p = f.properties;
    return L.marker(ll(f), pin('camp', '⛺', p.SITE_NAME_EN)).bindPopup(
      `<h4>${both(p.SITE_NAME_EN, p.SITE_NAME_TC)}</h4>`
      + `<p><b>Water:</b> ${both(titleCase(p.SOURCE_OF_WATER_EN), p.SOURCE_OF_WATER_TC)}</p>`
      + `<p><b>Tent space:</b> ${esc(p.TENT_SPACE_EN)}${p.TENT_SPACE_TC ? ` · ${esc(p.TENT_SPACE_TC)}` : ''}</p>`
      + parkLine(p.COUNTRY_PARK_EN, p.COUNTRY_PARK_TC), { maxWidth: 260 });
  }));
}

async function visitorCentres() {
  const d = await loadJSON(DATA.visitorCentres);
  return L.layerGroup(d.features.map(f => {
    const p = f.properties;
    return L.marker(ll(f), pin('visitor', 'i', p.FACILITY_NAME_EN)).bindPopup(
      `<h4>${both(p.FACILITY_NAME_EN, p.FACILITY_NAME_TC)}</h4>`
      + `<p><b>Hours:</b> ${esc(p.SERVICE_HOUR_EN)} <span class="muted">(AFCD gives opening hours in English only)</span></p>`
      + (p.REMARK_EN || p.REMARK_TC ? `<p>${both(p.REMARK_EN, p.REMARK_TC)}</p>` : '')
      + parkLine(p.COUNTRY_PARK_EN, p.COUNTRY_PARK_TC), { maxWidth: 280 });
  }));
}

// Distance posts: 1,078 of them, so the file loads only when first switched on, and posts are
// drawn only when zoomed in far enough to read, and only those on screen.
function postsLayer(map, onHint) {
  const group = L.layerGroup();
  let feats = null, shown = new Map();
  const refresh = () => {
    if (!feats || !map.hasLayer(group)) return;
    const tooFar = map.getZoom() < POSTS_MIN_ZOOM;
    onHint(tooFar);
    const b = map.getBounds().pad(0.2), want = new Set();
    if (!tooFar) for (const f of feats) if (b.contains(ll(f))) want.add(f);
    for (const [f, m] of shown) if (!want.has(f)) { group.removeLayer(m); shown.delete(f); }
    for (const f of want) if (!shown.has(f)) {
      const p = f.properties, unsure = p.position_may_be_inaccurate;
      const m = L.marker(ll(f), { keyboard: true, title: `Distance post ${p.FAC_ID}`,
        icon: L.divIcon({ className: 'divicon-reset', iconSize: null, html: `<span class="post${unsure ? ' unsure' : ''}">${esc(p.FAC_ID)}</span>` }) })
        .bindPopup(`<h4>Distance post ${esc(p.FAC_ID)}</h4><p>${both(titleCase(p.TRAIL_NAME_EN), p.TRAIL_NAME_TC)}</p>`
          + (unsure ? '<p><b>Position may be inaccurate.</b></p>' : ''));
      group.addLayer(m); shown.set(f, m);
    }
  };
  group.on('add', async () => {
    if (!feats) feats = (await loadJSON(DATA.posts)).features;
    refresh();
  });
  group.on('remove', () => { for (const m of shown.values()) group.removeLayer(m); shown.clear(); onHint(false); });
  map.on('moveend zoomend', refresh);
  return group;
}

const ICON_LAYERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/></svg>';
const ICON_LOCATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

// The layer switcher and "My location" button, top right under the zoom buttons.
export function addLayerControls(map, closureLayer, setStatus) {
  const loaders = { campsites: () => campsites(), visitors: () => visitorCentres() };
  const made = { closures: closureLayer };
  // While the posts layer is on but the map is too far out, say so on the map itself too
  // (the hint in the layers box is hidden once the box is closed).
  const mapHint = document.getElementById('map-hint');
  const posts = postsLayer(map, tooFar => { hint.hidden = !tooFar; mapHint.hidden = !tooFar; });
  made.posts = posts;

  const Ctl = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      div.innerHTML = `<button type="button" class="map-btn" aria-expanded="false" aria-controls="layers-box" title="Map layers" aria-label="Map layers">${ICON_LAYERS}</button>`
        + `<button type="button" class="map-btn" aria-pressed="false" title="My location" aria-label="Show my location">${ICON_LOCATE}</button>`;
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  const ctl = new Ctl({ position: 'topright' }).addTo(map);
  const [layersBtn, locBtn] = ctl.getContainer().querySelectorAll('button');

  const Box = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create('div', 'layers-box');
      div.id = 'layers-box'; div.hidden = true;
      div.innerHTML = `<label><input type="checkbox" data-layer="closures" checked> Closures</label>`
        + `<label><input type="checkbox" data-layer="campsites"> Campsites</label>`
        + `<label><input type="checkbox" data-layer="visitors"> Visitor centres</label>`
        + `<label><input type="checkbox" data-layer="posts"> Distance posts</label>`
        + `<p class="hint" hidden>Zoom in to see the posts.</p>`;
      L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
      return div;
    },
  });
  const box = new Box({ position: 'topright' }).addTo(map).getContainer();
  const hint = box.querySelector('.hint');
  layersBtn.addEventListener('click', () => {
    box.hidden = !box.hidden; layersBtn.setAttribute('aria-expanded', String(!box.hidden));
  });
  box.addEventListener('change', async e => {
    const key = e.target.dataset.layer;
    try {
      if (!made[key]) made[key] = await loaders[key]();
      if (e.target.checked) made[key].addTo(map); else map.removeLayer(made[key]);
    } catch (err) {
      e.target.checked = false; setStatus('Couldn’t load that layer. Please try again.', true); console.error(err);
    }
  });

  // My location: asks the browser only when pressed. The position is used on this device
  // only; the page never sends it anywhere.
  let me = null;
  locBtn.addEventListener('click', () => {
    if (me) { map.removeLayer(me); me = null; locBtn.setAttribute('aria-pressed', 'false'); return; }
    if (!('geolocation' in navigator)) return setStatus('This browser can’t share your location.', true);
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      me = L.layerGroup([
        L.circle([lat, lon], { radius: accuracy, weight: 1, color: '#1a73e8', fillOpacity: 0.12, interactive: false }),
        L.marker([lat, lon], { keyboard: false, title: 'You are here', icon: L.divIcon({ className: 'divicon-reset', iconSize: [18, 18], iconAnchor: [9, 9], html: '<span class="pin location"></span>' }) }),
      ]).addTo(map);
      locBtn.setAttribute('aria-pressed', 'true');
      setStatus('');
      if (map.options.maxBounds.contains([lat, lon])) map.setView([lat, lon], Math.max(map.getZoom(), 15));
      else setStatus('You seem to be outside the area this map covers.', true);
    }, err => {
      setStatus(err.code === 1 ? 'Location permission was not given.' : 'Couldn’t find your location.', true);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}
