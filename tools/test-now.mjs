// End-to-end test of the encrypted "now" page in a real (headless) Chromium, with simulated days and times.
//   npm run now && npm run test-now
// Serves the site on this computer at http://127.0.0.1:8765/daily/ (like GitHub Pages; private/, build/ and
// .env are refused), unlocks the page with the password from .env, then checks:
//   - every block's start and end, and the middle of every gap, against a separate calculation in this file
//   - midnight, and Sunday night into Monday
//   - nothing overflows the screen (landscape and portrait), no Content-Security-Policy violations, no script errors
//   - wrong password, "Remember me" (never expires), offline banner, greying out, burn-in shift, daily reload
// Screenshots go to build/screenshots/ (git-ignored, because they show the schedule).
// Chromium: set CHROME=/path/to/chrome, otherwise the newest one Playwright has downloaded is used.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'build', 'screenshots');
const PORT = 8765, BASE = `http://127.0.0.1:${PORT}/daily/now/`;
const PASSWORD = (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^STATICRYPT_PASSWORD=(.*)$/m) || [])[1];
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'payload', 'index.html'), 'utf8'));
if (!PASSWORD) throw new Error('No password in .env');
fs.mkdirSync(SHOTS, { recursive: true });

// ---------- a tiny GitHub-Pages-like server ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
let offlineServer = false;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (offlineServer || !p.startsWith('/daily/')) { res.writeHead(404); return res.end(); }
  p = p.slice(7);
  if (/^(private|build|node_modules|tools)\b|^\.env|\.\./.test(p)) { res.writeHead(403); return res.end(); }
  let f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const dir = path.join(os.homedir(), '.cache', 'ms-playwright');
  const found = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1])
    .map(d => path.join(dir, d, 'chrome-linux64', 'chrome')).find(f => fs.existsSync(f));
  if (!found) throw new Error('No Chromium found; set CHROME=/path/to/chrome');
  return found;
}
const browser = await chromium.launch({ executablePath: findChrome() });

// ---------- independent expectations ----------
const DAY = 1440, WEEK = 7 * DAY;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fmtT = min => {
  min = ((min % DAY) + DAY) % DAY;
  if (min === 0) return 'midnight';
  if (min === 720) return 'noon';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
};
const fmtD = m => m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
const weekBlocks = DATA.blocks.map(b => ({ ...b, s: b.day * DAY + b.start, e: b.day * DAY + b.end })).sort((a, b) => a.s - b.s);
function expect(w) { // w = minutes since Monday 00:00 Hong Kong time (fractional)
  const today = Math.floor(w / DAY);
  const after = t => weekBlocks.find(b => b.s >= t) || { ...weekBlocks[0], s: weekBlocks[0].s + WEEK };
  const when = s => { const d = (Math.floor(s / DAY) - today + 7) % 7; return d === 0 ? '' : d === 1 ? ' tomorrow' : ' on ' + DAYS[Math.floor(s / DAY) % 7]; };
  const cur = weekBlocks.find(b => b.s <= w && w < b.e);
  if (cur) {
    const n = after(cur.e);
    return { label: cur.label, left: fmtD(Math.ceil(cur.e - w)) + ' left',
      next: `Next ${fmtT(n.start)}${when(n.s)} · ${n.label}` + (n.s > cur.e ? ` · in ${fmtD(Math.ceil(n.s - w))}` : '') };
  }
  const n = after(Math.ceil(w));
  const fl = DATA.cats[n.cat]?.floor;
  return { label: `Free until ${fmtT(n.start)}${when(n.s)}`, left: fmtD(Math.ceil(n.s - w)) + ' free', next: `Then ${n.label}` + (fl ? ` · floor: ${fl}` : '') };
}

// Hong Kong wall-clock time in the test week (Monday 5 October 2026) -> Date
const MONDAY = Date.UTC(2026, 9, 5, -8); // 00:00 HK
const at = (day, min) => new Date(MONDAY + (day * DAY + min) * 60e3);

// ---------- made-up weather, in the same formats as the real feeds (so tests never depend on today's weather) ----------
// WX is changed by the tests; every request is answered from it at that moment. simNow follows the simulated clock,
// so readings carry believable times.
const WX = { warn: {}, raining: false, nowTemp: 28, temps: {}, icons: {}, aqhi: 3, aqhiRisk: 'Low', forecast: 'Low',
  sunset: '18:07', fail: false, airAgeMin: 30, nowcast: { ageMin: 10, mm: [0, 0, 0, 0] } };
