"use strict";

/* =====================================================================
   SETTINGS
   The public site has no preset stops: you look a route up, then add the stops you use to your board.
   An app build may supply its own preset headings in presets.js (window.ArrivalsPresets); each heading lists
   "match" patterns that a stop's official name must contain to be switched on automatically.
   ===================================================================== */
const GROUPS = Array.isArray(window.ArrivalsPresets) ? window.ArrivalsPresets : [];
const REFRESH_SECONDS = 60;     // how often to ask for new times (measured: both operators' data is regenerated every 35 to 55 s)
const STOP_CACHE_DAYS = 7;      // how long to remember each route's stop list
const MAX_TIMES = 3;            // arrivals shown per row

/* ===================================================================== */

const API = {
  CTB: "https://rt.data.gov.hk/v2/transport/citybus",
  KMB: "https://data.etabus.gov.hk/v1/transport/kmb",
  GMB: "https://data.etagmb.gov.hk"
};
const OP_LABEL = { CTB: "Citybus", KMB: "KMB", GMB: "Minibus" };
const LS_CATALOG = "hvEta.catalog.v5";
const LS_HIDDEN  = "hvEta.hidden.v1";   // auto-matched stops the user switched off
const LS_ADDED   = "hvEta.added.v2";    // other stops the user switched on
const LS_OFFSET  = "hvEta.offset.v1";
const LS_LOOKUPS = "hvEta.lookups.v1";  // routes looked up (so their stops stay on the board)
const LS_NAMES = "hvEta.names.v1";      // stop names, remembered so each is asked for only once a month
const NAME_DAYS = 30, NAME_MAX = 4000;
const LS_SAVED   = "hvEta.saved.v1";    // stops added to the board from the lookup
const LOOKUP_ROUTES = [];   // { route, ops: [op], region? }, filled from storage and by the lookup form
const LOOKUP_GROUP = { id: "lookup", en: "Lookup", zh: "", match: [], routes: LOOKUP_ROUTES };
const ALL_GROUPS = [...GROUPS, LOOKUP_GROUP];   // user's minute adjustments per heading

class ApiError extends Error {
  constructor(msg, url, status) { super(msg); this.url = url; this.status = status; }
}

const state = {
  catalog: [],        // every stop on every configured route (matched or not)
  problems: [],       // messages from the stop search
  hidden: new Set(),
  added: new Set(),
  offsets: {},
  saved: [],               // keys of lookup stops added to the board, in the order added
  expanded: new Set(),     // lookup stops whose times are showing
  lookupDir: {},           // which direction each lookup route is showing
  eta: {},            // latest arrival data per stop key
  lastUpdate: 0,
  loading: false,
  log: []
};

const $ = (s) => document.querySelector(s);
const enc = encodeURIComponent;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

const isShown = (t) => t.matched ? !state.hidden.has(t.key) : state.added.has(t.key);
const shownStops = () => state.catalog.filter((t) => t.group !== "lookup" && isShown(t));
const byKey = (k) => state.catalog.find((t) => t.key === k);
const savedStops = () => state.saved.map(byKey).filter(Boolean);
const expandedStops = () => [...state.expanded].map(byKey).filter(Boolean);

function logError(where, err) {
  const line = `${new Date().toISOString()}  ${where}: ${err && err.message ? err.message : err}` +
               (err && err.url ? `\n    ${err.url}` : "");
  state.log.unshift(line);
  state.log = state.log.slice(0, 15);
  $("#log").textContent = state.log.join("\n");
}

/* ---------- Being polite to the bus servers ----------
   One gate for every request: at most MAX_PARALLEL at once; after a "429 Too Many Requests" everything waits
   (the server's Retry-After if it says, else 10 s doubling to 5 min) and the same request is retried only twice;
   an address asked for a moment ago is not asked again (rows sharing a stop share one answer). */
const MAX_PARALLEL = 3;
const ROUTE_REUSE_MS = 120000;   // a route's details asked for while looking it up are reused when its stops are listed
let inFlight = 0, blockedUntil = 0, backoffMs = 0;
const waiters = [];
const recent = new Map();     // url -> { at, promise }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const takeSlot = () => inFlight < MAX_PARALLEL ? (inFlight++, Promise.resolve()) : new Promise((r) => waiters.push(r));
const releaseSlot = () => { const next = waiters.shift(); if (next) next(); else inFlight--; };
const waitMs = () => Math.max(0, blockedUntil - Date.now());

/* Fetch JSON with a timeout. A browser "TypeError" here almost always means
   no connection, or the server refusing requests from web pages (CORS).
   reuseMs: if this address was asked for that recently, share that answer. */
function getJSON(url, timeoutMs = 12000, reuseMs = 0) {
  if (reuseMs) {
    const r = recent.get(url);
    if (r && Date.now() - r.at < reuseMs) return r.promise;
  }
  const promise = politeFetch(url, timeoutMs);
  if (reuseMs) { recent.set(url, { at: Date.now(), promise }); promise.catch(() => recent.delete(url)); }
  return promise;
}

