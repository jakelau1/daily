/* Day trips: list and detail views, hash routing and view transitions. Content is in trips-data.js, the sky in sky.js. */
const $ = (s) => document.querySelector(s);
const listView = $("#list-view"), dayView = $("#day-view"), dayBody = $("#day-body");
let filter = "all";
let listScroll = 0;
let lastDay = null;
let cameFromList = false;

document.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = svg(el.dataset.icon); });

function renderChips() {
  const counts = { all: DAYS.length };
  DAYS.forEach((d) => { counts[d.r] = (counts[d.r] || 0) + 1; });
  const opts = [["all", "All"]].concat(Object.keys(REGIONS).map((k) => [k, REGIONS[k].short]));
  $("#chips").innerHTML = opts.map(([k, label]) =>
    `<button class="chip" type="button" data-f="${k}" aria-pressed="${filter === k}">${label}<span>${counts[k]}</span></button>`
  ).join("");
}

function tile(d) {
  return `<a class="tile" href="#day-${d.n}" data-n="${d.n}" data-r="${d.r}">
    <span class="tile-n">${d.n}</span>
    <span>
      <span class="tile-zh" lang="zh-Hant">${d.zh}</span>
      <span class="tile-en">${d.en}</span>
      <span class="tile-meta">${d.tags}${d.when ? ` <em class="when">${d.when}</em>` : ""}</span>
    </span>
    <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
  </a>`;
}

function renderList() {
  renderChips();
  const keys = filter === "all" ? Object.keys(REGIONS) : [filter];
  $("#groups").innerHTML = keys.map((k) => `
    <section class="group" data-r="${k}">
      <h2>${REGIONS[k].name}</h2>
      ${DAYS.filter((d) => d.r === k).map(tile).join("")}
    </section>`).join("");
  $("#extras").innerHTML = EXTRAS.map((e) => `
    <div class="extra"><p><strong>${e.h}.</strong> ${e.t}</p>${e.c ? `<p class="chk"><b>Check</b> ${e.c}</p>` : ""}</div>`).join("");
}

function renderDay(d) {
  const i = DAYS.indexOf(d);
  const prev = DAYS[i - 1], next = DAYS[i + 1];
  $("#count").textContent = `Day ${d.n} of ${DAYS.length}`;
  dayBody.innerHTML = `
    <header class="dhead" data-r="${d.r}">
      <h2 class="d-zh" lang="zh-Hant" id="day-title" tabindex="-1">${d.zh}</h2>
      <p class="d-en">${d.en}</p>
      <div class="pills">
        <span class="pill region">${REGIONS[d.r].name}</span>
        ${d.tags.split(", ").map((t) => `<span class="pill">${t[0].toUpperCase() + t.slice(1)}</span>`).join("")}
      </div>
    </header>
    <section class="sheet" data-r="${d.r}" aria-label="Route">
      ${d.when ? `<div class="whenbox">${svg("cal")}<p><strong>${d.when}.</strong>${d.whenNote ? " " + d.whenNote : ""}</p></div>` : ""}
      <ol class="route">
        ${d.steps.map((s, k) => `
          <li class="step" data-i="${k}">
            <span class="ico">${svg(s.m === "peak" ? "peak" : s.m)}</span>
            <p><span class="mode">${MODES[s.m]}</span>${s.t}${s.c ? `<br><span class="chk"><b>Check</b> ${s.c}</span>` : ""}</p>
          </li>`).join("")}
      </ol>
      ${(d.alts || []).map((a) => `
        <div class="alt">
          <h3>${a.h}</h3>
          <p>${a.t}</p>
          ${a.c ? `<p class="chk"><b>Check</b> ${a.c}</p>` : ""}
        </div>`).join("")}
      ${d.notes ? `<div class="notes">${d.notes.map((n) => `<p>${n}</p>`).join("")}</div>` : ""}
    </section>
    <nav class="pager" aria-label="Other days">
      ${prev ? `<a class="prev" href="#day-${prev.n}"><small>Day ${prev.n}</small><span lang="zh-Hant">${prev.zh}</span></a>` : ""}
      ${next ? `<a class="next" href="#day-${next.n}"><small>Day ${next.n}</small><span lang="zh-Hant">${next.zh}</span></a>` : ""}
    </nav>
    <footer class="end"><p>Anything marked Check is from memory or unconfirmed. Confirm it in HKeMobility or Citymapper before you go.</p></footer>`;
  // inline style="" is blocked by the site CSP, so per-step delays and the shared-element name are set here
  dayBody.querySelectorAll("[data-i]").forEach((el) => el.style.setProperty("--i", el.dataset.i));
  $("#day-title").style.viewTransitionName = "glyph";
}

/* ======================================================================
   Routing with view transitions
   ====================================================================== */

function currentDay() {
  const m = location.hash.match(/^#day-(\d+)$/);
  return m ? DAYS.find((d) => d.n === Number(m[1])) : null;
}

function apply() {
  const d = currentDay();
  if (d) {
    if (!listView.hidden) listScroll = window.scrollY;
    document.querySelectorAll(".tile-zh").forEach((el) => { el.style.viewTransitionName = ""; });
    listView.hidden = true;
    dayView.hidden = false;
    dayView.classList.remove("is-open");
    renderDay(d);
    void dayView.offsetWidth;
    dayView.classList.add("is-open");
    window.scrollTo({ top: 0, behavior: "instant" });
    lastDay = d.n;
    document.title = `Day ${d.n}: ${d.en} | Hong Kong, as a visitor`;
    $("#day-title").focus({ preventScroll: true });
  } else {
    dayView.hidden = true;
    listView.hidden = false;
    document.querySelectorAll(".tile-zh").forEach((el) => { el.style.viewTransitionName = ""; });
    if (lastDay) {
      const t = document.querySelector(`.tile[data-n="${lastDay}"] .tile-zh`);
      if (t) t.style.viewTransitionName = "glyph";
    }
    window.scrollTo({ top: listScroll, behavior: "instant" });
    document.title = "Hong Kong, as a visitor: 15 day trips from Happy Valley";
    if (lastDay) {
      const link = document.querySelector(`.tile[data-n="${lastDay}"]`);
      if (link) link.focus({ preventScroll: true });
    }
  }
  sky.setIdle(!!d);
  sky.syncScroll(true);
}

function route() {
  if (document.startViewTransition && !reduceMotion.matches) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) {
    filter = chip.dataset.f;
    const go = () => renderList();
    if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(go); else go();
    return;
  }
  const t = e.target.closest(".tile");
  if (t) {
    cameFromList = true;
    document.querySelectorAll(".tile-zh").forEach((el) => { el.style.viewTransitionName = ""; });
    const zh = t.querySelector(".tile-zh");
    if (zh) zh.style.viewTransitionName = "glyph";
  }
  if (e.target.closest(".pager a")) cameFromList = false;
});

$("#back").addEventListener("click", () => {
  if (cameFromList) { cameFromList = false; history.back(); }
  else { location.hash = ""; }
});

window.addEventListener("hashchange", route);

/* ---------- Start ---------- */
renderList();
apply();
