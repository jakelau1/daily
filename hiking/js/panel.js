// The route panel: a pull-up sheet on phones, a side panel on computers. Shows the route
// list (with search and filters), one route's details, or "About this page".
import { esc, km, duration, dateText, timeText, difficultyHTML, titleCase } from './format.js';
import { listEntries, filterOptions, matches, endsNote, directions } from './routes.js';
import { routeStatus } from './closures.js';
import { renderProfile } from './profile.js';

const panel = document.getElementById('panel');
const body = document.getElementById('panel-body');
const handle = document.getElementById('handle');
const wide = matchMedia('(min-width: 60rem)');

// ---------- Sheet size (phones) ----------

const SIZES = ['peek', 'half', 'full'];
export function setSize(size) {
  panel.dataset.size = size;
  handle.setAttribute('aria-label', size === 'full' ? 'Show more of the map' : 'Show more of the route panel');
}
export const panelCover = () => wide.matches ? 0 : panel.getBoundingClientRect().height;
export function coverFor(size) {       // how much of the map a given sheet size covers, in px
  if (wide.matches) return 0;
  const h = panel.parentElement.clientHeight;
  return size === 'peek' ? parseFloat(getComputedStyle(panel).getPropertyValue('--sheet-peek')) * 16 || 216 : size === 'half' ? h * 0.52 : h - 16;
}
handle.addEventListener('click', () => {
  if (handle.dataset.dragged) { delete handle.dataset.dragged; return; }
  setSize(SIZES[(SIZES.indexOf(panel.dataset.size) + 1) % SIZES.length]);
});
// Dragging the handle up or down; it settles on the nearest of the three sizes.
handle.addEventListener('pointerdown', e => {
  const startY = e.clientY, startH = panel.getBoundingClientRect().height, total = panel.parentElement.clientHeight;
  let moved = false;
  handle.setPointerCapture(e.pointerId);
  const move = ev => {
    const dy = startY - ev.clientY;
    if (Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    panel.classList.add('dragging');
    panel.style.height = `${Math.min(total - 16, Math.max(120, startH + dy))}px`;
  };
  const up = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
    if (!moved) return;
    handle.dataset.dragged = '1';
    const h = panel.getBoundingClientRect().height;
    const best = SIZES.map(s => [Math.abs(coverFor(s) - h), s]).sort((a, b) => a[0] - b[0])[0][1];
    panel.classList.remove('dragging'); panel.style.height = '';
    setSize(best);
  };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
});

// ---------- Shared bits ----------

const ICON_X = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="2"/></svg>';
const ICON_HALF = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor"/></svg>';
const ICON_TURN = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10V5h7M6.5 2.5 9 5 6.5 7.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
export function badge(status) {
  if (status === 'closed') return `<span class="badge closed">${ICON_X}Closed</span>`;
  if (status === 'partly') return `<span class="badge partly">${ICON_HALF}Partly closed</span>`;
  if (status === 'diversion') return `<span class="badge diversion">${ICON_TURN}Diversion</span>`;
  return '';
}

export function closureSourceText(cl) {
  if (!cl) return 'Checking closures…';
  if (cl.source === 'live') return `Closures: live from AFCD, checked at ${timeText(cl.asOf)}.`;
  return `Closure information as of ${dateText(cl.asOf)}, ${timeText(cl.asOf)} (a saved copy: the live check didn’t work).`;
}

// ---------- List view ----------

const filters = { q: '', region: '', type: '', difficulty: '' };
const openGroups = new Set();