async function politeFetch(url, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    while (waitMs() > 0) await sleep(Math.min(waitMs(), 1000));
    await takeSlot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (res.status === 429) {
        const told = Number(res.headers.get("retry-after")) * 1000;
        backoffMs = told > 0 ? told : backoffMs ? Math.min(backoffMs * 2, 300000) : 10000;
        blockedUntil = Math.max(blockedUntil, Date.now() + backoffMs);
        updateStatus();
        if (attempt >= 2) throw new ApiError(`the server asked us to slow down (too many requests); waiting about ${Math.ceil(backoffMs / 1000)} s`, url, 429);
        continue;                                         // the slot is released below; wait, then try again
      }
      if (!res.ok) throw new ApiError(`server replied ${res.status}`, url, res.status);
      const data = await res.json();
      backoffMs = 0;
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e && e.name === "AbortError") throw new ApiError("request timed out", url);
      if (e instanceof SyntaxError) throw new ApiError("reply was not valid data", url);
      throw new ApiError("could not connect (offline, or blocked by the server)", url);
    } finally {
      clearTimeout(timer);
      releaseSlot();
    }
  }
}

/* Try once more after a short pause if the connection itself failed
   (not if the server answered with an error code). */
async function getJSONRetry(url, reuseMs = 0) {
  try { return await getJSON(url, 12000, reuseMs); }
  catch (e) {
    if (e.status) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return getJSON(url, 12000, reuseMs);
  }
}

const offsetFor = (g) => {
  const v = state.offsets[g.id];
  return Number.isFinite(v) ? v : (g.offsetMin || 0);
};

/* Run fn over items, at most `limit` at a time. Failures become {error}. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (e) { out[i] = { error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const matches = (group, ...names) =>
  names.some((n) => n && group.match.some((re) => re.test(n)));
const goesTowards = (rcfg, ...dests) =>
  !rcfg.towards || dests.some((d) => d && rcfg.towards.some((re) => re.test(d)));

/* ---------- Loading each route's stop list (runs once, then cached) ---------- */

let names = store.get(LS_NAMES) || {};      // "CTB:001234" -> { at, d: { name_en, name_tc } }
let namesTimer = 0;
function saveNames() {
  clearTimeout(namesTimer);
  namesTimer = setTimeout(() => {
    namesTimer = 0;
    const keys = Object.keys(names);
    if (keys.length > NAME_MAX) keys.sort((a, b) => names[a].at - names[b].at).slice(0, keys.length - NAME_MAX).forEach((k) => delete names[k]);
    store.set(LS_NAMES, names);
  }, 1000);
}
const flushNames = () => { if (!namesTimer) return; clearTimeout(namesTimer); namesTimer = 0; store.set(LS_NAMES, names); };
addEventListener("pagehide", flushNames);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushNames(); });
const nameCache = new Map();
function stopName(op, id) {
  const k = op + ":" + id;
  const hit = names[k];
  if (hit && Date.now() - hit.at < NAME_DAYS * 864e5) return Promise.resolve(hit.d);
  if (!nameCache.has(k)) {
    const url = op === "CTB" ? `${API.CTB}/stop/${enc(id)}` : `${API.KMB}/stop/${enc(id)}`;
    const p = getJSON(url).then((r) => {
      const d = r.data || {};
      if (d.name_en || d.name_tc) { names[k] = { at: Date.now(), d: { name_en: d.name_en, name_tc: d.name_tc } }; saveNames(); }
      nameCache.delete(k);
      return d;
    }).catch((e) => { nameCache.delete(k); throw e; });
    nameCache.set(k, p);
  }
  return nameCache.get(k);
}

async function resolveBus(group, rcfg, op) {
  const route = rcfg.route;
  const stops = [];
  let reached = false, lastErr = null, missingNames = 0;
  for (const dir of ["outbound", "inbound"]) {
    const letter = dir === "outbound" ? "O" : "I";
    let list;
    try {
      const url = op === "CTB"
        ? `${API.CTB}/route-stop/CTB/${enc(route)}/${dir}`
        : `${API.KMB}/route-stop/${enc(route)}/${dir}/1`;
      list = (await getJSONRetry(url)).data || [];
      reached = true;
    } catch (e) { lastErr = e; logError(`${OP_LABEL[op]} ${route} ${dir} stop list`, e); continue; }
    if (!list.length) continue;

    let info = null;
    try {
      const url = op === "CTB"
        ? `${API.CTB}/route/CTB/${enc(route)}`
        : `${API.KMB}/route/${enc(route)}/${dir}/1`;
      const d = (await getJSON(url, 12000, ROUTE_REUSE_MS)).data;
      info = Array.isArray(d) ? d[0] : d;
    } catch (e) { /* destination can also come from the arrival data later */ }

    let dest_en = "", dest_zh = "";
    if (info) {
      // Citybus describes the route one way only; flip it for the return direction.
      if (op === "CTB" && dir === "inbound") { dest_en = info.orig_en; dest_zh = info.orig_tc; }
      else { dest_en = info.dest_en; dest_zh = info.dest_tc; }
    }

    const names = await pool(list, 4, (s) => stopName(op, s.stop));
    list.forEach((s, i) => {
      const n = names[i];
      if (!n || n.error) { missingNames++; return; }
      stops.push({
        key: `${op}|${route}|${letter}|${s.stop}|${s.seq}`,
        group: group.id, route, op, dirKey: letter, dirLetter: letter, stop: s.stop, seq: Number(s.seq),
        name_en: n.name_en || "", name_zh: n.name_tc || "",
        dest_en: dest_en || "", dest_zh: dest_zh || "",
        matched: matches(group, n.name_en, n.name_tc) && goesTowards(rcfg, dest_en, dest_zh)
      });
    });
  }
  if (!reached) throw lastErr || new ApiError("no data returned");
  return { stops, incomplete: missingNames > 0 };
}

