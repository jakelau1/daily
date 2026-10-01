// Checks the published "now" page on GitHub Pages in headless Chromium, the way the phone uses it:
//   node tools/check-live.mjs
// - the published page contains no readable schedule text
// - it unlocks with the password from .env, and unlocks by itself after a reload ("Remember me")
// - no Content-Security-Policy violations, script errors or failed requests (so every live feed it uses loaded)
// Saves build/screenshots/live-now.png (git-ignored). Set CHROME=/path/to/chrome to choose the browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { phrases } from './check-private.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://jakelau1.github.io/daily/now/';
const password = (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^STATICRYPT_PASSWORD=(.*)$/m) || [])[1];
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const dir = path.join(os.homedir(), '.cache', 'ms-playwright');
  return fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1])
    .map(d => path.join(dir, d, 'chrome-linux64', 'chrome')).find(f => fs.existsSync(f));
}

let bad = 0;
const report = (ok, msg) => { if (!ok) bad++; console.log((ok ? 'ok    ' : 'FAIL  ') + msg); };

const html = await (await fetch(URL + '?t=' + Date.now(), { cache: 'no-store' })).text();
report(!phrases().some(p => html.includes(p)), 'published page has no readable schedule text');

const browser = await chromium.launch({ executablePath: findChrome() });
const ctx = await browser.newContext({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [], hosts = {};
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('script error: ' + e.message));
page.on('requestfailed', r => errors.push('failed: ' + r.url() + ' ' + (r.failure() || {}).errorText));
page.on('response', r => { const h = new globalThis.URL(r.url()).host; (hosts[h] ||= []).push(r.status()); });
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', e => console.error(`CSP blocked ${e.violatedDirective}: ${e.blockedURI}`));
});
await page.goto(URL);
await page.locator('#pw').waitFor();
const t0 = Date.now();
await page.fill('#pw', password);
await page.click('#unlock');
await page.locator('#app').waitFor({ timeout: 30000 });
report(true, `unlocked with the password in ${Date.now() - t0} ms (title "${await page.title()}")`);
await page.reload();
await page.locator('#app').waitFor({ timeout: 30000 });
report(await page.locator('#lock').isHidden(), 'unlocked by itself after a reload');
await page.waitForTimeout(4000);
report(!!(await page.evaluate(() => window.NowPlan)), 'planning picker code loaded');
report(await page.locator('#banner').isHidden(), 'no "no connection" banner');
const wx = await page.evaluate(() => ({ temp: document.getElementById('wx-temp').textContent, tempOld: document.getElementById('wx-temp').classList.contains('old'),
  air: document.getElementById('wx-air').textContent, airOld: document.getElementById('wx-air').classList.contains('old'),
  problem: document.getElementById('wx-problem').textContent, prompt: document.getElementById('prompt').textContent,
  alert: !document.getElementById('alert').hidden }));
report(!!wx.temp && !wx.tempOld, `current temperature shown and fresh: "${wx.temp}"`);
report(!!wx.air, `air quality shown: "${wx.air}"${wx.airOld ? ' (greyed: the saved copy is more than 4 hours old)' : ''}`);
report(!wx.problem, 'no "Weather unavailable" notice');
console.log(`      prompt now: "${wx.prompt}"; warning takeover: ${wx.alert ? 'yes' : 'no'}`);
for (const [h, s] of Object.entries(hosts)) report(s.every(x => x < 400), `${h}: ${s.length} request(s), status ${[...new Set(s)].join(', ')}`);
report(!errors.length, 'no policy violations, script errors or failed requests' + (errors.length ? ':\n      ' + errors.join('\n      ') : ''));
fs.mkdirSync(path.join(ROOT, 'build', 'screenshots'), { recursive: true });
await page.screenshot({ path: path.join(ROOT, 'build', 'screenshots', 'live-now.png') });
await browser.close();
console.log(bad ? `\n${bad} problem(s).` : '\nAll fine.');
process.exit(bad ? 1 : 0);
