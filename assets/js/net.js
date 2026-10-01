/* Shared helpers, exposed as window.HK: fetching with timeout/retry, escaping, times, and the four page states. */
(function () {
  var HK = window.HK = {};

  HK.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };

  // fetch with a timeout and optional retries. type: "json" | "text". Errors carry .kind: "offline" | "timeout" | "http" | "parse" | "blocked".
  HK.get = function (url, opts) {
    opts = opts || {};
    var type = opts.type || "json", ms = opts.timeout || 15000, tries = 1 + (opts.retries || 0);
    function once() {
      var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms);
      return fetch(url, { signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: opts.cache || "default" })
        .then(function (r) {
          clearTimeout(t);
          if (!r.ok) { var e = new Error("HTTP " + r.status); e.kind = "http"; e.status = r.status; throw e; }
          return type === "json" ? r.json().catch(function () { var e = new Error("Bad data"); e.kind = "parse"; throw e; }) : r.text();
        }, function (err) {
          clearTimeout(t);
          var e = new Error(err && err.name === "AbortError" ? "Timed out" : "Network error");
          e.kind = navigator.onLine === false ? "offline" : (err && err.name === "AbortError" ? "timeout" : "blocked");
          throw e;
        });
    }
    var n = 0;
    function run() {
      return once().catch(function (e) {
        if (++n < tries && e.kind !== "parse") return new Promise(function (ok) { setTimeout(ok, 1200 * n); }).then(run);
        throw e;
      });
    }
    return run();
  };

  // plain-English reason for a failed request
  HK.why = function (e) {
    if (!e) return "Something went wrong.";
    if (e.kind === "offline") return "You appear to be offline.";
    if (e.kind === "timeout") return "The source took too long to answer.";
    if (e.kind === "http") return "The source returned an error (HTTP " + e.status + ").";
    if (e.kind === "parse") return "The source sent data this page couldn't read.";
    return "The source didn't respond, or your browser blocked the request.";
  };

  // state blocks. kind: loading | empty | error | stale | ok. opts: {title, body, action, compact}. Action buttons carry data-retry for the page to wire up.
  HK.state = function (kind, opts) {
    opts = opts || {};
    var role = kind === "error" ? ' role="alert"' : kind === "loading" ? ' role="status" aria-live="polite"' : "";
    return '<div class="state state-' + kind + (opts.compact ? " compact" : "") + '"' + role + '>' +
      '<div class="state-title">' + HK.esc(opts.title || "") + "</div>" +
      (opts.body ? '<div class="state-body">' + HK.esc(opts.body) + "</div>" : "") +
      (opts.action ? '<button class="btn btn-ghost btn-sm" type="button" data-retry>' + HK.esc(opts.action) + "</button>" : "") +
      "</div>";
  };
  HK.skeleton = function (lines, h) {
    var out = "";
    for (var i = 0; i < (lines || 3); i++) out += '<div class="skeleton skel-h' + (h || 2) + '" aria-hidden="true"></div>';
    return '<div class="skel-stack" role="status" aria-label="Loading">' + out + "</div>";
  };
  // one-shot delegated retry: HK.onRetry(container, fn)
  HK.onRetry = function (el, fn) {
    el.addEventListener("click", function (e) { if (e.target.closest("[data-retry]")) fn(); });
  };

  // times (Hong Kong time zone, whatever the device's zone)
  var tf = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false });
  HK.clock = function (t) { return tf.format(t instanceof Date ? t : new Date(t)); };
  HK.ago = function (t) {
    var s = Math.max(0, Math.round((Date.now() - +t) / 1000));
    if (s < 45) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    return h < 24 ? h + " h ago" : Math.round(h / 24) + " d ago";
  };

  // swap content with a brief fade (only when it changed)
  HK.setHTML = function (el, html) {
    if (!el || el.__html === html) return;
    el.__html = html;
    el.innerHTML = html;
    if (!(window.HKMotion && window.HKMotion.reduce)) { el.classList.remove("fade-swap"); void el.offsetWidth; el.classList.add("fade-swap"); }
  };

  // safe localStorage
  HK.store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
})();