async function resolveGMB(group, rcfg) {
  const route = rcfg.route, region = rcfg.region || "HKI";
  const r = await getJSONRetry(`${API.GMB}/route/${enc(region)}/${enc(route)}`, ROUTE_REUSE_MS);
  const variants = r.data || [];
  if (!variants.length) throw new ApiError(`route ${route} is not in the minibus arrival-time system`);
  const stops = [];
  let incomplete = false;
  for (const v of variants) {
    const special = v.description_en && !/normal/i.test(v.description_en);
    for (const d of v.directions || []) {
      let rs;
      try { rs = await getJSONRetry(`${API.GMB}/route-stop/${v.route_id}/${d.route_seq}`); }
      catch (e) { incomplete = true; logError(`Minibus ${route} stop list`, e); continue; }
      for (const s of (rs.data && rs.data.route_stops) || []) {
        stops.push({
          key: `GMB|${v.route_id}|${d.route_seq}|${s.stop_seq}`,
          group: group.id, route, op: "GMB", region, dirKey: `${v.route_id}-${d.route_seq}`,
          routeId: v.route_id, routeSeq: d.route_seq, stopSeq: s.stop_seq, seq: s.stop_seq, stop: s.stop_id,
          name_en: s.name_en || "", name_zh: s.name_tc || "",
          dest_en: d.dest_en || "", dest_zh: d.dest_tc || "",
          variant_en: special ? v.description_en : "", variant_zh: special ? (v.description_tc || "") : "",
          matched: matches(group, s.name_en, s.name_tc) && goesTowards(rcfg, d.dest_en, d.dest_tc)
        });
      }
    }
  }
  return { stops, incomplete };
}

async function resolveJobs(jobs) {
  const results = await Promise.all(jobs.map(async ({ g, r, op }) => {
    try {
      const res = op === "GMB" ? await resolveGMB(g, r) : await resolveBus(g, r, op);
      return { g, r, op, ...res };
    } catch (e) {
      logError(`${OP_LABEL[op]} ${r.route} stop search`, e);
      return { g, r, op, error: e };
    }
  }));

  const catalog = [], problems = [];
  let hadErrors = false;
  for (const res of results) {
    const who = `${res.r.route} (${OP_LABEL[res.op]})`;
    if (res.error) {
      hadErrors = true;
      problems.push({ group: res.g.id, route: res.r.route, kind: "error",
        text: `Couldn't load the stop list for ${who}: ${res.error.message}.` });
      continue;
    }
    if (res.incomplete) {
      hadErrors = true;
      problems.push({ group: res.g.id, route: res.r.route, kind: "error",
        text: `Part of the stop list for ${who} didn't load, so some stops may be missing. Try looking the route up again.` });
    }
    if (res.g.id === "lookup") {
      // Separate keys so lookup choices never clash with the headings above.
      catalog.push(...res.stops.map((s) => ({ ...s, key: "L|" + s.key, matched: false })));
      continue;
    }
    if (!res.stops.some((s) => s.matched)) {
      problems.push({ group: res.g.id, route: res.r.route, kind: "nomatch",
        text: `No stop on route ${who} matched “${res.g.lookFor || res.g.en}”. Open “Choose stops” at the bottom and tick the stop you use from the full list for route ${res.r.route}.` });
    }
    catalog.push(...res.stops);
  }
  return { catalog, problems, hadErrors };
}

// Keep the order from the settings, then direction, then stop order along the route.
function sortCatalog(catalog) {
  const order = (t) => {
    const gi = ALL_GROUPS.findIndex((g) => g.id === t.group);
    const ri = ALL_GROUPS[gi].routes.findIndex((r) => r.route === t.route);
    return gi * 1000 + ri * 10 + Math.max(0, ALL_GROUPS[gi].routes[Math.max(ri, 0)].ops.indexOf(t.op));
  };
  // Outbound ("O") before inbound ("I") for buses; minibus directions in their own order.
  const dirRank = (k) => (k === "O" ? "0" : k === "I" ? "1" : String(k));
  return catalog.sort((a, b) => order(a) - order(b) || dirRank(a.dirKey).localeCompare(dirRank(b.dirKey)) || a.seq - b.seq);
}

function keepCatalog(hadErrors) {
  if (!hadErrors && state.catalog.length) store.set(LS_CATALOG, { at: Date.now(), catalog: state.catalog, problems: state.problems });
  else store.del(LS_CATALOG);
}

async function resolveAll() {
  const jobs = [];
  ALL_GROUPS.forEach((g) => g.routes.forEach((r) => r.ops.forEach((op) => jobs.push({ g, r, op }))));
  if (!jobs.length) { state.catalog = []; state.problems = []; return; }
  HK.setHTML($("#main"), HK.state("loading", { title: "Loading the official stop lists", body: "This takes a few seconds the first time." }));
  const res = await resolveJobs(jobs);
  state.catalog = sortCatalog(res.catalog);
  state.problems = res.problems;
  keepCatalog(res.hadErrors);
}

