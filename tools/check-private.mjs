// Privacy guard, run by git before every commit (installed as .git/hooks/pre-commit by
// `node tools/check-private.mjs --install`). It refuses the commit if:
//   1. any staged file is in private/ or build/, or is a .env file, or
//   2. any staged file contains readable text from private/schedule.html
//      (block labels and notes, category descriptions, routine steps).
// The encrypted page passes because its contents are scrambled.
// Run it by hand at any time:  node tools/check-private.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SCHEDULE = path.join(ROOT, 'private', 'schedule.html');

if (process.argv.includes('--install')) {
  const hook = path.join(ROOT, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexec node tools/check-private.mjs\n', { mode: 0o755 });
  console.log('Installed', hook);
  process.exit(0);
}

const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 << 20 });
const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString('utf8').split('\0').filter(Boolean);

const problems = [];
for (const f of staged) {
  if (/^(private|build)\//.test(f) || /(^|\/)\.env(\.|$)/.test(f)) problems.push(`${f}: this file must never be committed`);
}

// Distinctive phrases from the schedule. Short or generic words are left out so ordinary
// site text doesn't trip the check.
function phrases() {
  const html = fs.readFileSync(SCHEDULE, 'utf8');
  const out = new Set(['<script id=' + '"state"']); // split so this file doesn't match itself
  const state = html.match(/<script id=\"state\" type="application\/json">([\s\S]*?)<\/script>/);
  if (state) {
    for (const b of JSON.parse(state[1]).blocks || []) {
      for (const s of [b.note, b.label]) if (s && s.length >= 12) out.add(s);
    }
  }
  const code = html.match(/var CATS = \[[\s\S]*?\n\];\s*var ROUTINES = \[[\s\S]*?\n\];/);
  if (code) {
    for (const m of code[0].matchAll(/'((?:[^'\\]|\\.){20,})'/g)) out.add(m[1].replace(/\\'/g, "'"));
  }
  return [...out];
}

if (fs.existsSync(SCHEDULE)) {
  const list = phrases();
  for (const f of staged) {
    if (problems.some(p => p.startsWith(f + ':'))) continue;
    const buf = git(['show', `:${f}`]);
    if (buf.includes(0)) continue; // binary file (images, fonts)
    const text = buf.toString('utf8');
    const hit = list.find(p => text.includes(p));
    if (hit) problems.push(`${f}: contains text from your schedule (starting "${hit.slice(0, 12)}…")`);
  }
} else {
  console.warn('check-private: private/schedule.html not found, so only file names were checked.');
}

if (problems.length) {
  console.error('\nCommit stopped by the privacy check:\n  ' + problems.join('\n  ') + '\n');
  process.exit(1);
}
console.log(`check-private: ${staged.length} staged file(s) checked, nothing private found.`);
