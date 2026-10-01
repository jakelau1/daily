// Puts the weather relay (relay/worker.js) on Cloudflare Workers and points the "now" page at it.
// Once per computer, first:  npx wrangler login     (opens the browser to sign in to your free Cloudflare account)
// Then:                      npm run relay-deploy
// It deploys the relay, checks that it answers, saves its address in relay/url.txt, and rebuilds now/index.html
// (the address goes into the page and its Content-Security-Policy). Publish afterwards: npm run now -- --publish
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stop = msg => { console.error('\nStopped: ' + msg + '\n'); process.exit(1); };

// Deploy, showing wrangler's output as it comes (it may ask a question, e.g. to choose a workers.dev name).
const out = await new Promise(resolve => {
  let text = '';
  const p = spawn('npx', ['wrangler', 'deploy', '--config', 'relay/wrangler.toml'], { cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  p.stdout.on('data', d => { process.stdout.write(d); text += d; });
  p.on('close', code => { if (code !== 0) stop('wrangler deploy failed (see above). Have you run "npx wrangler login"?'); resolve(text); });
});
const url = (out.match(/https:\/\/daily-weather-relay\.[a-z0-9-]+\.workers\.dev/i) || [])[0];
if (!url) stop('could not find the relay\'s address in wrangler\'s output above.');

// Check it answers, for this site only.
for (const name of ['ocf', 'aqhi', 'nowcast']) {
  const r = await fetch(`${url}/${name}`, { headers: { origin: 'https://jakelau1.github.io' } }).catch(e => ({ ok: false, status: e.message }));
  if (!r.ok) stop(`the relay's /${name} answered ${r.status}.`);
  console.log(`ok  ${url}/${name}`);
}
const other = await fetch(`${url}/ocf`, { headers: { origin: 'https://example.com' } });
if (other.status !== 403) stop('the relay answered a page from another site; it should refuse (403).');
console.log('ok  other sites are refused');

fs.writeFileSync(path.join(ROOT, 'relay', 'url.txt'), url + '\n');
const b = spawnSync(process.execPath, ['tools/build-now.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (b.status !== 0) stop('rebuilding now/index.html failed.');
console.log(`\nRelay deployed at ${url} and saved in relay/url.txt.\nPublish the page with:  npm run now -- --publish`);
