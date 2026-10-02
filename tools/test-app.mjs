// End-to-end test of the Android app, run on an emulator (never a real phone: it refuses any other device).
//   1. start the emulator:  ~/Android/Sdk/emulator/emulator -avd verify_gpu -no-window -no-audio -no-snapshot -gpu swangle_indirect
//   2. build the app:       node tools/build-app.mjs --apk
//   3. run this:            node tools/test-app.mjs
// It installs the newest APK in app/dist/ on a clean emulator, starts it, talks to the app's own web view through
// Chrome's debugging connection (debug builds only; Playwright can't attach to an Android web view, so this uses a small
// direct client), and checks: the page starts from the bundled schedule; the
// database keeps what is saved, across a reload and across the app being stopped; backup and restore (good and bad
// files); the screen stays awake while the app is in front; the screen is landscape; the feeds that block web pages can
// be read inside the app; and nothing logs a script error or a security-policy violation.
// Screenshots go to build/screenshots-app/ (git-ignored, because they show the schedule). Nothing here prints the schedule.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'build', 'screenshots-app');
const SERIAL = process.env.ANDROID_SERIAL || 'emulator-5554';
const PKG = 'com.getready.app', PORT = 9333;
if (!/^emulator-\d+$/.test(SERIAL)) { console.error(`Refusing to run: "${SERIAL}" is not an emulator. This test never touches a real phone.`); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

const adb = (...a) => spawnSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const sh = cmd => (adb('shell', cmd).stdout || '').replace(/\r/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0, failures = 0;
const check = (ok, msg) => { checks++; if (!ok) { failures++; console.log('  FAIL ' + msg); } };

if (!(spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout || '').includes(SERIAL + '\tdevice')) { console.error(`No emulator "${SERIAL}" is running; see the top of this file.`); process.exit(2); }
const apks = fs.readdirSync(path.join(ROOT, 'app', 'dist')).filter(f => /^GetReady-v.*-debug\.apk$/.test(f)).sort();
if (!apks.length) { console.error('No APK in app/dist/: run node tools/build-app.mjs --apk'); process.exit(2); }
const APK = path.join(ROOT, 'app', 'dist', apks[apks.length - 1]);

// ---------- helpers ----------
function tapText(text) {                     // tap an on-screen control by its label (text may be a pattern), using the view tree
  adb('shell', 'uiautomator dump /sdcard/ui.xml');
  const xml = sh('cat /sdcard/ui.xml');
  const m = new RegExp(`text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
  if (!m) return false;
  adb('shell', `input tap ${Math.round((+m[1] + +m[3]) / 2)} ${Math.round((+m[2] + +m[4]) / 2)}`);
  return true;
}
function shot(name) { const r = spawnSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }); fs.writeFileSync(path.join(SHOTS, name + '.png'), r.stdout); return r.stdout; }
const pngSize = b => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const HOOK = "window.__errs = []; (function () { var e = console.error; console.error = function () { try { window.__errs.push([].map.call(arguments, function (a) { return typeof a === 'object' && a ? JSON.stringify(a, Object.getOwnPropertyNames(a)) : String(a); }).join(' ').slice(0, 300)); } catch (_) {} e.apply(console, arguments); }; })();";
// A tiny client for Chrome's debugging protocol over a WebSocket: evaluate JavaScript in the page, reload it, hear its errors.
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.problems = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id)) { const [ok, bad] = this.waiting.get(m.id); this.waiting.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); return; }
      if (m.method === 'Runtime.exceptionThrown') this.problems.push('script error: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') this.problems.push('log: ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || ''));
    });
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((ok, bad) => { this.waiting.set(id, [ok, bad]); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expression, userGesture = false) {  // run JavaScript in the page and return its value (promises are awaited)
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  }
  async waitFor(expression, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await this.ev(expression)) return true; } catch { /* page is reloading */ } await sleep(250); } throw new Error('timed out waiting for: ' + expression.slice(0, 100)); }
  async errors() { try { return (await this.ev('window.__errs || []')).map(t => 'console: ' + t); } catch { return []; } }
  async reload() { this.problems.push(...await this.errors()); await this.send('Page.reload'); await sleep(800); await this.ready(); }
  async ready() { await this.waitFor("!!document.getElementById('app') && !document.getElementById('app').hidden && document.getElementById('label').textContent.length > 0", 30000); }
  btn(text) { return `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.closest('[hidden]'))`; }
  async click(text) { await this.waitFor(this.btn(text)); await this.ev(`${this.btn(text)}.click()`); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}
async function attach() {                    // find the app's web view and attach to it
  for (let i = 0; i < 40; i++) {
    const m = /@webview_devtools_remote_(\d+)/.exec(sh('cat /proc/net/unix'));
    if (m) {
      adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${m[1]}`);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        const target = list.find(t => t.type === 'page' && t.url.startsWith('https://localhost'));
        if (target) {
          const ws = new WebSocket(target.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${PORT}`));
          await new Promise((ok, bad) => { ws.addEventListener('open', ok); ws.addEventListener('error', bad); });
          const page = new Page(ws);
          await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Page.enable');
          await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });   // keeps what console.error was given, in full
          await page.reload();
          return page;
        }
      } catch { /* not ready yet */ }
    }
    await sleep(1000);
  }
  throw new Error("could not attach to the app's web view");
}
async function tapWhenShown(text, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (tapText(text)) return true; await sleep(700); } return false; }
const start = () => { adb('shell', `am start -n ${PKG}/.MainActivity`); };

// ---------- 1. fresh install ----------
console.log('Installing and starting the app on ' + SERIAL);
const stayOn = sh('settings get global stay_on_while_plugged_in').trim();   // emulators are "charging": that setting would hide whether the app itself keeps the screen on
adb('shell', 'settings put global stay_on_while_plugged_in 0');
adb('shell', 'settings put system screen_off_timeout 600000');
adb('shell', 'input keyevent KEYCODE_HOME');                  // close any picker left open by an earlier run
const inst = adb('install', '-r', APK); check(/Success/.test(inst.stdout), 'install failed: ' + inst.stdout + inst.stderr);
adb('shell', `pm clear ${PKG}`); adb('logcat', '-c');
start();
let page = await attach();
const problems = page.problems;
await page.ready();

console.log('The page starts from the bundled schedule');
const first = await page.ev(`({
  title: document.title, clock: document.getElementById('clock-hm').textContent, label: document.getElementById('label').textContent,
  kicker: document.getElementById('kicker').textContent, platform: window.Capacitor.getPlatform(), isNative: window.AppStore.isNative })`);
check(first.title === 'Now', `title is "${first.title}"`);
check(/^\d{1,2}:\d{2}$/.test(first.clock), `clock shows "${first.clock}"`);
check(first.label.length > 0 && /^(Now|Free time|Time to leave|Get ready)/i.test(first.kicker), `no current item or gap shown (kicker "${first.kicker}")`);
check(first.platform === 'android' && first.isNative, 'the page is not running as the native Android app');
const data = await page.ev("fetch('data.json').then(r => r.json())");
check(Array.isArray(data.blocks) && data.blocks.length > 0 && data.night && data.night.from != null && data.night.to != null, 'bundled data.json lacks blocks or the dimming period');

console.log('Database: saved choices survive a reload and the app being stopped');
await page.ev("window.NowStorage.setItem('test.key', 'v1'); window.NowStorage.setItem('test.other', 'x'); window.AppStore.flush()");
const dbFile = sh(`run-as ${PKG} ls databases`).trim();
check(/getready/i.test(dbFile), 'no database file in the app: ' + dbFile);
await page.reload();
check(await page.ev("window.NowStorage.getItem('test.key')") === 'v1', 'value lost after a reload');
problems.push(...await page.errors());
adb('shell', `am force-stop ${PKG}`); page.close(); await sleep(1500);
start(); page = await attach(); problems.push(...[]); await page.ready();
const problems2 = page.problems;
check(await page.ev("window.NowStorage.getItem('test.key')") === 'v1', 'value lost after the app was stopped and started again');
const rows = sh(`run-as ${PKG} sqlite3 databases/getreadySQLite.db "select key from kv order by key"`).trim();
if (/not found|No such|inaccessible/i.test(rows)) console.log('      (sqlite3 is not on this emulator, so the rows were not read from the file directly)');
else check(/test\.key/.test(rows), 'the row is not in the database file itself: ' + rows);

console.log('Backup and restore');
const bk = await page.ev("(() => { const t = window.AppData.makeBackup(); return { parsed: JSON.parse(t), ok: window.AppData.readBackup(t).ok }; })()");
check(bk.parsed.app === 'get-ready' && bk.parsed.schemaVersion === 1 && bk.parsed.kv['test.key'] === 'v1' && bk.ok, 'backup text is not as expected');
check(!JSON.stringify(bk.parsed).includes(data.blocks[0].label), 'the backup contains schedule text');
const bad = await page.ev(`['not json', '{"app":"other","schemaVersion":1,"kv":{}}', '{"app":"get-ready","schemaVersion":99,"kv":{}}', '{"app":"get-ready","schemaVersion":1,"kv":{"a":5}}', '{"app":"get-ready","schemaVersion":1,"kv":[1]}'].map(t => window.AppData.readBackup(t))`);
check(bad.every(r => r.ok === false && r.why), 'a bad backup file was accepted');
await page.ev("document.getElementById('app').click()");
await page.waitFor("!document.getElementById('plan').hidden");
await sleep(600); shot('02-picker');
await page.click('Back up or restore data');
await sleep(600); shot('03-backup-screen');
check((await page.ev("document.getElementById('plan-body').innerText")).includes('saved on this phone only'), 'the backup screen does not say the data stays on this phone');
// the real round trip, through Android's own file picker: save a backup, change the data, restore from the saved file
await page.click('Back up to a file');
check(await tapWhenShown('SAVE'), 'the "Save to…" picker did not open or has no Save button');
await sleep(2000);
const saved = sh("ls -1 /sdcard/Download/GetReady-backup-*.json /sdcard/Documents/GetReady-backup-*.json 2>/dev/null | head -1").trim();
check(!!saved, 'no backup file was saved');
const savedJson = saved ? JSON.parse(sh(`cat '${saved}'`)) : {};
check(savedJson.app === 'get-ready' && savedJson.kv && savedJson.kv['test.key'] === 'v1', 'the saved file does not hold the expected data');
await page.ev("window.NowStorage.setItem('test.key', 'changed'); window.AppStore.flush()");
await page.click('Back up or restore data').catch(() => {});
await page.ev(`${page.btn('Restore from a file')}.click()`, true);                 // user gesture: the file chooser needs one
check(await tapWhenShown('GetReady-back[^"]*'), 'the file picker did not list the saved backup');
await page.waitFor(page.btn('Replace what is on this phone'), 15000);
check((await page.ev("document.getElementById('plan-body').innerText")).includes('2 saved items'), 'the restore confirmation does not say what the file holds');
shot('04-restore-confirm');
await page.click('Replace what is on this phone');
await sleep(1500); await page.ready();
check(await page.ev("window.NowStorage.getItem('test.key')") === 'v1', 'restoring from the saved file did not bring the original data back');
adb('shell', "rm -f /sdcard/Download/GetReady-backup-*.json /sdcard/Documents/GetReady-backup-*.json");
// a good file written by hand replaces everything, a bad file changes nothing
await page.ev("document.getElementById('app').click()"); await page.waitFor("!document.getElementById('plan').hidden"); await page.click('Back up or restore data');
await page.ev(`(() => {
  const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify({ app: 'get-ready', schemaVersion: 1, exportedAtMillis: Date.now(), kv: { 'test.restored': 'yes' } })], 'b.json', { type: 'application/json' }));
  const input = document.querySelector('.data-file'); input.files = dt.files; input.dispatchEvent(new Event('change')); })()`);
await page.waitFor(page.btn('Replace what is on this phone'));
check((await page.ev("document.getElementById('plan-body').innerText")).includes('1 saved item'), 'the restore confirmation does not say what a hand-made file holds');
await page.click('Replace what is on this phone');
await sleep(1500); await page.ready();
const after = await page.ev("({ r: window.NowStorage.getItem('test.restored'), old: window.NowStorage.getItem('test.key') })");
check(after.r === 'yes' && after.old === null, `restore did not replace the saved data (${JSON.stringify(after)})`);
// a damaged file changes nothing
await page.ev("document.getElementById('app').click()"); await page.waitFor("!document.getElementById('plan').hidden"); await page.click('Back up or restore data');
await page.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['{"app":"get-ready","schemaVersion":1,"kv":{"a":5}}'], 'bad.json')); const i = document.querySelector('.data-file'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
await page.waitFor("document.querySelector('.plan-msg') && document.querySelector('.plan-msg').textContent.includes('damaged')", 5000);
check(await page.ev("window.NowStorage.getItem('test.restored')") === 'yes', 'a damaged file changed the saved data');
await page.ev("window.NowStorage.removeItem('test.restored'); window.AppStore.flush()");

console.log('Feeds that block web pages, read inside the app');
const feeds = {
  'hourly forecast files (maps.weather.gov.hk)': ['https://maps.weather.gov.hk/ocf/dat/HPV.xml', t => !!JSON.parse(t).HourlyWeatherForecast],
  'air quality (www.aqhi.gov.hk)': ['https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_Eng.xml', t => /<rss/.test(t)],
  'gridded rain forecast (data.weather.gov.hk/hko_data)': ['https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv', t => t.split('\n').length > 100],
  'public holidays (www.1823.gov.hk)': ['https://www.1823.gov.hk/common/ical/en.json', t => /vcalendar/.test(t)],
  'hospital waiting times (www.ha.org.hk)': ['https://www.ha.org.hk/aedwt/data/aedWtData2.json', t => !!JSON.parse(t).result]
};
for (const [name, [url, valid]] of Object.entries(feeds)) {
  const r = await page.ev(`fetch(${JSON.stringify(url)}).then(async x => ({ ok: x.ok, status: x.status, text: await x.text() }), e => ({ error: String(e) }))`);
  let good = false; try { good = !r.error && r.ok && valid(r.text.replace(/^﻿/, '')); } catch { /* not valid */ }
  console.log(`      ${good ? 'readable' : 'NOT readable'}: ${name}${r.error ? ' (' + r.error.slice(0, 60) + ')' : r.ok ? '' : ' (status ' + r.status + ')'}`);
  check(good, `cannot read ${name} inside the app`);
}

console.log('Screen: landscape, stays awake');
const png = pngSize(shot('01-now'));
check(png.w > png.h, `the screen is not landscape (${png.w}x${png.h})`);
tapText('Got it');
adb('shell', 'settings put system screen_off_timeout 10000');
await sleep(16000);
check(/mWakefulness=Awake/.test(sh('dumpsys power')), 'the screen went to sleep while the app was in front');
adb('shell', 'input keyevent KEYCODE_HOME'); await sleep(16000);      // control: with the app not in front, the same timeout does put the screen to sleep
check(!/mWakefulness=Awake/.test(sh('dumpsys power')), 'control failed: the screen stayed awake with the app not in front, so the test proves nothing');
adb('shell', 'input keyevent KEYCODE_WAKEUP'); adb('shell', 'settings put system screen_off_timeout 600000'); start(); await sleep(2500);

console.log('No script errors or policy violations');
const ours = [...problems, ...problems2].filter(p => !/Failed to load resource.*(ocf|aqhi|nowcast)/.test(p));
ours.push(...await page.errors());
check(ours.length === 0, 'problems: ' + [...new Set(ours)].join(' | '));
const crashes = (adb('logcat', '-d').stdout || '').split('\n').filter(l => /FATAL EXCEPTION|AndroidRuntime/.test(l) && l.includes(PKG));
check(crashes.length === 0, 'the app crashed: ' + crashes.slice(0, 2).join(' | '));

adb('shell', `settings put global stay_on_while_plugged_in ${stayOn || 0}`);
page.close();
console.log(`\n${checks} checks, ${failures} failed. Screenshots in build/screenshots-app/.`);
process.exit(failures ? 1 : 0);
