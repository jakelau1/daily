/* Roads: harbour-tunnel journey times (Transport Department roadside boards) and traffic cameras. Ported from the standalone road-cameras page. */
(function () {
  "use strict";
  var HK = window.HK;

  var REFRESH_MS = 120000; // two minutes, matching the government's update cycle
  var BASE = "https://tdcctv.data.one.gov.hk/";
  var JT_URL = "https://resource.data.one.gov.hk/td/jss/Journeytimev2.xml";

  // Roadside boards, from the official data specification.
  var JT_TO_KLN = { id: "H2", label: "From Canal Road Flyover, near the Aberdeen Tunnel exit" };
  // Kowloon to the Island. West Kowloon Highway (K07) is left out: the feed gives it no harbour-tunnel times.
  var JT_TO_HK = [
    { id: "K02", label: "Gascoigne Road, near PolyU" },
    { id: "K06", label: "Chatham Road North, near Fat Kwong Street Playground" },
    { id: "K03", label: "Waterloo Road, near Kowloon Hospital" },
    { id: "K04", label: "Princess Margaret Road, near Oi Man Estate" },
    { id: "K01", label: "Ferry Street, near Charming Garden" },
    { id: "K05", label: "Kai Fuk Road, near the petrol stations" },
    { id: "K08", label: "Kai Cheung Road, near Kowloon Bay Fire Station" }
  ];
  var JT_TUNNELS = [{ id: "WH", name: "Western" }, { id: "CH", name: "Cross Harbour" }, { id: "EH", name: "Eastern" }];

  // Camera codes are from the Transport Department "Traffic snapshot images" dataset.
  var TRAFFIC = [
    { group: "Leaving Happy Valley", cams: [
      { id: "AID01108", name: "Wong Nai Chung Gap Flyover near Racecourse", dir: "Northbound" },
      { id: "AID01216", name: "Wong Nai Chung Gap Flyover near Racecourse", dir: "Southbound" }] },
    { group: "Western Harbour Crossing", cams: [
      { id: "H702F", name: "Western Harbour Crossing", dir: "Hong Kong side" },
      { id: "K901F", name: "Western Harbour Crossing", dir: "Kowloon side" }] },
    { group: "Cross Harbour Tunnel", cams: [
      { id: "H207F", name: "Cross Harbour Tunnel", dir: "Hong Kong side" },
      { id: "K107F", name: "Cross Harbour Tunnel", dir: "Kowloon side" }] },
    { group: "Eastern Harbour Crossing", cams: [
      // No camera is named as the Eastern Harbour Crossing's Hong Kong entrance; this is the closest named one, and it faces westbound.
      { id: "AID04222", name: "Island Eastern Corridor near Eastern Harbour Crossing", dir: "Westbound" },
      { id: "K952F", name: "Eastern Harbour Crossing", dir: "Kowloon side" }] }
  ];
  var WINDOW = [
    { id: "TC560F", name: "Tsing Ma Bridge", dir: "" },
    { id: "TC604F", name: "Ting Kau Bridge", dir: "" },
    { id: "TC551F", name: "Kap Shui Mun Bridge", dir: "" },
    { id: "AID10114", name: "Shenzhen Bay Bridge", dir: "Northbound" },
    { id: "AID04107", name: "Island Eastern Corridor near North Point Ferry Pier", dir: "Eastbound" },
    { id: "H429F", name: "Aberdeen Praya Road near Fish Market", dir: "" },
    { id: "K101F", name: "Salisbury Road near Nathan Road", dir: "" },
    { id: "H107F", name: "Pedder Street", dir: "" },
    { id: "TDS90046", name: "Tuen Mun Road near Castle Peak Beach", dir: "Westbound" }
  ];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---- camera tiles ----
  var tiles = [];
  function makeTile(cam) {
    var fig = el("figure", "cam is-loading");
    var shot = el("button", "shot");
    shot.type = "button";
    shot.setAttribute("aria-label", "Enlarge " + cam.name + (cam.dir ? ", " + cam.dir : ""));
    var img = new Image();
    img.alt = cam.name + (cam.dir ? ", " + cam.dir : "");
    img.width = 320; img.height = 240; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    var skel = el("span", "skeleton cam-skel"); skel.setAttribute("aria-hidden", "true");
    var msg = el("span", "msg");
    msg.appendChild(el("span", "badge bad", "Camera not responding"));
    msg.appendChild(el("span", "", "Trying again at the next refresh."));
    shot.appendChild(skel); shot.appendChild(img); shot.appendChild(msg);
    var cap = el("figcaption", "", cam.name);
    if (cam.dir) cap.appendChild(el("small", "", cam.dir));
    fig.appendChild(shot); fig.appendChild(cap);
    var tile = { id: cam.id, img: img, fig: fig, name: cam.name, dir: cam.dir };
    tiles.push(tile);
    shot.addEventListener("click", function () { openZoom(tile); });
    return fig;
  }
  var groupsEl = document.getElementById("traffic-groups");
  TRAFFIC.forEach(function (g) {
    var wrap = el("div", "cam-group");
    wrap.appendChild(el("h3", "cam-h", g.group));
    var grid = el("div", "grid");
    g.cams.forEach(function (cam) { grid.appendChild(makeTile(cam)); });
    wrap.appendChild(grid); groupsEl.appendChild(wrap);
  });
  var stripEl = document.getElementById("window-strip");
  WINDOW.forEach(function (cam) { stripEl.appendChild(makeTile(cam)); });
  if (window.HKMotion) window.HKMotion.observe(groupsEl);

  // The new picture loads off-screen first, then swaps in, so tiles never flash blank. "?t=" avoids a cached copy; if the server dislikes it, retry once plain.
  function load(tile, stamp) {
    return new Promise(function (done) {
      var probe = new Image(), plain = false;
      probe.referrerPolicy = "no-referrer";
      probe.onload = function () {
        tile.img.src = probe.src;
        tile.fig.classList.remove("is-down", "is-loading");
        if (zoomTile === tile) zoomImg.src = probe.src;
        done(true);
      };
      probe.onerror = function () {
        if (!plain) { plain = true; probe.src = BASE + tile.id + ".JPG"; return; }
        tile.fig.classList.remove("is-loading");
        tile.fig.classList.add("is-down");
        done(false);
      };
      probe.src = BASE + tile.id + ".JPG?t=" + stamp;
    });
  }

  // ---- journey times ----
  var STATES = { "1": ["bad", "Congested"], "2": ["warn", "Slow"], "3": ["ok", "Smooth"] };
  function field(rec, name) {
    for (var i = 0; i < rec.children.length; i++) { var c = rec.children[i]; if ((c.localName || c.nodeName).toUpperCase() === name) return (c.textContent || "").trim(); }
    return "";
  }
  function parseJourneyTimes(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) { var e = new Error("parse"); e.kind = "parse"; throw e; }
    var ids = doc.getElementsByTagNameNS("*", "LOCATION_ID");
    if (!ids.length) ids = doc.getElementsByTagName("LOCATION_ID");
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var rec = ids[i].parentNode;
      out.push({ loc: field(rec, "LOCATION_ID"), dest: field(rec, "DESTINATION_ID"), captured: field(rec, "CAPTURE_DATE"), type: field(rec, "JOURNEY_TYPE"), data: field(rec, "JOURNEY_DATA"), colour: field(rec, "COLOUR_ID") });
    }
    if (!out.length) { var e2 = new Error("empty"); e2.kind = "parse"; throw e2; }
    return out;
  }
  function describe(r) {
    if (!r) return { missing: true };
    var st = STATES[r.colour] || ["", ""];
    if (r.type === "1") {
      var mins = parseInt(r.data, 10);
      return isNaN(mins) || mins < 0 ? { text: "No reading" } : { mins: mins, kind: st[0], state: st[1] };
    }
    if (r.type === "2") {
      if (r.data === "1") return { text: "Heavy congestion", kind: "bad" };
      if (r.data === "3") return { text: "Tunnel closed", kind: "bad" };
    }
    return { text: "No reading" };
  }

  var klnEl = document.getElementById("jt-kln"), hkEl = document.getElementById("jt-hk"), noteEl = document.getElementById("jt-note"), pickEl = document.getElementById("jt-from");
  var lastRecords = null, PICK_KEY = "roadcams.jtFrom";
  JT_TO_HK.forEach(function (b) { var o = el("option", "", b.label); o.value = b.id; pickEl.appendChild(o); });
  var savedPick = HK.store.get(PICK_KEY);
  if (savedPick && JT_TO_HK.some(function (b) { return b.id === savedPick; })) pickEl.value = savedPick;
  pickEl.addEventListener("change", function () { HK.store.set(PICK_KEY, pickEl.value); if (lastRecords) renderJourneyTimes(lastRecords); });

  function renderBoard(target, records, boardId, label) {
    var mine = records.filter(function (r) { return r.loc === boardId; }), newest = "";
    var cells = JT_TUNNELS.map(function (t) {
      var r = mine.filter(function (x) { return x.dest === t.id; })[0];
      if (r && r.captured > newest) newest = r.captured;
      return { tunnel: t, d: describe(r) };
    });
    if (cells.every(function (c) { return c.d.missing; })) {
      HK.setHTML(target, HK.state("empty", { title: "This board isn't reporting harbour-tunnel times right now", body: "Pick another board, or check the cameras below.", compact: true }));
      return "";
    }
    var best = null;
    cells.forEach(function (c) { if (typeof c.d.mins === "number" && (best === null || c.d.mins < best)) best = c.d.mins; });
    var row = el("div", "jt-row");
    if (label) row.appendChild(el("p", "jt-from", label));
    var grid = el("div", "jt-cells");
    cells.forEach(function (c) {
      var isBest = typeof c.d.mins === "number" && c.d.mins === best && cells.filter(function (x) { return typeof x.d.mins === "number"; }).length > 1;
      var cell = el("div", "jt-cell" + (c.d.kind ? " k-" + c.d.kind : "") + (c.d.missing ? " is-missing" : "") + (isBest ? " is-best" : ""));
      cell.appendChild(el("span", "jt-name", c.tunnel.name));
      if (typeof c.d.mins === "number") {
        var m = el("span", "jt-min mono", String(c.d.mins)); m.appendChild(el("small", "", " min")); cell.appendChild(m);
        cell.appendChild(el("span", "badge " + c.d.kind, c.d.state));
        if (isBest) cell.appendChild(el("span", "jt-best", "Fastest"));
      } else if (c.d.missing) {
        cell.appendChild(el("span", "jt-min is-text", "Not reported"));
        cell.appendChild(el("span", "jt-sub", "This board doesn't measure this tunnel."));
      } else {
        cell.appendChild(el("span", "jt-min is-text", c.d.text));
        if (c.d.kind) cell.appendChild(el("span", "badge " + c.d.kind, "Warning"));
      }
      grid.appendChild(cell);
    });
    row.appendChild(grid);
    target.textContent = ""; target.appendChild(row);
    return newest;
  }
  function renderJourneyTimes(records) {
    lastRecords = records;
    var a = renderBoard(klnEl, records, JT_TO_KLN.id, JT_TO_KLN.label);
    var b = renderBoard(hkEl, records, pickEl.value, "");
    var newest = a > b ? a : b, note = "Times run from the roadside board to the far end of each tunnel.";
    var stale = false;
    if (newest) {
      var t = Date.parse(newest + "+08:00");
      if (!isNaN(t)) { note += " Estimates from " + HK.clock(t) + "."; stale = Date.now() - t > 10 * 60000; }
    }
    noteEl.innerHTML = HK.esc(note) + (stale ? ' <span class="badge warn">More than 10 minutes old</span>' : "");
  }
  function loadJourneyTimes() {
    return HK.get(JT_URL, { type: "text", cache: "no-store" }).then(function (text) {
      renderJourneyTimes(parseJourneyTimes(text)); return true;
    }).catch(function (err) {
      var html = HK.state("error", { title: "Journey times unavailable", body: HK.why(err) + " The cameras below still work.", action: "Try again" });
      if (lastRecords) { noteEl.innerHTML = HK.state("stale", { title: "Showing the last journey times we received", body: HK.why(err), compact: true }); return false; }
      klnEl.innerHTML = html; hkEl.textContent = ""; noteEl.textContent = "";
      return false;
    });
  }
  HK.onRetry(document.getElementById("jt"), function () { refreshAll(); });

  // ---- refresh cycle ----
  var statusEl = document.getElementById("status"), cycleEl = document.getElementById("cycle"), timer = null, lastRefresh = 0, busy = false;
  function restartCycleBar() {
    cycleEl.classList.remove("run"); void cycleEl.offsetWidth;
    cycleEl.style.setProperty("--cycle", (REFRESH_MS / 1000) + "s"); cycleEl.classList.add("run");
  }
  function refreshAll() {
    if (busy) return;
    busy = true;
    var stamp = Math.floor(Date.now() / 1000);
    statusEl.textContent = "Updating…";
    Promise.all([Promise.all(tiles.map(function (t) { return load(t, stamp); })), loadJourneyTimes()]).then(function (r) {
      busy = false;
      var imgsOk = r[0].filter(Boolean).length, jtOk = r[1];
      if (imgsOk || jtOk) { lastRefresh = Date.now(); statusEl.textContent = "Updated " + HK.clock(lastRefresh) + (imgsOk < tiles.length ? " · " + (tiles.length - imgsOk) + " camera" + (tiles.length - imgsOk > 1 ? "s" : "") + " not responding" : ""); }
      else statusEl.textContent = "Couldn't update. Trying again in 2 minutes.";
      restartCycleBar(); schedule();
    });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refreshAll, REFRESH_MS); }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clearTimeout(timer);
    else if (Date.now() - lastRefresh >= REFRESH_MS) refreshAll();
    else { clearTimeout(timer); timer = setTimeout(refreshAll, REFRESH_MS - (Date.now() - lastRefresh)); }
  });
  document.getElementById("refresh").addEventListener("click", refreshAll);

  // ---- enlarged view ----
  var zoom = document.getElementById("zoom"), zoomImg = document.getElementById("zoom-img"), zoomTile = null;
  function openZoom(tile) {
    zoomTile = tile; zoomImg.src = tile.img.src; zoomImg.alt = tile.img.alt;
    document.getElementById("zoom-title").textContent = tile.name;
    document.getElementById("zoom-dir").textContent = tile.dir || "";
    if (typeof zoom.showModal === "function") zoom.showModal();
  }
  function closeZoom() { zoomTile = null; if (zoom.open) zoom.close(); }
  document.getElementById("zoom-close").addEventListener("click", closeZoom);
  zoom.addEventListener("click", function (e) { if (e.target === zoom) closeZoom(); });
  zoom.addEventListener("close", function () { zoomTile = null; });

  refreshAll();
})();
