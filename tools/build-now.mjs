// Rebuilds the encrypted "now" page (now/index.html) from private/schedule.html.
// Run it after saving a new schedule file:
//   npm run now                 rebuild and test the page (nothing is committed)
//   npm run now -- --publish    rebuild, test, then commit and push just the encrypted page
// What it does:
//   1. reads the schedule with tools/extract-schedule.mjs and stops if anything looks wrong
//   2. encrypts it with StatiCrypt (password from .env, salt from .staticrypt.json so "Remember me" keeps working)
//   3. checks the result: no readable schedule text, no inline code, and it decrypts back to exactly the same data
//   4. copies it to now/index.html
// The readable copy is only ever written to build/, which git ignores.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { extract, check } from './extract-schedule.mjs';
import { phrases } from './check-private.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const CLI = require.resolve('staticrypt/cli/index.js');
const r = p => path.join(ROOT, p);
const publish = process.argv.includes('--publish');

function stop(msg) { console.error('\nStopped: ' + msg + '\n'); process.exit(1); }
function run(cmd, args, quiet) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) stop(`${path.basename(cmd)} ${args[0]} failed:\n${res.stdout}${res.stderr}`);
  if (!quiet) process.stdout.write(res.stdout);
  return res.stdout;
}

// 0. The password must come from .env (StatiCrypt reads it from there itself; it is never printed).
const env = fs.existsSync(r('.env')) ? fs.readFileSync(r('.env'), 'utf8') : '';
if (!/^STATICRYPT_PASSWORD=.{14,}$/m.test(env)) stop('.env is missing or has no STATICRYPT_PASSWORD line of at least 14 characters.');
if (!fs.existsSync(r('private/schedule.html'))) stop('private/schedule.html not found.');

// 1. Extract and check.
const data = extract();
// The weather places the display reads (private; they name the home area): travel inside the encrypted payload.
try { data.feeds = JSON.parse(fs.readFileSync(r('private/config.json'), 'utf8')).feeds || null; } catch { data.feeds = null; }
const problems = check(data);
if (problems.length) stop('the schedule has problems:\n  ' + problems.join('\n  '));
const payload = JSON.stringify(data);
for (const d of ['payload', 'encrypted', 'decrypted', 'current', 'current-decrypted', 'template']) fs.rmSync(r('build/' + d), { recursive: true, force: true }); // not screenshots/
fs.mkdirSync(r('build/payload'), { recursive: true });
fs.writeFileSync(r('build/payload/index.html'), payload); // StatiCrypt only encrypts .html files; the content is JSON

// The StatiCrypt code the page runs, made from the installed StatiCrypt so it always matches the encryption.
const { buildStaticryptJS } = require('staticrypt/cli/helpers.js');
const version = require('staticrypt/package.json').version;
fs.mkdirSync(r('now/vendor'), { recursive: true });
fs.writeFileSync(r('now/vendor/staticrypt.js'),
  `// StatiCrypt ${version} (MIT licence, see STATICRYPT-LICENSE.txt), https://github.com/robinmoisson/staticrypt\n` +
  `// Made by tools/build-now.mjs from node_modules/staticrypt; don't edit by hand.\n` +
  `window.staticryptInitiator = ${buildStaticryptJS()};\n`);
fs.copyFileSync(require.resolve('staticrypt/LICENSE'), r('now/vendor/STATICRYPT-LICENSE.txt'));

// The page template, with the weather relay's address (relay/url.txt, if the relay has been deployed) filled in.
let relay = '';
if (fs.existsSync(r('relay/url.txt'))) {
  relay = fs.readFileSync(r('relay/url.txt'), 'utf8').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(relay)) stop('relay/url.txt should hold just the relay address, like https://name.example.workers.dev');
}
fs.mkdirSync(r('build/template'), { recursive: true });
fs.writeFileSync(r('build/template/now.html'), fs.readFileSync(r('tools/now-template.html'), 'utf8')
  .replaceAll('{{RELAY_URL}}', relay).replaceAll('{{RELAY_CSP}}', relay ? ' ' + relay : ''));