/* ---------- Looking up a route: which operators run it? ---------- */

async function lookupRoute(raw) {
  const route = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{1,6}$/.test(route)) return "Type a route number, such as 1, 8X or 30.";
  if (LOOKUP_ROUTES.some((r) => r.route === route)) return `Route ${route} is already listed below.`;
  const found = [];
  let reached = 0;
  const probes = [
    ["KMB", () => getJSON(`${API.KMB}/route/${enc(route)}/outbound/1`, 12000, ROUTE_REUSE_MS), (j) => j.data && j.data.route, { route, ops: ["KMB"] }],
    ["CTB", () => getJSON(`${API.CTB}/route/CTB/${enc(route)}`, 12000, ROUTE_REUSE_MS), (j) => j.data && j.data.route, { route, ops: ["CTB"] }],
    ...["HKI", "KLN", "NT"].map((region) => ["GMB", () => getJSON(`${API.GMB}/route/${region}/${enc(route)}`, 12000, ROUTE_REUSE_MS),
      (j) => Array.isArray(j.data) && j.data.length, { route, ops: ["GMB"], region }])
  ];
  for (const [op, call, exists, entry] of probes) {
    try { const j = await call(); reached++; if (exists(j)) found.push(entry); }
    catch (e) { logError(`${OP_LABEL[op]} ${route} route search`, e); }
  }
  if (!reached) return "Couldn't reach the route lists. Check your connection and try again.";
  if (!found.length) return `Route ${route} isn't in the Citybus, KMB or green-minibus real-time feeds.`;
  LOOKUP_ROUTES.push(...found);
  store.set(LS_LOOKUPS, LOOKUP_ROUTES);
  const res = await resolveJobs(found.map((r) => ({ g: LOOKUP_GROUP, r, op: r.ops[0] })));
  state.catalog = sortCatalog([...state.catalog, ...res.catalog]);
  state.problems = [...state.problems, ...res.problems];
  keepCatalog(res.hadErrors);
  return "";
}

/* ---------- Arrival times ---------- */

function normBus(data, tg) {
  let rows = (data || []).filter((e) => !e.dir || e.dir === tg.dirLetter);
  const sameSeq = rows.filter((e) => e.seq != null && Number(e.seq) === tg.seq);
  if (sameSeq.length) rows = sameSeq;
  const times = rows.filter((e) => e.eta)
    .map((e) => ({ t: Date.parse(e.eta), op: tg.op, rmk: e.rmk_en || "", rmkZh: e.rmk_tc || "" }))
    .filter((x) => !isNaN(x.t));
  const noteRow = rows.find((e) => !e.eta && (e.rmk_en || e.rmk_tc));
  return {
    times,
    note: noteRow ? (noteRow.rmk_en || noteRow.rmk_tc) : "",
    dest_en: rows[0] && rows[0].dest_en, dest_zh: rows[0] && rows[0].dest_tc
  };
}

async function etaFor(tg) {
  if (tg.op === "CTB") {
    const r = await getJSON(`${API.CTB}/eta/CTB/${enc(tg.stop)}/${enc(tg.route)}`, 12000, 20000);
    return normBus(r.data, tg);
  }
  if (tg.op === "KMB") {
    const r = await getJSON(`${API.KMB}/eta/${enc(tg.stop)}/${enc(tg.route)}/1`, 12000, 20000);
    return normBus(r.data, tg);
  }
  const r = await getJSON(`${API.GMB}/eta/route-stop/${tg.routeId}/${tg.routeSeq}/${tg.stopSeq}`, 12000, 20000);
  const d = r.data || {};
  if (d.enabled === false) {
    return { times: [], note: d.description_en || d.description_tc || "Arrival times are switched off for this stop." };
  }
  const times = (d.eta || [])
    .map((e) => ({ t: Date.parse(e.timestamp), op: "GMB", rmk: e.remarks_en || "", rmkZh: e.remarks_tc || "" }))
    .filter((x) => !isNaN(x.t));
  return { times, note: "" };
}

async function refresh() {
  if (state.loading) return;
  const visible = [...new Map([...shownStops(), ...savedStops(), ...expandedStops()]
    .map((t) => [t.key, t])).values()];
  if (!visible.length) { $("#banner").innerHTML = ""; render(); return; }
  state.loading = true;
  $("#refreshBtn").disabled = true;
  updateStatus();

  const results = await pool(visible, 6, etaFor);
  let failures = 0;
  state.failStreak = results.every((r) => r && r.error) ? (state.failStreak || 0) + 1 : 0;
  visible.forEach((tg, i) => {
    const r = results[i];
    const prev = state.eta[tg.key];
    if (r && r.error) {
      failures++;
      logError(`${OP_LABEL[tg.op]} ${tg.route} arrivals`, r.error);
      state.eta[tg.key] = { times: prev ? prev.times : [], note: prev ? prev.note : "", at: prev ? prev.at : 0, error: r.error.message };
    } else {
      if (!tg.dest_en && r.dest_en) tg.dest_en = r.dest_en;
      if (!tg.dest_zh && r.dest_zh) tg.dest_zh = r.dest_zh;
      state.eta[tg.key] = { times: r.times, note: r.note, at: Date.now(), error: null };
    }
  });

  $("#banner").innerHTML = failures === visible.length
    ? HK.state("error", { title: "Couldn't reach any of the arrival-time servers", body: navigator.onLine === false ? "You appear to be offline. Times will refresh when you reconnect." : "Check your internet connection. If this keeps happening while other sites work, open “Technical details” at the bottom.", action: "Try again" })
    : "";

  state.lastUpdate = Date.now();
  state.loading = false;
  $("#refreshBtn").disabled = false;
  render(true);
}

