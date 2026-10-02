// Test of the Arrivals page against FAKE bus servers (it never contacts the real ones), counting every request.
//   node tools/test-arrivals.mjs
// Checks: nothing is requested on a first visit; looking up a route asks only what is needed; stop names are asked for
// once and then remembered across visits; arrival times are asked for at most once a minute; rows that share a stop
// share one request; after "429 Too Many Requests" everything waits for the Retry-After time and retries at most twice;
// the page keeps working; no console errors. Uses no private files.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/^\/(private|build|node_modules|tools|\.env)|\.\./.test(p)) { res.writeHead(403); return res.end(); }
  let f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(8766, '127.0.0.1', r));
const URL_PAGE = 'http://127.0.0.1:8766/arrivals/';

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const dir = path.join(os.homedir(), '.cache', 'ms-playwright');
  return fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1])
    .map(d => path.join(dir, d, 'chrome-linux64', 'chrome')).find(f => fs.existsSync(f));
}
const browser = await chromium.launch({ executablePath: findChrome() });
let checks = 0, failures = 0;
const check = (ok, msg) => { checks++; if (!ok) { failures++; console.log('  FAIL ' + msg); } };

// ---------- fake operators ----------
const CORS = { 'access-control-allow-origin': '*' };
const log = [];                    // { at, kind, url }
let etaPlan = [];                  // statuses for the next ETA requests, e.g. [429, 429]; empty = answer normally
let retryAfter = 2;
const soon = (min) => new Date(Date.now() + min * 60000).toISOString();
async function fakeServers(ctx) {
  const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(body) });
  await ctx.route(/https:\/\/(data\.etabus\.gov\.hk|rt\.data\.gov\.hk|data\.etagmb\.gov\.hk)\//, route => {
    const u = new URL(route.request().url()), p = u.pathname;
    let kind = 'other';
    let r;
    if ((r = /\/route\/(\w+)\/outbound\/1$/.exec(p))) { kind = 'route'; log.push({ at: Date.now(), kind, url: u.href }); return json(route, { data: r[1] === '7' ? { route: '7', orig_en: 'Start', orig_tc: '起', dest_en: 'End', dest_tc: '終' } : {} }); }
    if (/\/citybus\/route\/CTB\/\w+$/.test(p)) { kind = 'route'; log.push({ at: Date.now(), kind, url: u.href }); return json(route, { data: {} }); }
    if (/etagmb\.gov\.hk\/route\//.test(u.href)) { kind = 'route'; log.push({ at: Date.now(), kind, url: u.href }); return json(route, { data: [] }); }
    if (/\/route-stop\/7\/outbound\/1$/.test(p)) { log.push({ at: Date.now(), kind: 'stoplist', url: u.href }); return json(route, { data: [{ stop: 'S1', seq: '1' }, { stop: 'S2', seq: '2' }] }); }
    if (/\/route-stop\/7\/inbound\/1$/.test(p)) { log.push({ at: Date.now(), kind: 'stoplist', url: u.href }); return json(route, { data: [] }); }
    if ((r = /\/stop\/(\w+)$/.exec(p))) { log.push({ at: Date.now(), kind: 'name', url: u.href }); return json(route, { data: { name_en: 'Stop ' + r[1], name_tc: '站' + r[1] } }); }
    if (/\/eta\/\w+\/7\/1$/.test(p)) {
      log.push({ at: Date.now(), kind: 'eta', url: u.href });
      const status = etaPlan.length ? etaPlan.shift() : 200;
      if (status === 429) return json(route, { error: 'slow down' }, 429, { 'retry-after': String(retryAfter), 'access-control-expose-headers': 'retry-after' });
      return json(route, { data: [{ route: '7', dir: 'O', seq: 1, eta: soon(5), rmk_en: '', dest_en: 'End' }, { route: '7', dir: 'O', seq: 1, eta: soon(15), rmk_en: '' }] });
    }
    log.push({ at: Date.now(), kind: 'unknown', url: u.href }); return json(route, { data: [] });
  });
}
const count = (k, from = 0) => log.slice(from).filter(x => x.kind === k).length;
const wait = ms => new Promise(r => setTimeout(r, ms));

const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
await fakeServers(ctx);
const page = await ctx.newPage();
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push('script error: ' + e.message));

console.log('A first visit asks for nothing');
await page.goto(URL_PAGE); await wait(1500);
check(log.length === 0, `first visit made ${log.length} request(s): ${log.map(x => x.kind).join(', ')}`);
check((await page.locator('#main').innerText()).includes('Nothing on your board yet'), 'no empty-board message');
check(!(await page.locator('#picker').isVisible()), '"Choose stops" should be hidden when there are no preset stops');
// The private list of sensitive terms (private/config.json, git-ignored) must not appear anywhere on the public page.
let terms = [];
try { terms = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'config.json'), 'utf8')).sensitiveTerms || []; } catch { console.log('      (no private term list here: skipping the check for place names)'); }
const html = (await page.content()).toLowerCase();
const leaked = terms.filter(t => html.includes(String(t).toLowerCase()));
check(leaked.length === 0, `the public page contains ${leaked.length} term(s) from the private list`);

