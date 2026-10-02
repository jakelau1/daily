// Builds the Android app's web files into build/app-www (git-ignored) from the same sources as the website, bundles the
// private schedule into them, syncs them into the Android project, and optionally builds a debug APK.
//   node tools/build-app.mjs            assemble the web files and sync them into app/android
//   node tools/build-app.mjs --apk      the same, then build app/dist/GetReady-v<version>-debug.apk
//   node tools/build-app.mjs --release  the same, then build app/dist/GetReady-v<version>-release.apk, signed with the release key
//                                       (made once with tools/release-key.mjs). The key's password is typed into a prompt in a real
//                                       terminal; it is passed to that one build only and is never written to any file.
// What goes in:  the public site (as build/app-www/site/), the Now page code from now/, the app's own files from
// app/web/, Capacitor's runtime, and data.json (the schedule, read from private/schedule.html by extract-schedule.mjs).
// Nothing built here is ever committed or uploaded: the script stops if git is not ignoring its output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extract, check } from './extract-schedule.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'build', 'app-www');
const APP = path.join(ROOT, 'app');
const wantRelease = process.argv.includes('--release');
const wantApk = process.argv.includes('--apk');
function askHidden(question) {            // read a line from the terminal without showing it
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin; let text = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = chunk => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(text); }
        if (c === '\u0003') process.exit(130);
        text = c === '\u007f' || c === '\b' ? text.slice(0, -1) : text + c;
      }
    };
    stdin.on('data', onData);
  });
}
const stop = msg => { console.error('\nStopped: ' + msg + '\n'); process.exit(1); };
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, CI: '1' } });
  if (r.status !== 0) stop(`${cmd} ${args.join(' ')} failed:\n${(r.stdout || '') + (r.stderr || '')}`.slice(-3000));
  return r.stdout;
};

// 0. Refuse to build unless git ignores everything this produces (the schedule is inside it).
for (const p of ['build/app-www/data.json', 'app/dist/x.apk', 'app/android/app/build/x', 'app/android/app/src/main/assets/public/data.json', 'app/android/local.properties', 'app/node_modules/x'])
  if (spawnSync('git', ['check-ignore', '-q', p], { cwd: ROOT }).status !== 0) stop(`git is not ignoring ${p}; fix .gitignore first.`);
if (!fs.existsSync(path.join(APP, 'android'))) stop('app/android does not exist yet: run "npx cap add android" in app/ once.');
if (!fs.existsSync(path.join(APP, 'node_modules', '@capacitor', 'core'))) stop('run "npm install" in app/ first.');

// 1. The schedule, checked.
const data = extract();
const problems = check(data);
if (problems.length) stop('the schedule has problems:\n  ' + problems.join('\n  '));

// 2. Assemble.
fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
const cp = (from, to) => fs.cpSync(from, to, { recursive: true, filter: s => !/\.DS_Store$/.test(s) });
for (const p of ['index.html', '404.html', 'assets', 'weather', 'hiking', 'arrivals', 'cams', 'trips', 'savings', 'study'])
  cp(path.join(ROOT, p), path.join(WWW, 'site', p));
for (const f of ['now.css', 'now.js', 'plan.js', 'wx.js', 'ping.txt']) cp(path.join(ROOT, 'now', f), path.join(WWW, f));
for (const f of ['store.js', 'app-start.js', 'data-panel.js', 'direct-feeds.js', 'app.css']) cp(path.join(APP, 'web', f), path.join(WWW, f));
cp(path.join(APP, 'web', 'now.html'), path.join(WWW, 'index.html'));
cp(path.join(APP, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), path.join(WWW, 'capacitor.js'));
// The weather reading points (private: they name the home area); the app's direct feed reader gets them from here.
try { data.feeds = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'config.json'), 'utf8')).feeds || null; } catch { data.feeds = null; }
if (!data.feeds) console.warn('Note: private/config.json has no "feeds" section, so the app will use the bundled weather copies only.');
fs.writeFileSync(path.join(WWW, 'data.json'), JSON.stringify(data));