export function renderList(ctx) {
  const { routes, closures, onOpen } = ctx;
  const opts = filterOptions(routes);
  const sel = (key, all, list) => `<label class="visually-hidden" for="f-${key}">${all}</label>`
    + `<select id="f-${key}" data-f="${key}" class="${filters[key] ? 'on' : ''}"><option value="">${all}</option>`
    + list.map(([v, tc]) => `<option value="${esc(v)}"${filters[key] === v ? ' selected' : ''}>${esc(v)}${tc ? ` ${esc(tc)}` : ''}</option>`).join('') + '</select>';
  body.innerHTML = `
    <h2 class="visually-hidden" tabindex="-1">Routes</h2>
    <div class="search"><label class="visually-hidden" for="q">Search routes by name, in English or Chinese</label>
      <input id="q" type="search" placeholder="Search routes · 搜尋路線" autocomplete="off" value="${esc(filters.q)}"></div>
    <div class="filters">${sel('region', 'All regions', opts.region)}${sel('type', 'All types', opts.type)}${sel('difficulty', 'Any difficulty', opts.difficulty.map(d => [d]))}</div>
    <div class="list-meta"><span id="count" role="status"></span><button type="button" id="clear" hidden>Clear filters</button></div>
    <p class="closure-note${closures?.source === 'snapshot' ? ' old' : ''}" id="closure-note">${esc(closureSourceText(closures))}</p>
    <ul class="routes" id="routes"></ul>`;
  const input = body.querySelector('#q');
  input.addEventListener('input', () => { filters.q = input.value.trim().toLowerCase(); drawItems(ctx); });
  input.addEventListener('focus', () => { if (!wide.matches && panel.dataset.size === 'peek') setSize('half'); });
  body.querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
    filters[s.dataset.f] = s.value; s.classList.toggle('on', !!s.value); drawItems(ctx);
  }));
  body.querySelector('#clear').addEventListener('click', () => {
    Object.assign(filters, { q: '', region: '', type: '', difficulty: '' }); renderList(ctx);
  });
  body.querySelector('#routes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.group) {
      const id = b.dataset.group;
      openGroups.has(id) ? openGroups.delete(id) : openGroups.add(id);
      drawItems(ctx); body.querySelector(`[data-group="${CSS.escape(id)}"]`)?.focus();
    } else if (b.dataset.route) onOpen(b.dataset.route);
  });
  drawItems(ctx);
}

function drawItems({ routes, statusOf }) {
  const active = !!(filters.q || filters.region || filters.type || filters.difficulty);
  let n = 0;
  const item = (r, note) => {
    n++;
    const st = statusOf(r.id);
    return `<li><button type="button" class="route-btn" data-route="${esc(r.id)}">
      <span class="en">${esc(r.p.name_en)}</span><span class="tc">${esc(r.p.name_tc)}</span>
      ${note ? `<span class="match-note">${esc(note[0])} ${esc(note[1])} <span lang="zh-HK">${esc(note[2] || '')}</span></span>` : ''}
      <span class="facts"><span>${km(r.s.official_length_m)}</span>${difficultyHTML(r.p.DIFFICULTY_EN)}<span>${esc(r.p.REGION_EN)}</span>${badge(st)}</span>
      </button></li>`;
  };
  // Routes whose own name matches come first; routes that only start or finish at a
  // matching place come after, each with a note saying why it is listed.
  const endsOnly = [];
  let html = listEntries(routes).map(e => {
    if (e.kind === 'route') {
      const m = matches(e.route, filters);
      if (m === 'ends') endsOnly.push(e.route);
      return m === 'name' ? item(e.route) : '';
    }
    e.routes.forEach(r => { if (matches(r, filters) === 'ends') endsOnly.push(r); });
    const hits = e.routes.filter(r => matches(r, filters) === 'name');
    if (!hits.length) return '';
    const open = active || openGroups.has(e.id);
    const total = e.routes.reduce((t, r) => t + r.s.official_length_m, 0);
    const closedN = e.routes.filter(r => statusOf(r.id)).length;
    const head = `<button type="button" class="route-btn" data-group="${esc(e.id)}" aria-expanded="${open}">
      <span class="en">${esc(e.name)} <span class="count">· ${e.routes.length} sections</span></span><span class="tc">${esc(e.name_tc)}</span>
      <span class="facts"><span>${km(total)} in all</span>${closedN ? `<span>${closedN} section${closedN > 1 ? 's' : ''} affected by closures</span>` : ''}</span></button>`;
    if (!open) { n += hits.length; return `<li class="group">${head}</li>`; }
    return `<li class="group open">${head}<ul>${hits.map(item).join('')}</ul></li>`;
  }).join('');
  if (endsOnly.length) html += `<li class="subhead">Starting or finishing at a match</li>`
    + endsOnly.sort((a, b) => a.p.name_en.localeCompare(b.p.name_en, 'en')).map(r => item(r, endsNote(r, filters.q))).join('');
  body.querySelector('#routes').innerHTML = html || '<li class="empty">No routes match. Try a different search or filter.</li>';
  body.querySelector('#count').textContent = `${n} ${n === 1 ? 'route' : 'routes'}${active ? ' match' : ''}`;
  body.querySelector('#clear').hidden = !active;
}