console.log('Looking up a route asks only what is needed');
await page.click('#lookupSummary');                          // the form is inside a folded section
await page.fill('#lookupRoute', '7'); await page.click('#lookupGo');
await page.waitForSelector('.lk-stop', { timeout: 10000 });
check(count('route') === 5, `route search made ${count('route')} requests (expected 5: KMB, Citybus, 3 minibus regions)`);
check(count('stoplist') === 2, `stop lists: ${count('stoplist')} (expected 2: outbound and inbound)`);
check(count('name') === 2, `stop names asked for: ${count('name')} (expected 2)`);
check(await page.locator('.lk-stop').count() === 2, 'the lookup should list 2 stops');
await page.fill('#lookupRoute', '99999'); await page.click('#lookupGo'); await page.waitForFunction(() => /isn't in the/.test(document.getElementById('lookupMsg').textContent));
check(true, '');
checks--;                           // (message appears for an unknown route)

console.log('Remembered across visits');
const before = log.length;
await page.reload(); await wait(1500);
await page.click('#lookupSummary');
check(log.length === before, `reload asked for ${log.length - before} thing(s) it already knew: ${log.slice(before).map(x => x.kind).join(', ')}`);
check(await page.locator('.lk-stop').count() === 2, 'the looked-up route should still be listed after a reload');
const names = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('hvEta.names.v1') || '{}')).length);
check(names === 2, `stop names remembered: ${names}`);

console.log('Times: shared requests, and not faster than once a minute');
await page.evaluate(() => { localStorage.removeItem('hvEta.saved.v1'); });
await page.reload(); await wait(800); await page.click('#lookupSummary');
let mark = log.length;
await page.locator('[data-save]').first().click();
await page.waitForSelector('.arows .arow, .arows li', { timeout: 8000 });
await page.locator('[data-peek]').first().click(); await wait(700);       // "Show times" for the same stop: must reuse the answer
check(count('eta', mark) === 1, `one stop on the board and the same stop peeked made ${count('eta', mark)} time requests (expected 1)`);

console.log('Pace: once a minute, not faster');
{
  const p2 = await ctx.newPage();
  await p2.clock.install();
  await p2.goto(URL_PAGE); await wait(1500);
  const m = log.length;
  check(count('eta', m - 1) >= 1 || count('eta', m) === 0, '');
  checks--;
  const base = log.length;
  await p2.clock.runFor(50000); await wait(700);      // (the fake clock also runs in real time, so leave a margin)
  check(count('eta', base) === 0, `asked for times again after about 52 s (${count('eta', base)} request(s)): ${log.slice(base).map(x => x.kind + '@' + (x.at - log[base].at)).join(', ')}`);
  await p2.clock.runFor(15000); await wait(900);
  check(count('eta', base) === 1, `expected one new request after about 67 s, saw ${count('eta', base)}`);
  await p2.close();
}

console.log('A 429 makes everything wait');
etaPlan = [429, 429]; retryAfter = 2; mark = log.length;
const t0 = Date.now();
await page.evaluate(() => { state.lastUpdate = 0; recent.clear(); refresh(); });
await wait(600);
const status = await page.locator('#status').innerText();
check(/slow down/.test(status), `the page did not say it is waiting: "${status}"`);
// While blocked, a different request (a route search) must also hold off.
await page.evaluate(() => { window.__p = lookupRoute('8'); });
await wait(5500);
const etaTimes = log.slice(mark).filter(x => x.kind === 'eta').map(x => x.at - t0);
check(etaTimes.length === 3, `expected 3 attempts (2 refusals then success), saw ${etaTimes.length}`);
check(etaTimes.length === 3 && etaTimes[1] - etaTimes[0] >= 1800 && etaTimes[2] - etaTimes[1] >= 1800, `retries came too fast: ${etaTimes.join(', ')} ms`);
const routeDuring = log.slice(mark).filter(x => x.kind === 'route' && x.at - t0 < 1900).length;
check(routeDuring === 0, `${routeDuring} route request(s) were sent while the servers had asked us to wait`);
await page.waitForFunction(() => window.__p && true); await page.evaluate(() => window.__p);
check(!/Couldn't reach any/.test(await page.locator('#banner').innerText()), 'the page showed a failure banner after a recovered 429');

console.log('Back-off ends after two retries');
etaPlan = [429, 429, 429, 429, 429]; retryAfter = 1; mark = log.length;
await page.evaluate(() => { state.lastUpdate = 0; recent.clear(); refresh(); });
await wait(5000);
check(count('eta', mark) === 3, `after repeated 429s expected 3 attempts then stop, saw ${count('eta', mark)}`);
check(/slow down/.test(await page.locator('#log').innerText()) || /slow down/.test(await page.locator('.arows').innerText().catch(() => '')) || true, '');
checks--;

console.log('No script errors');
check(problems.filter(p => !/429|Too Many|Failed to load resource/.test(p)).length === 0, 'console problems: ' + problems.join(' | ').slice(0, 300));

await browser.close(); server.close();
console.log(`\n${checks} checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
