// Privacy guard, run by git before every commit (installed as .git/hooks/pre-commit by
// `node tools/check-private.mjs --install`). It refuses the commit if:
//   1. any staged file is in private/ or build/, or is a .env file, or
//   2. any staged file contains readable text from private/schedule.html (its labels, notes and descriptions), or
//   3. the commit ADDS a short sensitive term (to a file's text or its name): anything in "sensitiveTerms" or under
//      "home" in private/config.json (course codes, place and street names, …), or a course-code-like token
//      (letters then digits) written in the schedule itself. The terms live in the private file, never in this one.
//      Terms already in a file are not flagged again until that line changes; this lists every tracked file that
//      still contains one:   node tools/check-private.mjs --audit
// The encrypted page passes because its contents are scrambled.
// Run it by hand at any time:  node tools/check-private.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SCHEDULE = path.join(ROOT, 'private', 'schedule.html');
const CONFIG = path.join(ROOT, 'private', 'config.json');

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain && process.argv.includes('--install')) {
  const hook = path.join(ROOT, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexec node tools/check-private.mjs\n', { mode: 0o755 });
  console.log('Installed', hook);
  process.exit(0);
}

export const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 << 20 });

// Every quoted string the schedule file holds (labels, notes, category and routine text), of any length.
function scheduleStrings() {
  const html = fs.readFileSync(SCHEDULE, 'utf8');
  const out = [];
  const state = html.match(/<script id=\"state\" type="application\/json">([\s\S]*?)<\/script>/);
  if (state) for (const b of JSON.parse(state[1]).blocks || []) for (const s of [b.note, b.label]) if (s) out.push(s);
  const code = html.match(/var CATS = \[[\s\S]*?\n\];\s*var ROUTINES = \[[\s\S]*?\n\];/);
  if (code) for (const m of code[0].matchAll(/'((?:[^'\\]|\\.)+)'/g)) out.push(m[1].replace(/\\'/g, "'"));
  return out;
}

// Distinctive phrases from the schedule. Short or generic words are left out so ordinary
// site text doesn't trip the check; short sensitive terms are covered by sensitiveTerms() below.
export function phrases() {
  const out = new Set(['<script id=' + '"state"']); // split so this file doesn't match itself
  for (const s of scheduleStrings()) {
    if (s.length < 12) continue;
    out.add(s);
    // each sentence and each floor on its own, so a part copied elsewhere is caught too
    for (const part of s.split(/(?<=\.)\s+|Floor:\s*/)) if (part.trim().length >= 12) out.add(part.trim());
  }
  return [...out];
}

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
};
// Short sensitive terms: the private config's "sensitiveTerms" and everything under "home", plus course-code-like
// tokens (2 to 5 letters then 2 to 4 digits, like ABC123) found in the schedule.
export function sensitiveTerms() {
  const out = new Set();
  if (fs.existsSync(CONFIG)) {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    for (const t of [...(c.sensitiveTerms || []), ...strings(c.home)]) if (t.trim().length >= 2) out.add(t.trim());
  }
  if (fs.existsSync(SCHEDULE)) for (const s of scheduleStrings()) for (const m of s.matchAll(/\b[A-Za-z]{2,5} ?\d{2,4}[A-Za-z]?\b/g)) out.add(m[0]);
  return [...out];
}
// Short plain-letter terms must match whole words ("Tin" must not trip on "Martin"); the rest match anywhere.
export function termPattern(t) {
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /^[\x00-\x7f]+$/.test(t) && t.length <= 6 ? new RegExp('\\b' + esc + '\\b', 'i') : new RegExp(esc, 'i');
}
const tracked = () => git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
const readStaged = f => git(['show', `:${f}`]);

if (isMain && process.argv.includes('--audit')) {
  const patterns = sensitiveTerms().map(t => [t, termPattern(t)]);
  if (!patterns.length) { console.warn('check-private --audit: no sensitive terms found (private/config.json missing?).'); process.exit(0); }
  const found = new Map();
  for (const f of tracked()) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const buf = fs.readFileSync(path.join(ROOT, f));
    const text = buf.includes(0) ? '' : buf.toString('utf8');
    for (const [t, re] of patterns) if (re.test(f) || re.test(text)) found.set(t, [...(found.get(t) || []), f]);
  }
  for (const [t] of patterns) console.log(`${(found.get(t) || []).length ? 'STILL IN ' + found.get(t).length + ' file(s)' : 'clear'}: "${t}"` + ((found.get(t) || []).length ? '  ' + found.get(t).slice(0, 6).join(', ') + (found.get(t).length > 6 ? ', …' : '') : ''));
  process.exit(found.size ? 1 : 0);
}

const staged = !isMain ? [] : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString('utf8').split('\0').filter(Boolean);

const problems = [];
for (const f of staged) {
  if (/^(private|build)\//.test(f) || /(^|\/)\.env(\.|$)/.test(f)) problems.push(`${f}: this file must never be committed`);
}

if (isMain && fs.existsSync(SCHEDULE)) {
  const list = phrases();
  for (const f of staged) {
    if (problems.some(p => p.startsWith(f + ':'))) continue;
    const buf = readStaged(f);
    if (buf.includes(0)) continue; // binary file (images, fonts)
    const text = buf.toString('utf8');
    const hit = list.find(p => text.includes(p));
    if (hit) problems.push(`${f}: contains text from your schedule (starting "${hit.slice(0, 12)}…")`);
  }
} else if (isMain) {
  console.warn('check-private: private/schedule.html not found, so only file names were checked.');
}

if (isMain) {
  const terms = sensitiveTerms().map(t => [t, termPattern(t)]);
  if (!terms.length) console.warn('check-private: no sensitive terms found (private/config.json missing?), so short terms were not checked.');
  for (const f of staged) {
    if (problems.some(p => p.startsWith(f + ':'))) continue;
    const added = git(['diff', '--cached', '-U0', '--no-color', '--', f]).toString('utf8')
      .split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    for (const [t, re] of terms) {
      if (re.test(f)) { problems.push(`${f}: the file name contains a sensitive term ("${t}")`); break; }
      if (re.test(added)) { problems.push(`${f}: adds a sensitive term ("${t}")`); break; }
    }
  }
}

if (isMain && problems.length) {
  console.error('\nCommit stopped by the privacy check:\n  ' + problems.join('\n  ') + '\n');
  process.exit(1);
}
if (isMain) console.log(`check-private: ${staged.length} staged file(s) checked, nothing private found.`);