export function updateClosureNote(closures) {
  const el = body.querySelector('#closure-note');
  if (el) { el.textContent = closureSourceText(closures); el.classList.toggle('old', closures?.source === 'snapshot'); }
}

// ---------- Route view ----------

export function renderRoute(ctx, r, dirKey) {
  const { closuresFor, statusOf, closures, onBack, onDirection, onScrub } = ctx;
  const s = r.s, p = r.p, dir = directions(r), d = s[dirKey];
  const items = closuresFor(r.id), status = statusOf(r.id);

  const lengthDD = s.length_mismatch
    ? `<span class="both-lengths">Official length ${km(s.official_length_m)} · Mapped line ${km(s.mapped_length_total_m)}</span>`
    : `${km(s.official_length_m)} <small>official length</small>`;
  const notes = [];
  if (s.branching) {
    // One decimal, unless both figures would then look the same (e.g. 1.66 and 1.70 km).
    const dp = (s.profile_length_m / 1000).toFixed(1) === (s.mapped_length_total_m / 1000).toFixed(1) ? 2 : 1;
    notes.push(`<p class="caveat">Profile covers ${(s.profile_length_m / 1000).toFixed(dp)} of ${(s.mapped_length_total_m / 1000).toFixed(dp)} km: the longest continuous path.</p>`);
  }
  if (s.length_mismatch) notes.push('<p class="caveat">Climb and time are worked out from the mapped line.</p>');
  const affected = { closed: 'the route is currently closed', partly: 'part of it is currently closed', diversion: 'part of it is currently diverted' }[status];
  if (affected) notes.push(`<p class="caveat warn">Estimates are for the full route; ${affected}.</p>`);

  // Closures come first, right under the status badge.
  const until = c => /further notice/i.test(c.until) ? ', until further notice' : c.until ? `, expected until ${esc(c.until)}` : '';
  const closureHTML = items.length ? `<section class="closures-top">${items.map(c => c.kind === 'diversion' ? `
      <div class="closure-item diversion">
        <p><b>This section is diverted</b>${c.since ? ` (since ${dateText(c.since)})` : ''}. Follow the diversion signs on site.</p>
        <p class="small">AFCD: ${esc(c.statusEn)} · ${esc(c.statusTc)}${until(c)}. The amber dotted line on the map marks the section being diverted, not the way round it.</p>
      </div>` : `
      <div class="closure-item">
        <p><b>${esc(c.statusEn)}</b> · ${esc(c.statusTc)}${c.partial ? ' <span class="muted">(part of the route)</span>' : ''}</p>
        <p class="small">${c.since ? `Since ${dateText(c.since)}` : ''}${until(c)}${c.partial ? '. The closed part is the red dashed line on the map.' : ''}</p>
      </div>`).join('')}<p class="caveat">${esc(closureSourceText(closures))}</p></section>` : '';

  const facts = [
    ['Type', `${esc(p.TYPE_EN)}<span class="sub">${esc(p.TYPE_TC)}</span>`],
    ['Region', `${esc(p.REGION_EN)}<span class="sub">${esc(p.REGION_TC)}</span>`],
    ['Difficulty', difficultyHTML(p.DIFFICULTY_EN, p.DIFFICULTY_TC) + (p.DIFFICULTY_EN ? '<span class="sub">AFCD’s rating</span>' : '')],
    ...(p.parks_en?.length ? [['Parks', p.parks_en.map((en, i) => `${esc(en)}<span class="sub">${esc(p.parks_tc?.[i] || '')}</span>`).join('')]] : []),
    ...(p.parent_en ? [['Part of', `${esc(p.parent_en)}<span class="sub">${esc(p.parent_tc)}</span>`]] : []),
  ];

  const dirHTML = dir.kind === 'branching' ? `
      <h3>Which way</h3>
      <p class="caveat warn">${esc(dir.note)}</p>
      ${dir.afcd ? `<p class="caveat">${esc(dir.afcd)}</p>` : ''}
      <p><button type="button" class="toggle-btn" data-dir="${dirKey === 'forward' ? 'reverse' : 'forward'}" aria-pressed="${dirKey === 'reverse'}">Flip profile</button></p>` : `
      <h3 id="dir-h">Which way</h3>
      <div class="seg" role="group" aria-labelledby="dir-h">${dir.options.map(o =>
        `<button type="button" data-dir="${o.key}" aria-pressed="${o.key === dirKey}">${esc(o.label)}${o.sub ? `<span class="visually-hidden"> (${esc(o.sub)})</span>` : ''}</button>`).join('')}</div>
      ${dir.kind === 'confirmed' ? `<p class="caveat">${dirKey === 'forward' ? 'This is AFCD’s direction.' : 'The reverse of AFCD’s direction.'}</p>` : ''}
      ${dir.note ? `<p class="caveat warn">${esc(dir.note)}</p>` : ''}`;

  body.innerHTML = `<article class="route">
    <button type="button" class="back-btn" id="back"><span aria-hidden="true">←</span> All routes</button>
    <h2 tabindex="-1">${esc(p.name_en)}</h2>
    <p class="tc-name" lang="zh-HK">${esc(p.name_tc)}</p>
    ${status ? `<div class="badges">${badge(status)}</div>` : ''}
    ${closureHTML}
    <section>${dirHTML}
    </section>
    <section>
      <h3>Height profile</h3>
      <div class="profile" id="profile" tabindex="0" aria-label="Height profile. Use the left and right arrow keys to move along the route."></div>
      <div class="profile-readout" id="readout" aria-live="polite"></div>
      <dl class="stats">
        <div><dt>Length</dt><dd class="num">${lengthDD}</dd></div>
        <div><dt>Time (estimate)</dt><dd class="num">${duration(d.moving_time_min)} <small>moving time for a fit walker, no stops</small></dd></div>
        <div><dt>Climb (estimate)</dt><dd class="num">${d.ascent_m} m <small>this direction; ups and downs under about 10 m aren’t counted</small></dd></div>
        <div><dt>Descent (estimate)</dt><dd class="num">${d.descent_m} m <small>this direction</small></dd></div>
      </dl>
      ${notes.join('')}
    </section>
    <section>
      <h3>About this route</h3>
      <dl class="facts-list">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${p.WEBSITE ? `<p class="small"><a href="${esc(p.WEBSITE)}" target="_blank" rel="noopener noreferrer">AFCD’s page for this route</a> (opens a government website)</p>` : ''}
    </section>
    ${p.has_distance_posts ? '' : `<section><div class="note"><p>This route has no distance posts.</p>
      <p>In an emergency, call 999. <a href="#about-safety">What to tell them</a></p></div></section>`}
  </article>`;

  body.querySelector('#back').addEventListener('click', onBack);
  body.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => onDirection(b.dataset.dir)));

  const box = body.querySelector('#profile'), readout = body.querySelector('#readout');
  const draw = () => renderProfile(box, readout, {
    heights: s.profile.heights_m, spacing: s.profile.spacing_m, length: s.profile_length_m,
    highest: { m: s.highest_m, at: s.highest_at_m }, lowest: { m: s.lowest_m, at: s.lowest_at_m },
    reversed: dirKey === 'reverse', onScrub: dist => onScrub(dist, s.profile_length_m),
  });
  draw();
  let lastW = box.clientWidth;
  new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) > 4) { lastW = box.clientWidth; draw(); } }).observe(box);
}

