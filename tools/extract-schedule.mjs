// Reads private/schedule.html and returns the schedule as plain data for the "now" display:
//   blocks    from the script element with id "state" (day 0 = Monday … 6 = Sunday, start/end in minutes after midnight)
//   cats      from the CATS list in the main script (name, description, and the "floor" taken from "Floor: …")
//   flags     planning: true on Planning blocks; open: true on the Pastimes and Movement blocks to choose for at
//             Planning (those whose note mentions planning, so a block that's already decided is left out). Worked
//             out here, so the public display code never needs the schedule's own words.
//   routines  from the ROUTINES list, with the written times (like "7:15–8am" or "~10:45pm") turned into minutes
// Nothing is retyped: the lists are read from the file itself. Used by tools/build-now.mjs; run it on its own
// to check the extraction:  node tools/extract-schedule.mjs   (prints a summary, not the schedule itself)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEDULE = path.join(ROOT, 'private', 'schedule.html');
const PICK_CATS = new Set(['create', 'movement']); // categories chosen at Planning: Pastimes and Movement

// "7:15" + "am" -> 435. Returns null if it isn't a time.
function clock(t, suffix) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  let h = +m[1] % 12;
  if (suffix === 'pm') h += 12;
  return h * 60 + (+m[2] || 0);
}

// "7:15–8am" -> {start: 435, end: 480};  "10pm" -> {start: 1320, end: null};  "~10:45pm" -> approx: true
export function parseTimeText(text) {
  const approx = /^~/.test(text.trim());
  const m = /^~?\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:[–—-]\s*(\d{1,2}(?::\d{2})?)\s*(am|pm))?$/i.exec(text.trim());
  if (!m) throw new Error(`Can't read the routine time "${text}"`);
  const [, a, aSuf, b, bSuf] = m.map(x => x && x.toLowerCase());
  if (!b) {
    if (!aSuf) throw new Error(`The routine time "${text}" needs am or pm`);
    return { start: clock(a, aSuf), end: null, approx };
  }
  let start = clock(a, aSuf || bSuf);
  const end = clock(b, bSuf);
  if (!aSuf && start > end) start = clock(a, bSuf === 'pm' ? 'am' : 'pm'); // "11–1pm" means 11am to 1pm
  return { start, end: end === 0 ? 1440 : end, approx };
}

// "Keep it short. Floor: open the file." -> "open the file."  (null when there is no floor)
export function floorOf(text) {
  const m = /\bFloor:\s*(.+)$/s.exec(text || '');
  return m ? m[1].trim() : null;
}

export function extract(file = SCHEDULE) {
  const html = fs.readFileSync(file, 'utf8');

  const state = html.match(/<script id=\"state\" type="application\/json">([\s\S]*?)<\/script>/);
  if (!state) throw new Error('No schedule data (script id "state") found in ' + file);
  const blocks = JSON.parse(state[1]).blocks;

  // The two lists are JavaScript, not JSON, so run just those two statements in an empty sandbox.
  const code = html.match(/var CATS = \[[\s\S]*?\n\];\s*var ROUTINES = \[[\s\S]*?\n\];/);
  if (!code) throw new Error('Could not find the CATS and ROUTINES lists in ' + file);
  const box = {};
  vm.runInNewContext(code[0], box, { timeout: 1000 });

  const cats = {};
  for (const [key, name, about] of box.CATS) cats[key] = { name, about, floor: floorOf(about) };

  const routines = box.ROUTINES.map(r => ({
    name: r.name,
    steps: r.items.map(([time, title, note]) => ({
      time, ...parseTimeText(time), title, note: note || '', floor: floorOf(note)
    }))
  }));

  return {
    blocks: blocks.map(b => {
      const out = { id: b.id, day: b.day, start: b.start, end: b.end, cat: b.cat, label: b.label, note: b.note || '' };
      if (b.cat === 'planning') out.planning = true;
      else if (PICK_CATS.has(b.cat) && /\bplanning\b/i.test(b.note || '')) out.open = true;
      return out;
    }),
    cats,
    routines
  };
}

// Problems that would make the display wrong. Returns a list of plain-English messages (empty = fine).
export function check(data) {
  const out = [];
  for (const b of data.blocks) {
    const where = `"${b.label}" (${b.id})`;
    if (!Number.isInteger(b.day) || b.day < 0 || b.day > 6) out.push(`${where}: day must be 0 (Monday) to 6 (Sunday)`);
    if (!(b.start >= 0 && b.end <= 1440 && b.start < b.end)) out.push(`${where}: start and end must be within the day, start first`);
    if (!data.cats[b.cat]) out.push(`${where}: category "${b.cat}" is not in CATS`);
  }
  for (let d = 0; d < 7; d++) {
    const day = data.blocks.filter(b => b.day === d).sort((x, y) => x.start - y.start);
    for (let i = 1; i < day.length; i++) {
      if (day[i].start < day[i - 1].end) out.push(`"${day[i - 1].label}" and "${day[i].label}" overlap on day ${d}`);
    }
  }
  for (const r of data.routines) {
    for (const s of r.steps) if (s.start == null) out.push(`Routine step "${s.title}" has no readable time`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = extract();
  const problems = check(data);
  console.log(`${data.blocks.length} blocks, ${Object.keys(data.cats).length} categories ` +
    `(${Object.values(data.cats).filter(c => c.floor).length} with a floor), ` +
    `${data.routines.length} routines with ${data.routines.reduce((n, r) => n + r.steps.length, 0)} steps.`);
  console.log(`${data.blocks.filter(b => b.planning).length} Planning blocks, ${data.blocks.filter(b => b.open).length} blocks to choose for at Planning.`);
  console.log(problems.length ? 'Problems:\n  ' + problems.join('\n  ') : 'No problems found.');
  process.exit(problems.length ? 1 : 0);
}
