/* Study: lecture video catalogue (data in videos.js). Filter by kind, search titles, copy links. */
(function () {
  "use strict";
  var HK = window.HK, D = window.STUDY || STUDY;
  var KINDS = [["all", "All"], ["lecture", "Lectures"], ["skill", "Skills"], ["l2010", "Logic 2010"], ["example", "Examples"]];
  var kind = "all", q = "";
  var $ = function (s) { return document.querySelector(s); };
  var url = function (id) { return "https://www.youtube.com/watch?v=" + id; };
  var esc = HK.esc;

  var totals = { all: 0 };
  D.units.forEach(function (u) { u.groups.forEach(function (g) { totals[g.kind] = (totals[g.kind] || 0) + g.items.length; totals.all += g.items.length; }); });

  // intro row
  $("#intro").innerHTML = '<div><b>Before Unit 1: <a class="vid" href="' + url(D.intro.id) + '" target="_blank" rel="noopener noreferrer">' + esc(D.intro.title) + '</a></b><span>' + esc(D.intro.note) + '</span></div>' +
    '<button class="btn btn-ghost btn-sm cp" type="button" data-url="' + url(D.intro.id) + '" aria-label="Copy the link to ' + esc(D.intro.title) + '">Copy link</button>';

  // jump pills + kind chips
  $("#jump").innerHTML = '<span class="jump-l">Unit</span>' + D.units.map(function (u) { return '<a href="#u' + u.n + '">' + u.n + "</a>"; }).join("");
  $("#kinds").innerHTML = KINDS.map(function (k) {
    return '<button class="chip" type="button" data-k="' + k[0] + '" aria-pressed="' + (k[0] === kind) + '">' + k[1] + "<small>" + totals[k[0]] + "</small></button>";
  }).join("");

  function matches(item, unit) {
    if (!q) return true;
    var hay = (item.title + " " + item.label + " " + unit.topic + " unit " + unit.n).toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function render() {
    var shown = 0, html = "";
    D.units.forEach(function (u) {
      var groups = u.groups.filter(function (g) { return kind === "all" || g.kind === kind; }).map(function (g) {
        return { g: g, items: g.items.filter(function (it) { return matches(it, u); }) };
      }).filter(function (x) { return x.items.length; });
      if (!groups.length) return;
      var n = groups.reduce(function (a, x) { return a + x.items.length; }, 0);
      shown += n;
      html += '<section class="unit" id="u' + u.n + '" aria-labelledby="h' + u.n + '" data-reveal><header class="uh"><span class="un mono" aria-hidden="true">' + u.n + '</span><div><h2 id="h' + u.n + '">Unit ' + u.n + '</h2><p class="topic">' + esc(u.topic) + '</p></div><span class="uc">' + n + " video" + (n === 1 ? "" : "s") + "</span></header>" +
        groups.map(function (x) {
          return '<div class="grp k-' + x.g.kind + '"><h3>' + esc(x.g.title) + ' <span class="age">uploaded ' + esc(x.g.age) + '</span></h3><ol class="lines">' +
            x.items.map(function (it) {
              return '<li class="ln"><span class="no mono">' + esc(it.no) + '</span><span class="tt"><a class="vid" href="' + url(it.id) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + "</a>" +
                (it.note ? '<span class="note">' + esc(it.note) + (it.altId ? ' <a class="vid2" href="' + url(it.altId) + '" target="_blank" rel="noopener noreferrer">Open the second upload</a>' : "") + "</span>" : "") +
                '</span><span class="just">' + esc(it.label) + '</span><button class="btn btn-ghost btn-sm cp" type="button" data-url="' + url(it.id) + '" aria-label="Copy the link to ' + esc(it.label + ": " + it.title) + '">Copy link</button></li>';
            }).join("") + "</ol></div>";
        }).join("") + "</section>";
    });
    $("#count").textContent = shown === totals.all ? totals.all + " videos" : shown + " of " + totals.all + " videos";
    var box = $("#units");
    if (!shown) {
      box.innerHTML = HK.state("empty", { title: q ? "No videos match “" + q + "”" : "No videos in this filter", body: "Try a different word, or clear the filters to see all " + totals.all + " videos.", action: "Clear filters" });
    } else {
      box.innerHTML = html;
      if (window.HKMotion) window.HKMotion.observe(box);
    }
  }

  // filters
  $("#kinds").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-k]"); if (!b) return;
    kind = b.getAttribute("data-k");
    Array.prototype.forEach.call($("#kinds").children, function (c) { c.setAttribute("aria-pressed", String(c === b)); });
    render();
  });
  var t;
  $("#q").addEventListener("input", function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { q = v.trim().toLowerCase(); render(); }, 120); });
  HK.onRetry($("#units"), function () {
    kind = "all"; q = ""; $("#q").value = "";
    Array.prototype.forEach.call($("#kinds").children, function (c) { c.setAttribute("aria-pressed", String(c.getAttribute("data-k") === "all")); });
    render();
  });

  // copy link
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.className = "visually-hidden";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? ok() : no(); } catch (e) { no(e); } finally { ta.remove(); }
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".cp"); if (!b) return;
    var old = b.textContent;
    copy(b.getAttribute("data-url")).then(function () { b.textContent = "Copied"; b.classList.add("ok"); }, function () { b.textContent = "Copy failed"; b.classList.add("bad"); })
      .then(function () { setTimeout(function () { b.textContent = old; b.classList.remove("ok", "bad"); }, 1600); });
  });

  render();
})();