/* ---------- Drawing the page ---------- */

const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" });

function buildRows(groupId) {
  const rows = new Map();
  for (const tg of shownStops()) {
    if (tg.group !== groupId) continue;
    const destKey = tg.dest_zh || (tg.dest_en || "").toLowerCase();
    const stopKey = tg.name_zh || (tg.name_en || "").toLowerCase();
    const k = [tg.route, destKey, stopKey, tg.variant_en || ""].join("|");
    if (!rows.has(k)) rows.set(k, { route: tg.route, dest_en: tg.dest_en, dest_zh: tg.dest_zh,
      name_en: tg.name_en, name_zh: tg.name_zh, variant_en: tg.variant_en, variant_zh: tg.variant_zh, targets: [] });
    const row = rows.get(k);
    row.targets.push(tg);
    // KMB writes names in capitals; prefer another operator's wording when both exist.
    if (row.targets[0].op === "KMB" && tg.op !== "KMB") {
      Object.assign(row, { dest_en: tg.dest_en || row.dest_en, name_en: tg.name_en || row.name_en });
    }
  }
  return [...rows.values()];
}

function rowHTML(row, now, offsetMs) {
  const ops = [...new Set(row.targets.map((t) => t.op))];
  const joint = ops.length > 1;
  const badgeClass = joint ? "op-joint" : "op-" + ops[0].toLowerCase();
  const opText = ops.map((o) => OP_LABEL[o]).join(" + ");

  const datas = row.targets.map((t) => state.eta[t.key]).filter(Boolean);
  const times = datas.flatMap((d) => d.times)
    .map((x) => ({ ...x, t: x.t + offsetMs }))
    .filter((x) => x.t > now - 60000)
    .sort((a, b) => a.t - b.t)
    .slice(0, MAX_TIMES);
  const errored = datas.filter((d) => d.error);
  const note = (datas.find((d) => d.note) || {}).note;

  let timesHTML;
  if (!datas.length) {
    timesHTML = `<div class="none">Loading…</div>`;
  } else if (times.length) {
    timesHTML = `<ol class="times">` + times.map((x, i) => {
      const mins = Math.round((x.t - now) / 60000);
      const due = mins <= 0;
      const sched = /scheduled/i.test(x.rmk) || /未開出|原定/.test(x.rmkZh);
      const cls = ["t", i === 0 ? "first" : "", due ? "due" : "", sched ? "sched" : ""].join(" ");
      const label = sched ? `, scheduled, not live-tracked` : "";
      return `<li class="${cls}" aria-label="${due ? "Due now" : mins + " minutes"} (${clock(x.t)})${label}${joint ? ", " + OP_LABEL[x.op] : ""}">` +
        (joint ? `<span class="tag">${esc(OP_LABEL[x.op])}</span>` : "") +
        `<span class="n">${due ? "Due" : mins}</span>${due ? "" : `<span class="u">min</span>`}` +
        `<span class="clk">${clock(x.t)}</span></li>`;
    }).join("") + `</ol>`;
  } else {
    timesHTML = `<div class="none">${esc(note || "No arrivals listed right now")}</div>`;
  }

  let warn = "";
  if (errored.length) {
    warn = errored.length === datas.length && !times.length
      ? `<p class="warn">Couldn't reach ${esc(opText)}: ${esc(errored[0].error)}.</p>`
      : `<p class="warn">Last update failed for part of this row; some times may be out of date.</p>`;
  }

  const variant = row.variant_en ? ` (${esc(row.variant_en)})` : "";
  return `<li class="arow">
    <div class="rb ${badgeClass}" aria-label="Route ${esc(row.route)}, ${esc(opText)}">${esc(row.route)}<small>${esc(opText)}</small></div>
    <div class="dest">
      <span class="to">${row.dest_en ? "To " + esc(row.dest_en) : "Route " + esc(row.route)}${variant}</span>
      ${row.dest_zh ? `<span class="to-zh" lang="zh-Hant-HK">往 ${esc(row.dest_zh)}</span>` : ""}
      <span class="at">${offsetMs ? `Estimated from the ${esc(row.name_en)} stop, plus ${offsetMs / 60000} min`
        : `Stop: ${esc(row.name_en)} <span lang="zh-Hant-HK">${esc(row.name_zh)}</span>`}</span>
    </div>
    ${timesHTML}
    ${warn}
  </li>`;
}