// ---------- About ----------

export function renderAbout({ attribution, manifest, closures, onBack }) {
  const trailsSource = manifest.files?.['trails.geojson']?.sources?.find(s => s.dataset === 'hiking_trails');
  const dataDate = trailsSource ? dateText(new Date(trailsSource.downloaded_at)) : null;
  body.innerHTML = `<article class="about">
    <button type="button" class="back-btn" id="back"><span aria-hidden="true">←</span> Back</button>
    <h2 tabindex="-1">About this page</h2>

    <h3 id="about-safety">Safety</h3>
    <p>This page is a planning aid, not a navigation tool. Check official information before you set out, including closures and the weather.</p>
    <div class="emergency">
      <p><strong>In an emergency, call 999</strong> (or 112 on a mobile phone).</p>
      <p>Tell them the number on the nearest distance post (for example “L018”), or describe a landmark near you.</p>
      <p>The Police’s <b>HKSOS</b> app can send your location to the 999 centre.</p>
    </div>

    <h3>About the numbers</h3>
    <ul>
      <li><b>Climb and time are estimates.</b> They are worked out by computer, not measured on the ground.</li>
      <li>Heights come from the Lands Department’s terrain model, which shows the ground as it was mapped in 2015. Where there are trees, it records the treetops, so wooded stretches can read higher than the path. It is accurate to about ±5 m.</li>
      <li>Climb leaves out ups and downs smaller than about 10 m, so routes along rolling ridges have more climb than shown.</li>
      <li>Times are <b>moving time for a fit walker, no stops</b>: 1 hour for every 5 km, plus 1 hour for every 600 m of climb. Allow extra for rests, heat, rain and rough ground.</li>
      <li>Lengths are AFCD’s official figures. Some official lengths differ from the mapped lines; where they do, both are shown.</li>
      <li>For some routes the data can’t confirm which end is the official start. These say “Direction not verified”.</li>
      <li>Where a route branches, the height profile follows its longest continuous path.</li>
      <li>The spot shown on the map as you move along the height profile is approximate.</li>
    </ul>

    <h3>Where the information comes from</h3>
    <ul>${attribution.en.map((en, i) => `<li>${esc(en)}<br><span class="tc" lang="zh-HK">${esc(attribution.tc?.[i] || '')}</span></li>`).join('')}</ul>
    <p>Map: <a class="landsd-credit" href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank" rel="noopener noreferrer">&copy; Map from Lands Department<span class="landsd-logo" role="img" aria-label="Lands Department logo"></span></a></p>
    <p>Closures are checked live with AFCD’s data on the CSDI Portal each time you open this page. If that doesn’t work, a saved copy is used and its date is shown. ${esc(closureSourceText(closures))}</p>
    ${dataDate ? `<p>Route data last downloaded ${dataDate}.</p>` : ''}
    <p class="small muted">The data is provided by the Government “as is”, without any promise that it is accurate, complete or up to date. The map display uses <a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a> 1.9.4 (BSD licence), stored on this site.</p>

    <h3>Privacy</h3>
    <p>This page contacts only its own site, the Lands Department’s map server and the CSDI Portal (for live closures). The browser is told to block anything else. There are no analytics, cookies, or fonts or scripts from other sites. If you use “My location”, your position stays on your device and is never sent anywhere.</p>
  </article>`;
  body.querySelector('#back').addEventListener('click', onBack);
}

export function focusHeading() {
  body.scrollTop = 0;
  body.querySelector('h2')?.focus({ preventScroll: true });
}
