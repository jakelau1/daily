// One-off: turns the old hand-written phl245-videos page into study/videos.js (data only).
// Usage: node tools/phl245-to-js.mjs legacy/phl245-videos.html   (kept for reference; the generated file is what the site uses)
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2] || 'legacy/phl245-videos.html', 'utf8');
const dec = s => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = s => dec(s.replace(/<[^>]+>/g, '')).trim();
const yt = u => /[?&]v=([\w-]{6,})/.exec(u)[1];

const start = /<div class="start"><b>Before Unit 1: <a class="vid" href="([^"]+)"[^>]*>([^<]+)<\/a><\/b><span>([^<]*)<\/span>/.exec(html);
const intro = { title: dec(start[2]), id: yt(start[1]), note: dec(start[3]) };

const units = [];
for (const chunk of html.split('<section class="unit"').slice(1)) {
  const n = +/id="u(\d+)"/.exec(chunk)[1];
  const topic = strip(/<p class="topic">(.*?)<\/p>/.exec(chunk)[1]);
  const groups = [];
  for (const g of chunk.split('<div class="grp"').slice(1)) {
    const kind = /data-kind="(\w+)"/.exec(g)[1];
    const h = /<h3>(.*?)<span class="age">(.*?)<\/span><\/h3>/.exec(g);
    const items = [];
    for (const li of g.split('<li class="ln').slice(1)) {
      const it = {
        no: strip(/<span class="no">(.*?)<\/span>/.exec(li)[1]),
        title: strip(/<a class="vid"[^>]*>(.*?)<\/a>/.exec(li)[1]),
        id: yt(/<a class="vid"[^>]*href="([^"]+)"/.exec(li)?.[1] || /href="([^"]+)"[^>]*class="vid"/.exec(li)[1]),
        label: strip(/<span class="just">(.*?)<\/span>/.exec(li)[1]),
      };
      const note = /<span class="note">(.*?)<\/span><\/span>/.exec(li);
      if (note) { it.note = strip(note[1]); const alt = /class="vid2"[^>]*href="([^"]+)"/.exec(note[1]) || /href="([^"]+)"[^>]*class="vid2"/.exec(note[1]); if (alt) it.altId = yt(alt[1]); }
      items.push(it);
    }
    groups.push({ kind, title: strip(h[1]), age: strip(h[2]).replace(/^uploaded /, ''), items });
  }
  units.push({ n, topic, groups });
}
const counts = {};
units.forEach(u => u.groups.forEach(g => { counts[g.kind] = (counts[g.kind] || 0) + g.items.length; }));
console.error('units', units.length, 'videos', Object.values(counts).reduce((a, b) => a + b, 0), counts);
fs.writeFileSync('study/videos.js',
  '/* PHL245 video catalogue (generated once from the old page by tools/phl245-to-js.mjs). Ages are as shown on the playlist on 29 September 2026. */\n' +
  'const STUDY = ' + JSON.stringify({ intro, units }, null, 1).replace(/\n\s+/g, m => m.length > 3 ? ' ' : m) + ';\n');