function render(fresh) {
  const now = Date.now();
  // The board is rebuilt every 10 s so the minutes tick down; keep keyboard focus on the same "Remove from board" button.
  const ae = document.activeElement, keepKey = ae && ae.dataset && ae.dataset.unsave && $("#main").contains(ae) ? ae.dataset.unsave : null;
  const shown = shownStops();
  $("#main").innerHTML = GROUPS.map((g) => {
    const rows = buildRows(g.id);
    const notes = state.problems
      .filter((p) => p.group === g.id)
      // Once the user has picked a stop for that route by hand, stop nagging.
      .filter((p) => !(p.kind === "nomatch" && shown.some((t) => t.group === g.id && t.route === p.route)))
      .map((p) => `<p class="warn">${esc(p.text)}</p>`).join("");
    const body = rows.length
      ? `<ul class="arows">${rows.map((r) => rowHTML(r, now, offsetFor(g) * 60000)).join("")}</ul>` + offsetNote(g)
      : (notes ? "" : HK.state("empty", { title: "No stops are switched on here", body: "Pick some under “Choose stops” below.", compact: true }));
    return `<section class="stop" aria-labelledby="h-${g.id}">
      <h2 class="plate" id="h-${g.id}"><span class="zh" lang="zh-Hant-HK">${esc(g.zh)}</span><span class="en">${esc(g.en)}</span></h2>
      ${notes}${body}</section>`;
  }).join("") + (!GROUPS.length && !savedStops().length
      ? HK.state("empty", { title: "Nothing on your board yet", body: "Look up a route below, then tap “Add to board” beside the stops you use.", compact: true }) : "") + savedStops().map((t) => `<section class="stop saved">
      <h2 class="plate"><span class="zh" lang="zh-Hant-HK">${esc(t.name_zh)}</span><span class="en">${esc(t.name_en)}</span></h2>
      <ul class="arows">${rowHTML({ route: t.route, dest_en: t.dest_en, dest_zh: t.dest_zh, name_en: t.name_en,
        name_zh: t.name_zh, targets: [t] }, now, 0)}</ul>
      <button type="button" class="btn btn-ghost btn-sm unsave" data-unsave="${esc(t.key)}">Remove from board</button>
    </section>`).join("");
  $("#main").classList.toggle("fresh", !!fresh);
  if (keepKey) { const b = [...$("#main").querySelectorAll("button[data-unsave]")].find((x) => x.dataset.unsave === keepKey); if (b) b.focus({ preventScroll: true }); }
  renderLookup();
  updateStatus();
}

/* ---------- Route lookup ---------- */

function lookupTimes(t, now) {
  const d = state.eta[t.key];
  if (!d) return `<div class="lk-times">Loading…</div>`;
  const ts = d.times.filter((x) => x.t > now - 60000).sort((a, b) => a.t - b.t).slice(0, MAX_TIMES);
  const text = ts.length
    ? ts.map((x) => {
        const m = Math.round((x.t - now) / 60000);
        const sched = /scheduled/i.test(x.rmk) || /未開出|原定/.test(x.rmkZh);
        return `<span class="${sched ? "sched" : ""}">${m <= 0 ? "Due" : m + " min"} (${clock(x.t)})</span>`;
      }).join(", ")
    : esc(d.note || "No arrivals listed right now");
  return `<div class="lk-times">${text}${d.error ? ` <span class="warn">Couldn't update: ${esc(d.error)}</span>` : ""}</div>`;
}

function lookupStopHTML(t, now) {
  const saved = state.saved.includes(t.key);
  const onBoard = shownStops().some((s) => s.op === t.op && s.route === t.route && s.stop === t.stop && s.dirKey === t.dirKey);
  const open = state.expanded.has(t.key);
  const k = esc(t.key);
  return `<li class="lk-stop">
    <div class="lk-name"><span class="seq">${esc(t.seq)}.</span> ${esc(t.name_en)} <span lang="zh-Hant-HK">${esc(t.name_zh)}</span></div>
    <div class="lk-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-peek="${k}" aria-expanded="${open}">${open ? "Hide times" : "Show times"}</button>
      ${onBoard ? `<span class="fine">Already on your board</span>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-save="${k}">${saved ? "Remove from board" : "Add to board"}</button>`}
    </div>
    ${open ? lookupTimes(t, now) : ""}
  </li>`;
}

function renderLookup() {
  const body = $("#lookupBody");
  if (!body) return;
  const a = document.activeElement;
  let focusSel = null;
  if (a && body.contains(a)) {
    for (const n of ["data-peek", "data-save", "data-dir"]) {
      if (a.hasAttribute(n)) { focusSel = `[${n}="${a.getAttribute(n)}"]`; break; }
    }
  }
  const now = Date.now();
  body.innerHTML = LOOKUP_ROUTES.flatMap((r) => r.ops.map((op) => {
    const all = state.catalog.filter((t) => t.group === "lookup" && t.route === r.route && t.op === op && (t.region || "") === (r.region || ""));
    if (!all.length) {
      const p = state.problems.find((x) => x.group === "lookup" && x.route === r.route);
      return `<p class="warn">${esc(p ? p.text : `The stop list for route ${r.route} hasn't loaded. Try looking the route up again.`)}</p>`;
    }
    const lk = `${op}|${r.route}|${r.region || ""}`;
    const dirs = [...new Set(all.map((t) => t.dirKey))];
    const cur = dirs.includes(state.lookupDir[lk]) ? state.lookupDir[lk] : dirs[0];
    const tabs = dirs.length > 1 ? `<div class="dirs" role="group" aria-label="Direction">` + dirs.map((dk) => {
      const d = all.find((t) => t.dirKey === dk);
      return `<button type="button" class="btn btn-ghost btn-sm dir" data-lk="${esc(lk)}" data-dir="${esc(dk)}" aria-pressed="${dk === cur}">To ${esc(d.dest_en || dk)}</button>`;
    }).join("") + `</div>` : "";
    return `<h3 class="lk-route">Route ${esc(r.route)} (${esc(OP_LABEL[op])}${r.region ? ", " + esc(r.region) : ""})</h3>` + tabs +
      `<ol class="lk-list">${all.filter((t) => t.dirKey === cur).map((t) => lookupStopHTML(t, now)).join("")}</ol>`;
  })).join("");
  if (focusSel) { const b = body.querySelector(focusSel); if (b) b.focus({ preventScroll: true }); }
}

