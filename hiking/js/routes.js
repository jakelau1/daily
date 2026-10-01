// The routes: joins trails.geojson with route_stats.json, groups long-distance trail sections
// under their parent trail, and answers filter and search questions.
import { compassEnds, DIFFICULTY_ORDER } from './format.js';

export function buildRoutes(trails, stats) {
  const routes = new Map();
  for (const f of trails.features) {
    const p = f.properties, s = stats.routes[p.TRAIL_ID];
    if (!s) continue;
    const text = a => a.filter(Boolean).join(' ').toLowerCase();
    routes.set(p.TRAIL_ID, {
      id: p.TRAIL_ID, p, s, feature: f,
      nameText: text([p.name_en, p.name_tc, p.parent_en, p.parent_tc]),
      startText: text([p.STARTpt_EN, p.STARTpt_TC]),
      finishText: text([p.FINISHpt_EN, p.FINISHpt_TC]),
    });
  }
  return routes;
}

const sectionNo = r => parseInt(r.p.SECTION_NO, 10) || 0;

// Top-level list entries: single routes, and groups for long-distance trails.
export function listEntries(routes) {
  const groups = new Map(), out = [];
  for (const r of routes.values()) {
    if (!r.p.parent_id) { out.push({ kind: 'route', name: r.p.name_en, route: r }); continue; }
    let g = groups.get(r.p.parent_id);
    if (!g) {
      g = { kind: 'group', id: r.p.parent_id, name: r.p.parent_en, name_tc: r.p.parent_tc, routes: [] };
      groups.set(r.p.parent_id, g); out.push(g);
    }
    g.routes.push(r);
  }
  for (const g of groups.values()) g.routes.sort((a, b) => sectionNo(a) - sectionNo(b));
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function filterOptions(routes) {
  const uniq = (key, keyTc) => [...new Map([...routes.values()].map(r => [r.p[key], r.p[keyTc]])).entries()]
    .filter(([en]) => en).sort((a, b) => a[0].localeCompare(b[0]));
  const diffs = new Set([...routes.values()].map(r => r.p.DIFFICULTY_EN || ''));
  return {
    region: uniq('REGION_EN', 'REGION_TC'),
    type: uniq('TYPE_EN', 'TYPE_TC'),
    difficulty: [...DIFFICULTY_ORDER.filter(d => diffs.has(d)), ...(diffs.has('') ? ['Not rated'] : [])],
  };
}

// How a route matches the search and filters: 'name' (its own name), 'ends' (only its start
// or finish name, which is shown with a note), or false.
export function matches(r, { q, region, type, difficulty }) {
  if (region && r.p.REGION_EN !== region) return false;
  if (type && r.p.TYPE_EN !== type) return false;
  if (difficulty && (r.p.DIFFICULTY_EN || 'Not rated') !== difficulty) return false;
  if (!q) return 'name';
  const words = q.split(/\s+/);
  const has = t => words.every(w => t.includes(w));
  if (has(r.nameText)) return 'name';
  if (has(r.startText) || has(r.finishText)) return 'ends';
  return false;
}

// The note for an 'ends' match, e.g. "Starts at Lantau Trail Section 7".
export function endsNote(r, q) {
  const words = q.split(/\s+/), has = t => words.every(w => t.includes(w));
  const st = has(r.startText), fi = has(r.finishText);
  if (st && fi && r.p.STARTpt_EN === r.p.FINISHpt_EN) return ['Starts and finishes at', r.p.STARTpt_EN, r.p.STARTpt_TC];
  return st ? ['Starts at', r.p.STARTpt_EN, r.p.STARTpt_TC] : ['Finishes at', r.p.FINISHpt_EN, r.p.FINISHpt_TC];
}

// The two ways to walk a route, and how to describe them. `forward` is the direction the
// stats and profile are stored in; `reverse` is the other way.
export function directions(r) {
  const s = r.s, p = r.p;
  if (s.branching) {
    // Branching routes have no single start and finish: the profile follows the longest
    // continuous path, and the map marks its two ends "Profile start" / "Profile end".
    const q = x => `“${x}”`, st = p.STARTpt_EN, fi = p.FINISHpt_EN;
    let afcd = null;
    if (st && st === fi) afcd = `AFCD gives the start and finish as ${q(st)}.`;
    else if (st && fi) afcd = `AFCD gives the start as ${q(st)} and the finish as ${q(fi)}.`;
    else if (st) afcd = `AFCD gives the start as ${q(st)}.`;
    else if (fi) afcd = `AFCD gives the finish as ${q(fi)}.`;
    return {
      kind: 'branching',
      note: 'This route branches, so it has no single start and finish. The profile follows its longest continuous path, between “Profile start” and “Profile end” on the map.',
      afcd: afcd || null,
    };
  }
  if (s.loop) {
    const turn = d => s[d].loop_turn === 'clockwise' ? 'Clockwise' : 'Anticlockwise';
    return {
      kind: 'loop',
      options: [{ key: 'forward', label: turn('forward') }, { key: 'reverse', label: turn('reverse') }]
        .sort(a => (a.label === 'Clockwise' ? -1 : 1)),   // Clockwise first
      note: s.start_verified
        ? `Starts and finishes at ${s.forward.from_en} (${s.forward.from_tc}).`
        : 'Start point not verified.',
      startVerified: s.start_verified,
    };
  }
  if (s.direction_verified_by) {
    const lab = d => `${s[d].from_en} → ${s[d].to_en}`;
    return {
      kind: 'confirmed',
      options: [{ key: 'forward', label: lab('forward'), sub: 'AFCD’s direction' }, { key: 'reverse', label: lab('reverse') }],
      note: null,
    };
  }
  const [a, b] = compassEnds(s.start, s.end);
  const cap = w => w[0].toUpperCase() + w.slice(1);
  const listed = p.STARTpt_EN && p.FINISHpt_EN && p.STARTpt_EN !== p.FINISHpt_EN
    ? ` AFCD lists the ends as “${p.STARTpt_EN}” and “${p.FINISHpt_EN}”, but the data doesn’t show which end is which.` : '';
  return {
    kind: 'unverified',
    options: [{ key: 'forward', label: `${cap(a)} end → ${b} end` }, { key: 'reverse', label: `${cap(b)} end → ${a} end` }],
    note: `Direction not verified.${listed}`,
  };
}