let simNow = MONDAY;
const hk = ms => { const d = new Date(ms + 8 * 3600e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }; };
const p2 = n => String(n).padStart(2, '0');
const hourKey = ms => { const t = hk(ms); return `${t.y}${p2(t.mo)}${p2(t.d)}${p2(t.h)}`; };
function ocfFixture() {
  const hours = [];
  for (let h = -24; h < 72; h++) {
    const ms = Math.floor(simNow / 3600e3) * 3600e3 + h * 3600e3, k = hourKey(ms);
    hours.push({ k, temp: WX.temps[k] ?? 28, icon: WX.icons[k] ?? 51 });
  }
  const t = hk(simNow - 3600e3), lm = `${t.y}${p2(t.mo)}${p2(t.d)}${p2(t.h)}0000`;
  return { stations: {
    HPV: { LastModified: lm, HourlyWeatherForecast: hours.map(x => ({ ForecastHour: x.k, ForecastTemperature: x.temp })) },
    HKO: { LastModified: lm, HourlyWeatherForecast: hours.map(x => ({ ForecastHour: x.k, ForecastTemperature: x.temp, ForecastWeather: x.icon })) } } };
}
function aqhiFixture() {
  const t = hk(simNow - WX.airAgeMin * 60e3);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const stamp = `${WD[t.wd]}, ${p2(t.d)} ${MON[t.mo - 1]} ${t.y} ${p2(t.h)}:${p2(t.mi)}`;
  const item = (name, v, risk) => `<item><title>${name}</title><description><![CDATA[${name} - General Stations: ${v} ${risk} - ${stamp}]]></description></item>`;
  return {
    ind: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${item('Central/Western', 3, 'Low')}${item('Eastern', WX.aqhi, WX.aqhiRisk)}</channel></rss>`,
    range: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item><title>Forecast of Health Risk: </title><description><![CDATA[<p>&lt;Today A.M.&gt;<p>General Stations: ${WX.forecast}</p><p>Roadside Stations: ${WX.forecast}</p></p><p>&lt;Today P.M.&gt;<p>General Stations: ${WX.forecast}</p><p>Roadside Stations: ${WX.forecast}</p></p>]]></description></item></channel></rss>`
  };
}
async function newContext() {
  const c = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await c.route('https://data.weather.gov.hk/**', route => {
    if (WX.fail) return route.abort('internetdisconnected');
    const u = new URL(route.request().url()), type = u.searchParams.get('dataType');
    const t = hk(simNow);
    if (type === 'warnsum') return json(route, WX.warn);
    if (type === 'rhrread') return json(route, {
      temperature: { recordTime: `${t.y}-${p2(t.mo)}-${p2(t.d)}T${p2(t.h)}:00:00+08:00`, data: [{ place: 'Happy Valley', value: WX.nowTemp, unit: 'C' }] },
      rainfall: { data: [{ place: 'Wan Chai', max: WX.raining ? 6 : 0, unit: 'mm', main: 'FALSE' }] } });
    if (type === 'SRS') {
      const days = new Date(Date.UTC(t.y, t.mo, 0)).getUTCDate();
      return json(route, { fields: ['YYYY-MM-DD', 'RISE', 'TRAN.', 'SET'], data: Array.from({ length: days }, (_, i) => [`${t.y}-${p2(t.mo)}-${p2(i + 1)}`, '06:16', '12:12', WX.sunset]) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await c.route('**/daily/weather/data/ocf.json*', route => json(route, ocfFixture()));
  await c.route('**/daily/weather/data/aqhi.json*', route => json(route, aqhiFixture()));
  await c.route('**/daily/weather/data/nowcast.json*', route => {
    const up = Math.floor((simNow - WX.nowcast.ageMin * 60e3) / 60e3) * 60e3;
    const iso = ms => { const t = hk(ms); return `${t.y}-${p2(t.mo)}-${p2(t.d)}T${p2(t.h)}:${p2(t.mi)}:00+08:00`; };
    return json(route, { updated: iso(up), lat: 22.268, lon: 114.182, periods: WX.nowcast.mm.map((mm, i) => ({ end: iso(up + (i + 1) * 30 * 60e3), mm })) });
  });
  return c;
}

let failures = 0, checks = 0;
const fail = msg => { failures++; console.log('  FAIL ' + msg); };

async function newPage(context, start, viewport = { width: 800, height: 360 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  page.problems = [];
  page.on('console', m => { if (m.type() === 'error') page.problems.push('console: ' + m.text()); });
  page.on('pageerror', e => page.problems.push('script error: ' + e.message));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`CSP blocked ${e.violatedDirective}: ${e.blockedURI}`));
  });
  simNow = start.getTime();
  await page.clock.install({ time: start });
  await page.goto(BASE);
  return page;
}
async function unlock(page, password = PASSWORD, remember = true) {
  await page.locator('#pw').waitFor();
  await page.fill('#pw', password);
  if (!remember) await page.uncheck('#remember');
  await page.click('#unlock');
}
async function screen(page) {
  return page.evaluate(() => {
    const t = id => { const e = document.getElementById(id); return e.hidden ? '' : e.textContent; };
    const over = [...document.querySelectorAll('.time, .block')].filter(e => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map(e => e.className);
    if (document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth) over.push('page');
    return { label: t('label'), left: t('left'), next: t('next'), kicker: t('kicker'), floor: t('floor'), clock: t('clock'),
      prompt: t('prompt'), alert: !document.getElementById('alert').hidden, over, now: Date.now() };
  });
}
async function goTo(page, day, min, sec = 0) {
  simNow = at(day, min).getTime() + sec * 1000;
  await page.clock.setSystemTime(new Date(simNow));
  await page.clock.runFor(1100);
  return screen(page);
}
function compare(s, where) {
  checks++;
  const w = (s.now - MONDAY) / 60e3;
  const e = expect(w % WEEK);
  for (const k of ['label', 'left', 'next']) if (s[k] !== e[k]) return fail(`${where}: ${k} shows "${s[k]}", expected "${e[k]}"`);
  if (s.over.length) fail(`${where}: text overflows (${s.over.join(', ')})`);
  if (s.alert) fail(`${where}: a warning took over the screen with no warning in force`);
}

// ---------- 1. wrong password, then unlock with "Remember me" ----------
console.log('Unlocking');
const ctx = await newContext();
let page = await newPage(ctx, at(0, 12 * 60));
await page.locator('#pw').waitFor();
await page.screenshot({ path: `${SHOTS}/01-locked.png` });
await unlock(page, 'not the password');
await page.waitForFunction(() => /didn’t work/.test(document.getElementById('lock-msg').textContent), null, { timeout: 30000 });
checks++;
await page.screenshot({ path: `${SHOTS}/02-wrong-password.png` });
await unlock(page);
await page.locator('#app').waitFor({ timeout: 30000 });
const stored = await page.evaluate(() => ({ pass: !!localStorage.getItem('daily.now.remember'), exp: localStorage.getItem('daily.now.remember-expires') }));
checks++;
if (!stored.pass || stored.exp !== null) fail(`"Remember me" storage: ${JSON.stringify(stored)} (expected a saved hash and no expiry)`);
await page.close();

// ---------- 2. every block and gap ----------
// The page reloads itself at 4am, so each simulated page covers one "4am to 4am" day: from 4am on day d
// until 4am the next day (for Sunday, that is Monday morning of the next week).
console.log('Checking every block and gap');
function timesOn(d) {
  const day = weekBlocks.filter(b => b.day === d % 7), times = [1.5, DAY - 0.5];
  for (const b of day) times.push(b.start, b.start + 0.5, b.end - 0.5);
  const edges = [0, ...day.flatMap(b => [b.start, b.end]), DAY];
  for (let i = 0; i < edges.length; i += 2) if (edges[i + 1] > edges[i]) times.push((edges[i] + edges[i + 1]) / 2); // gap middles
  return times;
}
for (let d = 0; d < 7; d++) {
  page = await newPage(ctx, at(d, 4 * 60 + 1));
  await page.locator('#app').waitFor({ timeout: 30000 });   // unlocked by "Remember me", no password typed
  const list = [...timesOn(d).filter(t => t >= 240).map(t => [d, t]), ...timesOn(d + 1).filter(t => t < 240).map(t => [d + 1, t])];
  for (const [dd, t] of list.sort((a, b) => a[0] * DAY + a[1] - (b[0] * DAY + b[1]))) {
    const s = await goTo(page, dd, Math.floor(t), Math.round((t % 1) * 60));
    compare(s, `${DAYS[dd % 7]} ${fmtT(Math.floor(t))}+${Math.round((t % 1) * 60)}s`);
  }
  if (page.problems.length) fail(`${DAYS[d]}: ${page.problems.join(' | ')}`);
  await page.close();
}

// ---------- 3. Sunday night into Monday, and midnight ----------
console.log('Sunday night into Monday');
page = await newPage(ctx, at(6, 22 * 60));
await page.locator('#app').waitFor({ timeout: 30000 });
for (const [d, m, s] of [[6, 1439, 30], [6, 1439, 59], [7, 0, 1], [7, 0, 30], [7, 1, 0]]) {
  const r = await goTo(page, d, m, s);
  compare(r, `${d === 7 ? 'Monday (after Sunday)' : 'Sunday'} ${fmtT(m)}+${s}s`);
}
await goTo(page, 7, 5);
await page.screenshot({ path: `${SHOTS}/08-after-midnight.png` });
checks++;
if (!(await page.evaluate(() => document.documentElement.classList.contains('night')))) fail('not dimmed after midnight');

// ---------- 4. greying out when updates stop, offline banner, burn-in shift ----------
console.log('Greying out, offline, burn-in');
await page.evaluate(() => document.documentElement.style.setProperty('--stale-after', '1s'));
await page.clock.runFor(60e3);                     // next minute: numbers are refreshed with the 1 s delay
await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 2000)); // the script's clock stops…
await page.waitForTimeout(2500);                   // …but real time passes
const op = await page.evaluate(() => getComputedStyle(document.getElementById('clock')).opacity);
checks++;
if (+op > 0.5) fail(`clock did not grey out when updates stopped (opacity ${op})`);
await page.screenshot({ path: `${SHOTS}/09-stale.png` });
await page.clock.resume();

const dx0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dx') + getComputedStyle(document.documentElement).getPropertyValue('--dy'));
await page.clock.runFor(3 * 60e3 + 1000);
const dx1 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dx') + getComputedStyle(document.documentElement).getPropertyValue('--dy'));
checks++;
if (dx0 === dx1) fail('layout did not shift after 3 minutes');
await page.close();

page = await newPage(ctx, at(0, 14 * 60 + 5));
await page.locator('#app').waitFor({ timeout: 30000 });
await ctx.setOffline(true);
await page.clock.runFor(2000);
checks++;
if (await page.locator('#banner').isHidden()) fail('no banner when the connection was lost');
await page.screenshot({ path: `${SHOTS}/10-offline.png` });
await ctx.setOffline(false);
await page.clock.runFor(2 * 60e3 + 1000);          // next connection check
checks++;
if (await page.locator('#banner').isVisible()) fail('banner stayed after the connection came back');
const wakeShown = await page.locator('#wake').isVisible();
await page.close();

// ---------- 5. daily reload: only after 4am, only when online, and it unlocks itself again ----------
console.log('Daily reload');
page = await newPage(ctx, at(0, 21 * 60));
await page.locator('#app').waitFor({ timeout: 30000 });
let loads = 0;
page.on('load', () => loads++);
await page.clock.setSystemTime(at(1, 3 * 60 + 50));   // next morning, before 4am: no reload
await page.clock.runFor(61e3);
checks++;
if (loads) fail('reloaded before 4am');
offlineServer = true;                                 // site unreachable at 4am: must not reload into an error page
await page.clock.setSystemTime(at(1, 4 * 60 + 1));
await page.clock.runFor(61e3);
await page.waitForTimeout(500);
checks++;
if (loads) fail('reloaded while the site was unreachable');
offlineServer = false;
await page.clock.runFor(5 * 60e3 + 1000);             // tries again 5 minutes later
await page.waitForTimeout(1500);
checks++;
if (loads !== 1) fail(`expected one reload once the site was reachable, saw ${loads}`);
await page.locator('#app').waitFor({ timeout: 30000 });
checks++;
if (await page.locator('#lock').isVisible()) fail('asked for the password after the daily reload');
await page.close();

// ---------- 5b. planning picker (stage 2), in a fresh browser profile ----------
console.log('Planning picker');
{
  const ctx2 = await newContext();
  const planOf = d => DATA.blocks.find(b => b.planning && b.day === d);
  const openOn = d => DATA.blocks.filter(b => b.open && b.day === d).sort((a, b) => a.start - b.start);
  const check = (ok, msg) => { checks++; if (!ok) fail(msg); };
  const text = (p, sel) => p.locator(sel).textContent();
  const pickDay = [0, 1, 2, 3, 4, 5, 6].find(d => openOn(d).length >= 2);
  const nextDay = [1, 2, 3, 4, 5, 6].map(x => (pickDay + x) % 7).find(d => planOf(d) && openOn(d).length && d > pickDay);
  const noneDay = [0, 1, 2, 3, 4, 5, 6].find(d => planOf(d) && !openOn(d).length);
  const [o1, o2] = openOn(pickDay), plan1 = planOf(pickDay);

  page = await newPage(ctx2, at(pickDay, plan1.start - 2));
  await unlock(page);
  await page.locator('#app').waitFor({ timeout: 30000 });
  check(await page.locator('#plan').isHidden(), 'picker open before Planning');
  await goTo(page, pickDay, plan1.start, 5);
  check(await page.locator('#plan').isVisible(), 'picker did not open by itself at Planning');
  check(await page.locator('.plan-row').count() === openOn(pickDay).length, `picker should list ${openOn(pickDay).length} blocks`);
  await page.screenshot({ path: `${SHOTS}/13-plan-list.png` });

  await page.locator('.plan-row').nth(0).click();
  check(await page.locator('.chip').count() === 0, 'a fresh browser should have no saved choices');
  await page.fill('#plan-what', 'Test pastime A');
  await page.fill('#plan-floor', 'test floor A');
  await page.screenshot({ path: `${SHOTS}/14-plan-typing.png` });
  await page.setViewportSize({ width: 800, height: 190 });       // roughly what's left with the keyboard up
  await page.locator('#plan-floor').focus();
  await page.screenshot({ path: `${SHOTS}/14b-plan-keyboard-space.png` });
  check(await page.locator('.plan-save').isVisible(), 'Save button not reachable with little screen height');
  await page.setViewportSize({ width: 800, height: 360 });
  await page.click('.plan-save');
  check(/Test pastime A/.test(await text(page, '.plan-row >> nth=0')), 'first pick not shown in the list');
  await page.locator('.plan-row').nth(1).click();
  await page.fill('#plan-what', 'Test movement B');                // no floor typed
  await page.press('#plan-what', 'Enter');                          // Enter moves to the floor box
  await page.press('#plan-floor', 'Enter');                         // Enter in the floor box saves
  check(/Test movement B/.test(await text(page, '.plan-row >> nth=1')), 'second pick not shown in the list');
  await page.screenshot({ path: `${SHOTS}/15-plan-done.png` });
  const wide = await page.evaluate(() => { const p = document.getElementById('plan'); return p.scrollWidth > p.clientWidth + 1; });
  check(!wide, 'picker wider than the screen');
  await page.click('#plan-done');
  check(await page.locator('#plan').isHidden(), 'Done did not close the picker');
  await goTo(page, pickDay, plan1.start + 1);
  check(await page.locator('#plan').isHidden(), 'picker reopened by itself after Done');

  let s = await goTo(page, pickDay, o1.start + 5);
  check(s.label === 'Test pastime A' && s.floor === 'Floor: test floor A', `picked block shows "${s.label}" / "${s.floor}"`);
  check(await text(page, '#sub') === o1.label, 'picked block should name its category underneath');
  await page.screenshot({ path: `${SHOTS}/16-picked-block.png` });
  s = await goTo(page, pickDay, o2.start + 5);
  const generic = DATA.cats[o2.cat].floor;
  check(s.label === 'Test movement B' && s.floor === (generic ? 'Floor: ' + generic : ''), `pick without a floor shows "${s.label}" / "${s.floor}"`);
  s = await goTo(page, pickDay, o1.start - 1);
  check(s.label === 'Test pastime A' || /Test pastime A/.test(s.next), 'the next line should name the pick');

  await page.click('#label');                                       // tap the display: picker for swaps
  check(await page.locator('#plan').isVisible(), 'tapping the display did not open the picker');
  await page.clock.runFor(2 * 60e3 + 2000);
  check(await page.locator('#plan').isHidden(), 'picker did not close after 2 idle minutes');
  if (page.problems.length) fail('picker: ' + page.problems.join(' | '));
  await page.close();

  // The next day: picks cleared at 4am, typed choices still offered.
  const plan2 = planOf(nextDay), [n1, n2] = openOn(nextDay);
  page = await newPage(ctx2, at(nextDay, plan2.start - 1));
  await page.locator('#app').waitFor({ timeout: 30000 });
  await goTo(page, nextDay, plan2.start, 5);
  check(await page.locator('#plan').isVisible(), 'picker did not open on the next day');
  check(!/Test/.test(await text(page, '#plan-body')), 'yesterday’s picks were not cleared');
  const sameCat = openOn(nextDay).findIndex(b => b.cat === o1.cat);
  await page.locator('.plan-row').nth(sameCat).click();
  check(await page.locator('.chip', { hasText: 'Test pastime A' }).count() === 1, 'saved choice not offered the next day');
  await page.screenshot({ path: `${SHOTS}/17-plan-saved-choice.png` });
  await page.locator('.chip', { hasText: 'Test pastime A' }).click();  // one tap picks it, floor included
  // Remove a saved choice: open the same block again, switch to removing, tap it.
  await page.locator('.plan-row', { hasText: 'Test pastime A' }).click();
  await page.locator('.plan-btn', { hasText: 'Remove saved choices' }).click();
  await page.locator('.chip', { hasText: 'Test pastime A' }).click();
  check(await page.locator('.chip', { hasText: 'Test pastime A' }).count() === 0, 'removing a saved choice did not work');
  check(await page.locator('.chip', { hasText: 'Test movement B' }).count() === 0, 'choices from another category shown');
  await page.locator('.plan-btn', { hasText: 'Back' }).click();
  await page.click('#plan-done');
  const b = openOn(nextDay)[sameCat];
  s = await goTo(page, nextDay, b.start + 5);
  check(s.label === 'Test pastime A' && s.floor === 'Floor: test floor A', 'one-tap pick lost its saved floor (removing it from the list should not undo today’s pick)');
  if (n2) {
    const other = openOn(nextDay).find((x, i) => i !== sameCat);
    s = await goTo(page, nextDay, other.start + 5);
    check(await text(page, '#sub') === 'Not picked yet · tap to choose', 'unpicked block should say so');
  }
  const store = await page.evaluate(() => ({ picks: JSON.parse(localStorage.getItem('daily.now.picks')), choices: JSON.parse(localStorage.getItem('daily.now.choices')) }));
  check(store.picks && Object.keys(store.picks.picks).length >= 1, 'today’s pick not saved in the browser');
  if (page.problems.length) fail('picker, next day: ' + page.problems.join(' | '));
  await page.close();

  // A day with nothing to choose: no picker.
  if (noneDay !== undefined) {
    page = await newPage(ctx2, at(noneDay, planOf(noneDay).start - 1));
    await page.locator('#app').waitFor({ timeout: 30000 });
    await goTo(page, noneDay, planOf(noneDay).start, 5);
    check(await page.locator('#plan').isHidden(), 'picker opened on a day with nothing to choose');
    await page.close();
  }
  await ctx2.close();
}

// ---------- 5c. weather prompts and warnings (stage 3), with made-up weather ----------
console.log('Weather prompts and warnings');
{
  const check = (ok, msg) => { checks++; if (!ok) fail(msg); };
  const ctx3 = await newContext();
  const walk = DATA.routines.flatMap(r => r.steps).find(st => st.walk);
  const move = DATA.blocks.filter(b => b.move && b.day === 0)[0];
  const d0 = '20261005';                                   // Monday 5 October 2026, as the forecast's hour keys
  // Jump forward to a time, let the once-a-minute check fetch every source that is due, then redraw.
  async function wxAt(page, day, min) {
    simNow = at(day, min).getTime();
    await page.clock.setSystemTime(new Date(simNow - 61e3));
    await page.clock.runFor(61e3);
    await page.waitForTimeout(700);
    await page.clock.runFor(1100);
    return screen(page);
  }
  const has = (s, text) => s.prompt.includes(text);
  Object.assign(WX, { warn: {}, raining: false, temps: {}, icons: {}, aqhi: 3, aqhiRisk: 'Low', forecast: 'Low', fail: false, airAgeMin: 30,
    nowcast: { ageMin: 90, mm: [0, 0, 0, 0] } });

  page = await newPage(ctx3, at(0, 8 * 60));
  await unlock(page);
  await page.locator('#app').waitFor({ timeout: 30000 });
  check(!!walk && !!move, 'expected a dog walk step and a Monday Movement block');

  WX.icons[d0 + p2(walk.start / 60)] = 63;                  // showers in the walk's hour, and the nowcast is old
  let s = await wxAt(page, 0, walk.start - 55);
  check(has(s, `Showers forecast around ${fmtT(walk.start)}`) && has(s, `${walk.title} at ${fmtT(walk.start)}:`),
    `rain prompt before the walk (hourly forecast, nowcast old): "${s.prompt}"`);
  WX.nowcast = { ageMin: 5, mm: [0, 0, 0, 0] };              // a fresh nowcast says dry: it wins over the hourly forecast
  s = await wxAt(page, 0, walk.start - 45);
  check(s.prompt === '', `fresh dry nowcast should override the hourly forecast: "${s.prompt}"`);
  WX.nowcast = { ageMin: 5, mm: [0, 1.5, 0, 0] };            // rain in the nowcast's second half-hour
  s = await wxAt(page, 0, walk.start - 35);
  check(has(s, `Rain expected from about ${fmtT(walk.start - 10)}`), `rain prompt from the nowcast: "${s.prompt}"`);
  await goTo(page, 0, walk.start - 15);
  await page.screenshot({ path: `${SHOTS}/18-rain-before-walk.png` });
  WX.raining = true;
  s = await wxAt(page, 0, walk.start + 20);
  check(s.prompt === 'Raining in Wan Chai now', `rain during the walk: "${s.prompt}"`);
  WX.raining = false; WX.icons = {};
  s = await wxAt(page, 0, walk.end + 40);
  check(s.prompt === '', `no prompt after the walk: "${s.prompt}"`);

  WX.temps[d0 + p2(move.start / 60)] = 34;
  s = await wxAt(page, 0, move.start - 45);
  check(has(s, `Hot: 34° forecast at ${fmtT(move.start)}`), `heat prompt before Movement: "${s.prompt}"`);
  check(has(s, 'Ends after sunset (6:07pm)'), `sunset flag: "${s.prompt}"`);
  await page.screenshot({ path: `${SHOTS}/19-heat-before-movement.png` });
  await page.setViewportSize({ width: 640, height: 360 });
  s = await goTo(page, 0, move.start - 44);
  check(!s.over.length, `long weather prompt overflows the small screen (${s.over.join(', ')}; fit ${await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fit'))})`);
  await page.setViewportSize({ width: 800, height: 360 });
  WX.temps = {}; WX.aqhi = 8; WX.aqhiRisk = 'Very High';
  s = await wxAt(page, 0, move.start - 5);
  check(has(s, 'Air quality 8 (Very High) at Eastern') && !has(s, 'Hot'), `poor air prompt: "${s.prompt}"`);
  WX.aqhi = 3; WX.aqhiRisk = 'Low'; WX.forecast = 'Moderate to High';
  s = await wxAt(page, 0, move.start + 30);
  check(has(s, 'Air quality forecast: Moderate to High') && !has(s, ' at ' + fmtT(move.start) + ':'), `air forecast prompt during the block: "${s.prompt}"`);
  WX.forecast = 'Low';
  s = await wxAt(page, 0, move.end + 31);
  check(s.prompt === '', `no prompt after Movement: "${s.prompt}"`);
  const problemsBefore = page.problems.slice();

  // Typhoon signal: takes over; a tap shows the schedule for 10 minutes; a rainstorm warning on top; cancelled.
  WX.warn = { WTCSGNL: { name: 'Tropical Cyclone Warning Signal', code: 'TC8NE', actionCode: 'ISSUE', issueTime: '2026-10-05T19:40:00+08:00' } };
  s = await wxAt(page, 0, 20 * 60 + 15);
  check(s.alert && (await page.locator('.alert-title').first().textContent()) === 'Typhoon Signal No. 8 (north-east)', 'typhoon signal did not take over the screen');
  check(/Issued 7:40pm/.test(await page.locator('#alert-titles').textContent()), 'issue time missing');
  check((await page.locator('#alert-now').textContent()).length > 0, 'takeover should still show what is on now');
  await page.screenshot({ path: `${SHOTS}/20-typhoon-8.png` });
  await page.click('#alert');
  s = await goTo(page, 0, 20 * 60 + 16);
  check(!s.alert, 'tap did not show the schedule');
  await page.clock.runFor(10 * 60e3);
  s = await goTo(page, 0, 20 * 60 + 27);
  check(s.alert, 'takeover did not come back after 10 minutes');
  WX.warn.WRAIN = { name: 'Rainstorm Warning Signal', code: 'WRAINB', actionCode: 'ISSUE', issueTime: '2026-10-05T20:30:00+08:00' };
  s = await wxAt(page, 0, 21 * 60);
  check(s.alert && /^Black Rainstorm Warning/.test(await page.locator('#alert-titles').textContent()), 'black rainstorm warning not shown first');
  check(/Issued 8:30pm.*Issued 7:40pm/.test(await page.locator('#alert-titles').textContent()), 'each warning should show its own issue time');
  const edge = await page.evaluate(() => { const r = document.getElementById('alert').getBoundingClientRect(); return r.left === 0 && r.top === 0 && r.right === innerWidth && r.bottom === innerHeight; });
  check(edge, 'the warning panel must cover the whole screen, also while shifted for burn-in');
  check(await page.locator('#alert.level-black').count() === 1, 'black rainstorm colours missing');
  await page.screenshot({ path: `${SHOTS}/21-black-rain-and-typhoon.png` });
  WX.warn = {};
  s = await wxAt(page, 0, 21 * 60 + 40);
  check(!s.alert, 'takeover stayed after the warnings were cancelled');
  check(!problemsBefore.length, 'weather: ' + problemsBefore.join(' | '));

  // Weather feed down and an old air-quality copy: readings grey out, and it says so.
  WX.fail = true; WX.airAgeMin = 5 * 60;
  s = await wxAt(page, 0, 23 * 60 + 30);
  check(await page.locator('#wx-temp.old').count() === 1, 'temperature not greyed when the readings stopped');
  check(await page.locator('#wx-air.old').count() === 1, 'air quality not greyed when the copy was hours old');
  check((await page.locator('#wx-problem').textContent()) === 'Weather unavailable', 'no notice that the weather is unavailable');
  await page.screenshot({ path: `${SHOTS}/22-weather-old.png` });
  WX.fail = false; WX.airAgeMin = 30;
  await page.close();
  await ctx3.close();
}

// ---------- 5d. travel and the leave-by countdown (stage 4) ----------
console.log('Travel and leave-by');
{
  const check = (ok, msg) => { checks++; if (!ok) fail(msg); };
  const text = (p, sel) => p.locator(sel).textContent();
  Object.assign(WX, { warn: {}, raining: false, temps: {}, icons: {}, aqhi: 3, aqhiRisk: 'Low', forecast: 'Low', fail: false, airAgeMin: 30, nowcast: { ageMin: 5, mm: [0, 0, 0, 0] } });
  const ctx4 = await newContext();
  // A day with a chosen block and a fixed afternoon block after a gap (found from the data, not named here).
  const D = [0, 1, 2, 3, 4, 5, 6].find(d => DATA.blocks.some(b => b.open && b.day === d && b.start >= 17 * 60) &&
    DATA.blocks.some(b => !b.open && !b.planning && b.day === d && b.start >= 12 * 60 && b.start < 15 * 60 &&
      !DATA.blocks.some(x => x.day === d && x.end > b.start - 75 && x.end <= b.start && x !== b)));
  const fixed = DATA.blocks.filter(b => b.day === D && !b.open && !b.planning && b.start >= 12 * 60).sort((a, b) => a.start - b.start)[0];
  const chosen = DATA.blocks.filter(b => b.day === D && b.open && b.start >= 17 * 60)[0];
  const plan = DATA.blocks.find(b => b.planning && b.day === D);
  const leave = fixed.start - 57;                         // 47 min travel + 10 spare
  page = await newPage(ctx4, at(D, plan.start - 2));
  await unlock(page);
  await page.locator('#app').waitFor({ timeout: 30000 });
  await goTo(page, D, plan.start, 5);
  check(await page.locator('#plan').isVisible(), 'picker did not open at Planning');
  await page.click('.plan-add');
  await page.locator('.plan-row', { hasText: fixed.label }).click();
  await page.fill('#plan-travel-min', '47');
  await page.fill('#plan-travel-spare', '10');
  await page.fill('#plan-travel-route', 'Walk 10 · MTR 25 · walk 12');
  await page.screenshot({ path: `${SHOTS}/23-plan-travel.png` });
  await page.click('.plan-save');
  check((await text(page, '#plan-body')).includes(`leave by ${fmtT(leave)} (47 min travel + 10 spare)`), 'travel not shown in the Planning list');
  await page.locator('.plan-row', { hasText: fixed.label }).click();
  check(await page.inputValue('#plan-travel-min') === '47', 'saved travel not filled in when editing');
  await page.fill('#plan-travel-min', 'about an hour');
  await page.click('.plan-save');
  check(/whole minutes/.test(await text(page, '.plan-msg')), 'no message for travel that is not a number');
  await page.locator('.plan-btn', { hasText: 'Back' }).click();
  await page.locator('.plan-row', { hasText: chosen.label }).click();
  await page.fill('#plan-what', 'Test hike');
  await page.fill('#plan-travel-min', '30');
  await page.click('.plan-save');
  check((await text(page, '#plan-body')).includes(`leave by ${fmtT(chosen.start - 30)}`), 'a choice’s travel not shown');
  await page.screenshot({ path: `${SHOTS}/24-plan-with-travel.png` });
  await page.click('#plan-done');

  // During the block before: one line. In the gap: the countdown. After leave-by: leave now, with an estimate.
  let s = await goTo(page, D, leave - 70);
  check(!(await page.locator('#leave').isVisible()), 'countdown started more than an hour early');
  s = await goTo(page, D, leave - 48);
  const prev = DATA.blocks.find(b => b.day === D && b.start <= leave - 48 && leave - 48 < b.end);
  if (prev) check(await text(page, '#leave') === `Leave by ${fmtT(leave)} for ${fixed.label} · in 48 min`, `line during the block before: "${await page.locator('#leave').textContent()}"`);
  s = await goTo(page, D, leave - 13);
  check(s.label === `Leave by ${fmtT(leave)}` && s.left === '13 min until you leave', `countdown: "${s.label}" / "${s.left}"`);
  check((await text(page, '#sub')) === `For ${fixed.label} at ${fmtT(fixed.start)} · arrive about ${fmtT(fixed.start - 10)} (estimate)`, `arrival line: "${await text(page, '#sub')}"`);
  check(s.floor === 'Route: Walk 10 · MTR 25 · walk 12', 'route not shown');
  check(!s.over.length, 'countdown overflows');
  await page.screenshot({ path: `${SHOTS}/25-leave-by.png` });
  s = await goTo(page, D, leave + 7);
  check(s.label === 'Leave now' && s.left === 'Starts in 50 min' && s.kicker === `Time to leave · due ${fmtT(leave)}`, `leave now: "${s.kicker}" / "${s.label}" / "${s.left}"`);
  check((await text(page, '#sub')).startsWith(`For ${fixed.label} at ${fmtT(fixed.start)} · `), 'leave now should name the block');
  check((await text(page, '#sub')).includes(`leaving now, you’d arrive about ${fmtT(leave + 7 + 47)} (estimate)`), `estimate when late to leave: "${await text(page, '#sub')}"`);
  await page.screenshot({ path: `${SHOTS}/26-leave-now.png` });
  s = await goTo(page, D, fixed.start - 5);
  check((await text(page, '#sub')).includes('42 min late (estimate)'), `late estimate: "${await text(page, '#sub')}"`);
  await page.setViewportSize({ width: 640, height: 360 });
  s = await goTo(page, D, fixed.start - 4);
  check(!s.over.length, 'leave-now text overflows the small screen');
  await page.setViewportSize({ width: 800, height: 360 });
  s = await goTo(page, D, fixed.start + 5);
  check(s.label === fixed.label && !(await page.locator('#leave').isVisible()), 'countdown should stop once the block starts');
  s = await goTo(page, D, chosen.start - 40);
  check(s.label === `Leave by ${fmtT(chosen.start - 30)}` && (await text(page, '#sub')).includes(`${chosen.label}: Test hike`), `countdown for a choice: "${s.label}"`);
  if (page.problems.length) fail('travel: ' + page.problems.join(' | '));
  await page.close();

  // A week later: the fixed block's travel repeats; the choice's doesn't (picks clear daily) but is offered again.
  page = await newPage(ctx4, at(D + 7, plan.start - 2));
  await page.locator('#app').waitFor({ timeout: 30000 });
  await goTo(page, D + 7, plan.start, 5);
  check((await text(page, '#plan-body')).includes(`leave by ${fmtT(leave)}`), 'weekly travel did not repeat the next week');
  await page.locator('.plan-row', { hasText: chosen.label }).click();
  check(await page.locator('.chip', { hasText: 'Test hike · 30 min away' }).count() === 1, 'saved choice lost its travel');
  await page.locator('.plan-btn', { hasText: 'Back' }).click();
  await page.locator('.plan-row', { hasText: fixed.label }).click();
  await page.locator('.plan-btn', { hasText: 'Remove travel' }).click();
  check(!(await text(page, '#plan-body')).includes('leave by'), 'travel not removed');
  await page.click('#plan-done');
  s = await goTo(page, D + 7, leave - 13);
  check(/^Free until/.test(s.label), `after removing travel: "${s.label}"`);
  await page.close();
  await ctx4.close();
}

// ---------- 6. screenshots of typical moments (landscape 800×360, and portrait) ----------
console.log('Screenshots');
const shots = [];
page = await newPage(ctx, at(0, 4 * 60 + 1));
await page.locator('#app').waitFor({ timeout: 30000 });
const mon = weekBlocks.filter(b => b.day === 0);
const firstGap = (() => { for (let i = 1; i < mon.length; i++) if (mon[i].start > mon[i - 1].end) return (mon[i - 1].end + mon[i].start) / 2; })();
const withFloor = mon.find(b => DATA.cats[b.cat]?.floor && b.cat !== 'routine');
const step = DATA.routines.flatMap(r => r.steps).find(st => st.floor && st.end) || DATA.routines[0].steps[0];
const plan = [['03-routine-step', 0, step.start + 10], ['04-block-with-floor', 0, withFloor.start + 20], ['05-gap', 0, Math.floor(firstGap)], ['06-evening', 0, 21 * 60 + 45], ['07-night', 0, 23 * 60 + 40]];
for (const [name, d, m] of plan) { await goTo(page, d, m); await page.screenshot({ path: `${SHOTS}/${name}.png` }); shots.push(name); }
await page.setViewportSize({ width: 640, height: 360 });
await goTo(page, 0, withFloor.start + 20);
await page.screenshot({ path: `${SHOTS}/11-small-16x9.png` });
await page.setViewportSize({ width: 360, height: 760 });
await goTo(page, 0, withFloor.start + 20);
const portrait = await screen(page);
checks++;
if (portrait.over.length) fail('portrait: text overflows ' + portrait.over.join(', '));
await page.screenshot({ path: `${SHOTS}/12-portrait.png` });
if (page.problems.length) fail(page.problems.join(' | '));
await page.close();

await browser.close();
server.close();
console.log(`\n${checks} checks, ${failures} failed. Screenshots in build/screenshots/.` +
  `\nKeep-awake: ${wakeShown ? 'this headless browser refused the screen wake lock, so the "tap to keep it on" button showed (expected without a real screen; check on the phone)' : 'wake lock granted'}.`);
process.exit(failures ? 1 : 0);