async function fetchOne(t) {
  try {
    const r = await etaFor(t);
    if (!t.dest_en && r.dest_en) t.dest_en = r.dest_en;
    state.eta[t.key] = { times: r.times, note: r.note, at: Date.now(), error: null };
  } catch (e) {
    logError(`${OP_LABEL[t.op]} ${t.route} arrivals`, e);
    state.eta[t.key] = { times: [], note: "", at: 0, error: e.message };
  }
}

$("#lookupBody").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.dir) {
    state.lookupDir[b.dataset.lk] = b.dataset.dir;
    renderLookup();
    return;
  }
  const key = b.dataset.peek || b.dataset.save;
  const t = key && byKey(key);
  if (!t) return;
  if (b.dataset.peek) {
    if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
    renderLookup();
  } else {
    const i = state.saved.indexOf(key);
    if (i >= 0) state.saved.splice(i, 1); else state.saved.push(key);
    store.set(LS_SAVED, state.saved);
    render();
  }
  if ((state.expanded.has(key) || state.saved.includes(key)) && !state.eta[key]) {
    await fetchOne(t);
    render();
  }
});

$("#main").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-unsave]");
  if (!b) return;
  state.saved = state.saved.filter((k) => k !== b.dataset.unsave);
  store.set(LS_SAVED, state.saved);
  render();
});

function offsetNote(g) {
  if (!g.offsetFrom) return "";
  const m = offsetFor(g);
  return `<p class="fine">No official times exist for ${esc(g.en)}. ${m
    ? `These are ${esc(g.offsetFrom)} times plus ${m} min.`
    : `These are the times at ${esc(g.offsetFrom)}, just before you; the minibus reaches you shortly after. You can add the gap under “Choose stops”.`}</p>`;
}

function updateStatus() {
  const el = $("#status");
  if (waitMs() > 0) { el.textContent = `Waiting ${Math.ceil(waitMs() / 1000)} s: the bus servers asked us to slow down`; return; }
  if (state.loading) { el.textContent = "Updating…"; return; }
  if (!state.lastUpdate) { el.textContent = ""; return; }
  const s = Math.max(0, Math.round((Date.now() - state.lastUpdate) / 1000));
  el.textContent = s < 60 ? `Updated ${s} s ago` : `Updated ${Math.round(s / 60)} min ago`;
}

function checkboxHTML(t, withSeq) {
  return `<label>
    <input type="checkbox" data-key="${esc(t.key)}" ${isShown(t) ? "checked" : ""}>
    <span>${withSeq ? `<span class="seq">${esc(t.seq)}.</span> ` : `<b>${esc(t.route)}</b> ${esc(OP_LABEL[t.op])}, `}${esc(t.name_en)} <span lang="zh-Hant-HK">${esc(t.name_zh)}</span>
    ${withSeq ? "" : `<small>${t.dest_en ? "To " + esc(t.dest_en) : ""}${t.variant_en ? " (" + esc(t.variant_en) + ")" : ""}, stop ID ${esc(t.stop)}</small>`}</span>
  </label>`;
}

