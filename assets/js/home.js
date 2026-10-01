/* Home: live "right now" stats (temperature + warnings, fastest harbour tunnel, next bus 1) and legacy-link forwarding. */
(function () {
  // The weather page used to live at the site root, with the place in the hash (#happy-valley). Forward those links.
  if (location.hash && !/^#(explore|main)$/.test(location.hash)) { location.replace("weather/" + location.hash); return; }

  var root = document.querySelector("[data-live-stats]");
  if (!root || !window.HK) return;
  var HK = window.HK, reduce = window.HKMotion && window.HKMotion.reduce;
  var API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?lang=en&dataType=";
  var JT = "https://resource.data.one.gov.hk/td/jss/Journeytimev2.xml";
  var CTB = "https://rt.data.gov.hk/v2/transport/citybus";
  var TUNNELS = { WH: "Western", CH: "Cross Harbour", EH: "Eastern" };
  var box = {};
  ["temp", "tunnel", "bus"].forEach(function (k) {
    var el = root.querySelector('[data-stat="' + k + '"]');
    box[k] = { el: el, n: el.querySelector(".stat-n"), x: el.querySelector(".stat-extra"), shown: false };
  });

  function badge(kind, text) { return '<span class="badge ' + kind + '">' + HK.esc(text) + "</span>"; }
  function show(k, value, unit, extraHTML) {
    var b = box[k], num = parseFloat(value), animate = !reduce && !b.shown && isFinite(num) && String(value) === String(num);
    b.shown = true;
    b.n.innerHTML = '<span class="mono" data-v>' + (animate ? "0" : HK.esc(value)) + "</span>" + (unit ? "<small>" + HK.esc(unit) + "</small>" : "");
    b.x.innerHTML = extraHTML || "";
    if (animate) {
      var span = b.n.querySelector("[data-v]"), t0 = null;
      requestAnimationFrame(function f(t) {
        t0 = t0 || t; var p = Math.min(1, (t - t0) / 1000);
        span.textContent = Math.round(num * (1 - Math.pow(1 - p, 4)));
        if (p < 1) requestAnimationFrame(f); else span.textContent = value;
      });
    }
  }
  function problem(k, kind, title, body, retry) {
    var b = box[k];
    b.shown = true;
    b.n.innerHTML = '<span class="mono">–</span>';
    b.x.innerHTML = badge(kind === "error" ? "bad" : "info", title) + (body ? '<span class="stat-note">' + HK.esc(body) + "</span>" : "") + (retry ? ' <button class="btn btn-ghost btn-sm" type="button" data-retry-stat="' + k + '">Try again</button>' : "");
  }

  function loadTemp() {
    return Promise.all([HK.get(API + "rhrread", { retries: 1 }), HK.get(API + "warnsum").catch(function () { return null; })]).then(function (r) {
      var d = r[0], list = (d.temperature && d.temperature.data) || [];
      var hv = list.filter(function (x) { return /happy valley/i.test(x.place); })[0] || list.filter(function (x) { return /observatory/i.test(x.place); })[0] || list[0];
      if (!hv) return problem("temp", "empty", "No reading", "The Observatory sent no temperatures.");
      var w = r[1], names = w ? Object.keys(w).map(function (k) { return w[k].name || k; }) : null, x;
      if (names === null) x = badge("info", "Warnings unavailable");
      else if (!names.length) x = badge("ok", "No warnings in force");
      else x = badge(names.some(function (n) { return /red|black|signal no\. ?(8|9|10)/i.test(n); }) ? "bad" : "warn", names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : ""));
      show("temp", hv.value, "°C", x + '<span class="stat-note">' + HK.esc(hv.place) + "</span>");
    }, function (e) { problem("temp", "error", "Observatory not answering", HK.why(e), true); });
  }

  function child(rec, name) { for (var i = 0; i < rec.children.length; i++) if (rec.children[i].localName === name) return rec.children[i].textContent.trim(); return ""; }
  function loadTunnel() {
    return HK.get(JT, { type: "text", cache: "no-store", retries: 1 }).then(function (txt) {
      var doc = new DOMParser().parseFromString(txt, "text/xml");
      if (doc.getElementsByTagName("parsererror").length) { var pe = new Error("parse"); pe.kind = "parse"; throw pe; }
      var recs = Array.prototype.slice.call(doc.getElementsByTagNameNS("*", "jtis_journey_time")), best = null, newest = 0;
      recs.forEach(function (r) {
        if (child(r, "LOCATION_ID") !== "H2" || !TUNNELS[child(r, "DESTINATION_ID")] || child(r, "JOURNEY_TYPE") !== "1") return;
        var mins = parseInt(child(r, "JOURNEY_DATA"), 10), t = Date.parse(child(r, "CAPTURE_DATE") + "+08:00");
        if (!isFinite(mins)) return;
        if (t > newest) newest = t;
        if (!best || mins < best.mins) best = { mins: mins, tunnel: TUNNELS[child(r, "DESTINATION_ID")], colour: child(r, "COLOUR_ID") };
      });
      if (!best) return problem("tunnel", "empty", "No times reported", "The roadside board isn't giving tunnel times right now.");
      var kind = best.colour === "3" ? "ok" : best.colour === "2" ? "warn" : "bad", word = best.colour === "3" ? "Smooth" : best.colour === "2" ? "Slow" : "Congested";
      var old = newest && Date.now() - newest > 10 * 60000;
      show("tunnel", String(best.mins), "min", badge(kind, word) + '<span class="stat-note">via ' + HK.esc(best.tunnel) + "</span>" + (old ? badge("warn", "Over 10 min old") : ""));
    }, function (e) { problem("tunnel", "error", "Roads feed not answering", HK.why(e), true); });
  }

  function loadBus() {
    var cat = null;
    try { cat = JSON.parse(HK.store.get("hvEta.catalog.v5") || "null"); } catch (e) { /* ignore */ }
    var hit = cat && cat.catalog && cat.catalog.filter(function (c) { return c.op === "CTB" && c.route === "1" && c.group === "kks" && c.matched; })[0];
    if (!hit) {
      box.bus.shown = true;
      box.bus.n.innerHTML = '<span class="mono">–</span>';
      box.bus.x.innerHTML = badge("info", "Not set up yet") + '<a class="fold-more" href="arrivals/">Open Arrivals once <span class="arr" aria-hidden="true">→</span></a>';
      return Promise.resolve();
    }
    return HK.get(CTB + "/eta/CTB/" + hit.stop + "/1", { retries: 1 }).then(function (d) {
      var now = Date.now(), etas = (d.data || []).filter(function (x) { return x.eta && (!hit.dirLetter || x.dir === hit.dirLetter); })
        .map(function (x) { return { t: Date.parse(x.eta), dest: x.dest_en }; }).filter(function (x) { return isFinite(x.t) && x.t > now - 60000; }).sort(function (a, b) { return a.t - b.t; });
      if (!etas.length) return problem("bus", "empty", "No arrivals listed", "Citybus lists nothing for this stop right now.");
      var m = Math.round((etas[0].t - now) / 60000);
      if (m <= 0) show("bus", "Due", "", badge("ok", "Arriving") + '<span class="stat-note">to ' + HK.esc(etas[0].dest || hit.dest_en || "") + "</span>");
      else show("bus", String(m), "min", badge(m <= 5 ? "ok" : "info", m <= 5 ? "Soon" : "Scheduled") + '<span class="stat-note">to ' + HK.esc(etas[0].dest || hit.dest_en || "") + "</span>");
    }, function (e) { problem("bus", "error", "Citybus not answering", HK.why(e), true); });
  }

  var loaders = { temp: loadTemp, tunnel: loadTunnel, bus: loadBus };
  var stamp = root.querySelector("[data-stats-time]");
  function all() { return Promise.all([loadTemp(), loadTunnel(), loadBus()]).then(function () { if (stamp) stamp.textContent = "· " + HK.clock(new Date()); }); }
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-retry-stat]"); if (!b) return;
    var k = b.getAttribute("data-retry-stat"); box[k].shown = false;
    box[k].n.innerHTML = '<span class="skeleton skel-h3" aria-hidden="true"></span>'; box[k].x.innerHTML = "";
    loaders[k]();
  });
  all();
  setInterval(function () { if (!document.hidden) all(); }, 120000);
})();