// 2. Encrypt. The salt is kept in .staticrypt.json (not secret); a new salt would log out every device.
const hadSalt = fs.existsSync(r('.staticrypt.json'));
const saltBefore = hadSalt ? JSON.parse(fs.readFileSync(r('.staticrypt.json'), 'utf8')).salt : null;
run(process.execPath, [CLI, 'build/payload/index.html', '-d', 'build/encrypted', '-t', 'build/template/now.html',
  '--remember', '0', '--template-title', 'Now', '--config', '.staticrypt.json'], true);
const salt = JSON.parse(fs.readFileSync(r('.staticrypt.json'), 'utf8')).salt;
if (hadSalt && salt !== saltBefore) stop('the salt changed, which would log out every device. Restore .staticrypt.json from git.');

// 3. Check the encrypted page.
const out = fs.readFileSync(r('build/encrypted/index.html'), 'utf8');
const cfg = JSON.parse(out.match(/<script id="staticrypt-config" type="application\/json">([\s\S]*?)<\/script>/)[1]);
if (!cfg.staticryptEncryptedMsgUniqueVariableName || cfg.staticryptSaltUniqueVariableName !== salt) stop('the encrypted page is incomplete.');
if (cfg.rememberDurationInDays !== 0 || cfg.isRememberEnabled !== true) stop('"Remember me" is not set to never expire.');
const leak = phrases().find(p => out.includes(p));
if (leak) stop(`readable schedule text found in the encrypted page ("${leak.slice(0, 12)}…").`);
for (const tag of out.match(/<script\b[^>]*>/g)) {
  if (!/\bsrc=/.test(tag) && !/type="application\/json"/.test(tag)) stop('the page has inline code, which the security policy would block: ' + tag);
}
if (/\sstyle=|<style/i.test(out)) stop('the page has inline styles, which the security policy would block.');
if (!/<title>Now<\/title>/.test(out)) stop('unexpected page title.');
// Decrypt it again with StatiCrypt's own --decrypt and compare with what went in.
run(process.execPath, [CLI, 'build/encrypted/index.html', '--decrypt', '-d', 'build/decrypted', '--config', '.staticrypt.json'], true);
const back = fs.readFileSync(r('build/decrypted/index.html'), 'utf8');
if (back !== payload) stop('decrypting the page did not give back the same schedule.');

// 4. Install it. Encryption is randomised, so the file differs on every run; keep the current page when it already
//    holds the same schedule and was made from the same template, to avoid publishing a change that isn't one.
const target = r('now/index.html');
const shell = s => s.replace(/<script id="staticrypt-config"[\s\S]*?<\/script>/, '');
let changed = true;
if (fs.existsSync(target) && shell(fs.readFileSync(target, 'utf8')) === shell(out)) {
  fs.mkdirSync(r('build/current'), { recursive: true });
  fs.copyFileSync(target, r('build/current/index.html'));
  const res = spawnSync(process.execPath, [CLI, 'build/current/index.html', '--decrypt', '-d', 'build/current-decrypted', '--config', '.staticrypt.json'], { cwd: ROOT, encoding: 'utf8' });
  const prev = r('build/current-decrypted/index.html');
  changed = !(res.status === 0 && fs.existsSync(prev) && fs.readFileSync(prev, 'utf8') === payload);
}
if (!changed) {
  console.log('The schedule and page are unchanged, so now/index.html was left as it is.');
  if (!publish) process.exit(0);
} else fs.copyFileSync(r('build/encrypted/index.html'), target);
if (changed) console.log(`Encrypted page rebuilt: now/index.html (${data.blocks.length} blocks).` +
  (hadSalt ? ' Same salt as before, so "Remember me" keeps working.' : ' First build: a new salt was saved in .staticrypt.json; commit it.') +
  '\nChecked: no readable schedule text, no inline code, and it decrypts back to the same data.');

if (publish) {
  run('git', ['add', 'now/index.html', '.staticrypt.json', ...(fs.existsSync(r('relay/url.txt')) ? ['relay/url.txt'] : [])]);
  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT }).status !== 0;
  if (!staged) { console.log('Nothing new to publish.'); process.exit(0); }
  run('git', ['commit', '-m', 'Update the encrypted schedule']); // the privacy check runs here too
  run('git', ['pull', '--rebase', '--autostash']);                 // the weather recorder commits twice an hour
  run('git', ['push']);
  console.log('Published. GitHub usually updates the site within a few minutes; the display picks it up at its next daily reload.');
} else if (changed) {
  console.log('To publish it:  npm run now -- --publish');
}