function renderPicker() {
  const body = $("#pickerBody");
  $("#picker").hidden = !GROUPS.length;           // "Choose stops" only exists when there are preset headings
  const openIds = new Set([...body.querySelectorAll("details[open]")].map((d) => d.id));
  if (!state.catalog.length) {
    body.innerHTML = `<p class="fine">No stop lists could be loaded. Check the messages above, then try again.</p>
      <div class="actions"><button class="btn btn-ghost" type="button" id="rescan">Reload stop lists</button></div>`;
  } else {
    body.innerHTML = `<p class="fine">Stops whose names match each heading are switched on automatically. To add any other stop, open the full list for its route. Each route is listed direction by direction, in the order the vehicle reaches the stops.</p>` +
      GROUPS.map((g) => {
        const matched = state.catalog.filter((t) => t.group === g.id && t.matched);
        const perRoute = g.routes.flatMap((r) => r.ops.map((op) => {
          const all = state.catalog.filter((t) => t.group === g.id && t.route === r.route && t.op === op);
          if (!all.length) return "";
          const dirs = [...new Set(all.map((t) => t.dirKey))];
          const id = `all-${g.id}-${r.route}-${op}`;
          return `<details class="all" id="${esc(id)}"><summary>All stops on route ${esc(r.route)} (${esc(OP_LABEL[op])})</summary>` +
            dirs.map((dk) => {
              const inDir = all.filter((t) => t.dirKey === dk);
              const d = inDir[0];
              const head = d.dest_en ? `Towards ${esc(d.dest_en)}` : `Direction ${esc(dk)}`;
              return `<h4>${head}${d.variant_en ? " (" + esc(d.variant_en) + ")" : ""}</h4>` +
                inDir.map((t) => checkboxHTML(t, true)).join("");
            }).join("") + `</details>`;
        })).join("");
        const offsetInput = g.offsetFrom ? `<label class="offset">Minutes from ${esc(g.offsetFrom)} to ${esc(g.en)}:
            <input type="number" inputmode="numeric" min="0" max="15" step="1" data-offset="${esc(g.id)}" value="${offsetFor(g)}"></label>` : "";
        return `<fieldset><legend>${esc(g.en)} <span lang="zh-Hant-HK">${esc(g.zh)}</span></legend>` + offsetInput +
          (matched.length ? matched.map((t) => checkboxHTML(t, false)).join("")
                          : `<p class="fine">No stop names matched this heading.</p>`) +
          perRoute + `</fieldset>`;
      }).join("") +
      `<div class="actions"><button class="btn" type="button" id="rescan">Reload stop lists</button>
       <span class="fine">Use this if a route changes or a stop goes missing.</span></div>`;
  }
  openIds.forEach((id) => { const d = document.getElementById(id); if (d) d.open = true; });
  $("#rescan").addEventListener("click", rescan);
}

$("#pickerBody").addEventListener("change", (e) => {
  const gid = e.target && e.target.dataset && e.target.dataset.offset;
  if (gid) {
    const n = Math.max(0, Math.min(15, Math.round(Number(e.target.value) || 0)));
    e.target.value = n;
    state.offsets[gid] = n;
    store.set(LS_OFFSET, state.offsets);
    render();
    return;
  }
  const key = e.target && e.target.dataset && e.target.dataset.key;
  if (!key) return;
  const t = state.catalog.find((x) => x.key === key);
  if (!t) return;
  const on = e.target.checked;
  if (t.matched) { if (on) state.hidden.delete(key); else state.hidden.add(key); }
  else { if (on) state.added.add(key); else state.added.delete(key); }
  store.set(LS_HIDDEN, [...state.hidden]);
  store.set(LS_ADDED, [...state.added]);
  // The same stop can appear in two lists; keep both boxes in step.
  document.querySelectorAll("#pickerBody input[data-key]").forEach((i) => { if (i.dataset.key === key) i.checked = on; });
  render();
  if (on && !state.eta[key]) refresh();
});

async function rescan() {
  store.del(LS_CATALOG);
  nameCache.clear(); names = {}; store.del(LS_NAMES);
  state.eta = {};
  state.expanded.clear();
  await resolveAll();
  renderPicker();
  render();
  refresh();
}

/* ---------- Start-up and timers ---------- */

async function init() {
  state.hidden = new Set(store.get(LS_HIDDEN) || []);
  state.added = new Set(store.get(LS_ADDED) || []);
  state.offsets = store.get(LS_OFFSET) || {};
  state.saved = store.get(LS_SAVED) || [];
  LOOKUP_ROUTES.push(...(store.get(LS_LOOKUPS) || []).filter((r) => r && r.route && Array.isArray(r.ops)));
  const cached = store.get(LS_CATALOG);
  const complete = (c) => LOOKUP_ROUTES.every((r) => c.some((t) => t.group === "lookup" && t.route === r.route && (t.region || "") === (r.region || "")));
  if (cached && cached.catalog && Date.now() - cached.at < STOP_CACHE_DAYS * 864e5 && complete(cached.catalog)) {
    state.catalog = cached.catalog;
    state.problems = cached.problems || [];
  } else {
    await resolveAll();
  }
  renderPicker();
  render();
  refresh();

  // Ask again every REFRESH_SECONDS while the page is showing; after failures wait twice as long each time (up to 5 min).
  const tick = async () => {
    if (!document.hidden) await refresh();
    setTimeout(tick, Math.min(REFRESH_SECONDS * 1000 * 2 ** Math.min(state.failStreak || 0, 3), 300000));
  };
  setTimeout(tick, REFRESH_SECONDS * 1000);
  setInterval(() => { if (!document.hidden && !state.loading) render(); }, 10000);
  setInterval(() => { if (!document.hidden) updateStatus(); }, 1000);          // keeps the "waiting" countdown true
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - state.lastUpdate > 45000) refresh();     // the data is regenerated about once a minute
  });
  // "Refresh now" does not ask again within 20 s of the last answer: nothing newer exists.
  $("#refreshBtn").addEventListener("click", () => { if (Date.now() - state.lastUpdate > 20000) refresh(); });
  HK.onRetry($("#banner"), refresh);
  $("#lookupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#lookupRoute"), msg = $("#lookupMsg"), btn = $("#lookupGo");
    btn.disabled = true; msg.textContent = "Looking up…";
    const problem = await lookupRoute(input.value);
    btn.disabled = false; msg.textContent = problem;
    if (!problem) { input.value = ""; renderPicker(); render(); }
  });
}

init();
