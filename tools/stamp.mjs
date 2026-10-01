// Copies partials/head, nav and footer into every page between marker comments:
//   <!--head-->...<!--/head-->   <!--nav-->...<!--/nav-->   <!--footer-->...<!--/footer-->
// Run after editing anything in partials/ or the SECTIONS list:  node tools/stamp.mjs
// The output is committed, so GitHub Pages needs no build step.
import fs from 'node:fs';
import path from 'node:path';

export const SECTIONS = [
  { dir: 'weather',  key: 'weather',  en: 'Weather',   zh: '天氣',  sub: 'Happy Valley and 26 other places' },
  { dir: 'hiking',   key: 'hiking',   en: 'Hiking',    zh: '行山',  sub: 'Country-park routes on the map' },
  { dir: 'arrivals', key: 'arrivals', en: 'Arrivals',  zh: '到站',  sub: 'Live buses and minibuses' },
  { dir: 'cams',     key: 'cams',     en: 'Roads',     zh: '路況',  sub: 'Cameras and harbour-tunnel times' },
  { dir: 'trips',    key: 'trips',    en: 'Day trips', zh: '一日遊', sub: '15 days out from Happy Valley' },
  { dir: 'savings',  key: 'savings',  en: 'Savings',   zh: '儲蓄',  sub: 'Compound-interest calculator' },
  { dir: 'study',    key: 'study',    en: 'Study',     zh: '溫書',  sub: 'PHL245 videos, Units 1–9' },
];
const SKIP = new Set(['node_modules', '.git', '.github', 'legacy', 'vendor', '_site', 'partials', 'tools', 'scripts', 'data']);
const read = f => fs.readFileSync(f, 'utf8');

function pages(dir = '.', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out); else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}
function fill(tpl, file) {
  const depth = path.dirname(file).split(path.sep).filter(s => s && s !== '.').length;
  const root = depth ? '../'.repeat(depth) : './';
  const first = file.split(path.sep)[0];
  let s = tpl;
  s = s.replace('{{panel_items}}', SECTIONS.map(x =>
    `    <li><a href="${'{{root}}'}${x.dir}/"${x.dir === first ? ' aria-current="page"' : ''}><span class="swatch" data-sw="${x.key}" lang="zh-Hant-HK">${x.zh[0]}</span><span><span class="panel-t">${x.en} <span class="zh" lang="zh-Hant-HK">${x.zh}</span></span><span class="panel-s">${x.sub}</span></span></a></li>`).join('\n'));
  s = s.replace('{{footer_items}}', SECTIONS.map(x => `          <li><a href="{{root}}${x.dir}/">${x.en} <span class="zh" lang="zh-Hant-HK">${x.zh}</span></a></li>`).join('\n'));
  for (const x of SECTIONS) s = s.replaceAll(`{{cur_${x.key}}}`, x.dir === first ? ' aria-current="page"' : '');
  return s.replaceAll('{{root}}', root);
}
let changed = 0;
for (const file of pages()) {
  let html = read(file), orig = html;
  for (const name of ['head', 'nav', 'footer']) {
    const re = new RegExp(`<!--${name}-->[\\s\\S]*?<!--/${name}-->`);
    if (!re.test(html)) continue;
    const body = fill(read(`partials/${name}.html`), file).trimEnd();
    html = html.replace(re, () => `<!--${name}-->\n${body}\n<!--/${name}-->`);
  }
  if (html !== orig) { fs.writeFileSync(file, html); changed++; console.log('stamped', file); }
}
console.log(changed ? `${changed} page(s) updated` : 'nothing to update');