// 3. Quick checks on the result: no inline code (the page's security policy would refuse it), every script it names exists.
const page = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
for (const tag of page.match(/<script\b[^>]*>/g) || []) if (!/\bsrc=/.test(tag)) stop('the app page has inline code: ' + tag);
if (/\sstyle=|<style/i.test(page)) stop('the app page has inline styles.');
for (const m of page.matchAll(/(?:src|href)="([^"]+\.(?:js|css|svg))"/g)) if (!fs.existsSync(path.join(WWW, m[1]))) stop(`the app page names ${m[1]}, which is missing.`);

// 4. Version: app/package.json is the source; the Android project follows it.
const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
const [maj, min, pat] = version.split('.').map(Number);
const gradleFile = path.join(APP, 'android', 'app', 'build.gradle');
let gradle = fs.readFileSync(gradleFile, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${maj * 10000 + min * 100 + pat}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradleFile, gradle);

// 5. Sync into the Android project.
run('npx', ['cap', 'sync', 'android'], APP);
console.log(`App files assembled in build/app-www (${data.blocks.length} blocks bundled) and synced into app/android.`);

// 6a. The release APK.
if (wantRelease) {
  const keystore = process.env.GETREADY_KEYSTORE || path.join(process.env.HOME, 'keys', 'get-ready', 'get-ready-release.jks');
  if (!fs.existsSync(keystore)) stop(`no release key at ${keystore}. Make it once with:  node tools/release-key.mjs create`);
  if (!process.stdin.isTTY) stop('the key password must be typed into a prompt, so run this in a real terminal (not through an assistant or a script).');
  const password = await askHidden('Release key password (typing is hidden): ');
  if (!password) stop('no password entered.');
  const r = spawnSync('./gradlew', ['assembleRelease', '--no-daemon', '--console=plain'], {
    cwd: path.join(APP, 'android'), encoding: 'utf8',
    env: { ...process.env, CI: '1', GETREADY_KEYSTORE: keystore, GETREADY_KEY_PASSWORD: password }   // this one build only; --no-daemon so no background Gradle keeps it
  });
  if (r.status !== 0) stop('the release build failed:\n' + ((r.stdout || '') + (r.stderr || '')).replace(password, '***').slice(-2500));
  const built = path.join(APP, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!fs.existsSync(built)) stop('the build finished but no release APK was found (was it left unsigned?).');
  fs.mkdirSync(path.join(APP, 'dist'), { recursive: true });
  const out = path.join(APP, 'dist', `GetReady-v${version}-release.apk`);
  fs.copyFileSync(built, out);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  const apksigner = spawnSync('sh', ['-c', 'ls ~/Android/Sdk/build-tools/*/apksigner | tail -1'], { encoding: 'utf8' }).stdout.trim();
  const cert = apksigner ? (spawnSync(apksigner, ['verify', '--print-certs', out], { encoding: 'utf8' }).stdout.match(/SHA-256 digest: (\w+)/) || [])[1] : null;
  console.log(`\nRelease APK: app/dist/GetReady-v${version}-release.apk  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)\nSHA-256 of the file: ${sha}\nSigned by key fingerprint: ${cert || '(apksigner not found; not checked)'}\nIt holds your schedule: keep it on this computer and install it by hand. It is git-ignored and must never be uploaded.`);
  process.exit(0);
}

// 6. The APK.
if (wantApk) {
  run('./gradlew', ['assembleDebug', '--console=plain'], path.join(APP, 'android'));
  const built = path.join(APP, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!fs.existsSync(built)) stop('the build finished but no APK was found.');
  fs.mkdirSync(path.join(APP, 'dist'), { recursive: true });
  const out = path.join(APP, 'dist', `GetReady-v${version}-debug.apk`);
  fs.copyFileSync(built, out);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  console.log(`\nAPK: app/dist/GetReady-v${version}-debug.apk  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)\nSHA-256: ${sha}\nIt holds your schedule: keep it on this computer and install it by hand. It is git-ignored and must never be uploaded.`);
}
