// Loads the page's own data files. Each file is fetched at most once per visit.
const cache = new Map();

export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { referrerPolicy: 'no-referrer' }).then(r => {
      if (!r.ok) throw new Error(`${r.status} for ${path}`);
      return r.json();
    }).catch(e => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}
