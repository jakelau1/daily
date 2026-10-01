// The height profile, drawn as SVG (no chart library).
// The line uses the smoothed heights; the highest/lowest labels use the raw figures.
import { esc } from './format.js';

const H = 186, M = { l: 40, r: 12, t: 24, b: 24 };
const PB = H - M.b - 16;   // bottom of the plot; the strip below leaves room for the lowest-point label

function niceStep(range, maxTicks, steps) {
  return steps.find(s => range / s <= maxTicks) || steps[steps.length - 1];
}

// opts: { heights, spacing, length, highest: {m, at}, lowest: {m, at}, reversed, onScrub(d|null) }
// Distances (`at`, and what onScrub reports) are metres from the start of the chosen direction.
export function renderProfile(box, readout, opts) {
  const { heights, spacing, length: L, reversed } = opts;
  const flip = x => reversed ? L - x : x;
  const pts = heights.map((h, i) => [flip(Math.min(i * spacing, L)), h]).sort((a, b) => a[0] - b[0]);
  const hi = { m: opts.highest.m, at: flip(opts.highest.at) }, lo = { m: opts.lowest.m, at: flip(opts.lowest.at) };

  const W = Math.max(260, Math.round(box.clientWidth || 320));
  const yMin0 = Math.min(lo.m, ...heights), yMax0 = Math.max(hi.m, ...heights);
  const yStep = niceStep(Math.max(yMax0 - yMin0, 20), 4, [10, 20, 25, 50, 100, 200, 250, 500]);
  const yMin = Math.max(0, Math.floor((yMin0 - yStep * 0.3) / yStep) * yStep);
  const yMax = Math.ceil((yMax0 + yStep * 0.3) / yStep) * yStep;
  const xStep = niceStep(L / 1000, 6, [0.25, 0.5, 1, 2, 5, 10]) * 1000;
  const X = d => M.l + d / L * (W - M.l - M.r);
  const Y = h => M.t + (1 - (h - yMin) / (yMax - yMin)) * (PB - M.t);
  const f = n => n.toFixed(1);

  let grid = '';
  for (let h = yMin; h <= yMax + 0.1; h += yStep)
    grid += `<line x1="${M.l}" x2="${W - M.r}" y1="${f(Y(h))}" y2="${f(Y(h))}"/><text x="${M.l - 6}" y="${f(Y(h) + 4)}" text-anchor="end">${h} m</text>`;
  for (let d = 0; d <= L + 1; d += xStep)
    grid += `<text x="${f(X(d))}" y="${H - 6}" text-anchor="middle">${+(d / 1000).toFixed(2)} km</text>`;

  const line = pts.map(([d, h], i) => `${i ? 'L' : 'M'}${f(X(d))},${f(Y(h))}`).join('');
  const area = `${line}L${f(X(pts[pts.length - 1][0]))},${PB}L${f(X(pts[0][0]))},${PB}Z`;
  const anchor = x => x < M.l + 40 ? 'start' : x > W - M.r - 40 ? 'end' : 'middle';
  const mark = (p, up, text) => {
    const x = X(p.at), y = Y(p.m);
    const tri = up ? `M${f(x - 5)},${f(y - 2)}L${f(x + 5)},${f(y - 2)}L${f(x)},${f(y - 9)}Z` : `M${f(x - 5)},${f(y + 2)}L${f(x + 5)},${f(y + 2)}L${f(x)},${f(y + 9)}Z`;
    return `<path class="mark" d="${tri}"/><text class="mark-label" x="${f(x)}" y="${f(up ? y - 12 : y + 20)}" text-anchor="${anchor(x)}">${esc(text)}</text>`;
  };
  const summary = `Height profile, ${(L / 1000).toFixed(1)} km. Highest point ${hi.m} m, lowest ${lo.m} m.`;

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(summary)}">
    <g class="grid">${grid}</g><path class="area" d="${area}"/><path class="line" d="${line}"/>
    ${mark(hi, true, `${hi.m} m highest`)}${mark(lo, false, `${lo.m} m lowest`)}
    <g class="cursor" hidden><line y1="${M.t - 6}" y2="${PB}"/><circle r="4.5"/></g></svg>`;

  // Moving along the profile (pointer or arrow keys) shows the height there, and tells the map.
  const svg = box.querySelector('svg'), cur = svg.querySelector('.cursor');
  const heightAt = d => {
    const i = pts.findIndex(p => p[0] >= d);
    if (i <= 0) return pts[Math.max(i, 0)][1];
    const [d0, h0] = pts[i - 1], [d1, h1] = pts[i];
    return h0 + (h1 - h0) * ((d - d0) / ((d1 - d0) || 1));
  };
  let pos = null;
  const show = d => {
    if (d == null) { cur.setAttribute('hidden', ''); readout.textContent = ''; opts.onScrub?.(null); pos = null; return; }
    pos = Math.max(0, Math.min(L, d));
    const h = heightAt(pos);
    cur.removeAttribute('hidden');
    cur.querySelector('line').setAttribute('x1', f(X(pos))); cur.querySelector('line').setAttribute('x2', f(X(pos)));
    cur.querySelector('circle').setAttribute('cx', f(X(pos))); cur.querySelector('circle').setAttribute('cy', f(Y(h)));
    readout.textContent = `${(pos / 1000).toFixed(2)} km from the start · about ${Math.round(h)} m`;
    opts.onScrub?.(pos);
  };
  const fromEvent = e => {
    const r = svg.getBoundingClientRect();
    return ((e.clientX - r.left) * (W / r.width) - M.l) / (W - M.l - M.r) * L;
  };
  box.onpointerdown = e => { box.setPointerCapture?.(e.pointerId); show(fromEvent(e)); };
  box.onpointermove = e => { if (e.pointerType === 'mouse' || box.hasPointerCapture?.(e.pointerId)) show(fromEvent(e)); };
  box.onpointerleave = e => { if (e.pointerType === 'mouse') show(null); };
  box.onpointerup = e => { if (e.pointerType !== 'mouse') setTimeout(() => show(null), 1500); };
  box.onkeydown = e => {
    const step = L / 50;
    const next = { ArrowRight: (pos ?? -step) + step, ArrowLeft: (pos ?? step) - step, Home: 0, End: L, Escape: null }[e.key];
    if (next === undefined) return;
    e.preventDefault(); show(next);
  };
  box.onblur = () => show(null);
}
