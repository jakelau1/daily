/* Site chrome: nav panel, offline banner, section-title morph between pages. */
(function () {
  var d = document, root = d.documentElement;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };

  var panel = $("[data-panel]"), toggles = $$("[data-menu]"), wide = window.matchMedia("(min-width:900px)"), opener = null;
  function isOpen() { return panel && panel.classList.contains("is-open"); }
  function setOpen(open) {
    if (!panel) return;
    panel.classList.toggle("is-open", open);
    if (open) panel.removeAttribute("inert"); else panel.setAttribute("inert", "");
    toggles.forEach(function (t) {
      t.setAttribute("aria-expanded", open);
      var l = $("[data-label]", t); if (l) l.textContent = open ? "Close" : "Menu";
    });
    root.style.overflow = open && !wide.matches ? "hidden" : "";
    if (open) { var a = $("a", panel); if (a) a.focus(); }
    else if (opener) { opener.focus(); }
  }
  if (panel) {
    $$("li", panel).forEach(function (li, i) { li.style.setProperty("--i", i); });
    panel.setAttribute("inert", "");
    toggles.forEach(function (t) { t.addEventListener("click", function () { opener = t; setOpen(!isOpen()); }); });
    wide.addEventListener("change", function () { if (isOpen()) setOpen(false); root.style.overflow = ""; });
    d.addEventListener("click", function (e) {
      if (isOpen() && !panel.contains(e.target) && !toggles.some(function (t) { return t.contains(e.target); })) setOpen(false);
    });
    d.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") return setOpen(false);
      if (e.key === "Tab" && !wide.matches) {
        var f = $$("a", panel).concat(toggles.filter(function (t) { return t.offsetParent; })), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // offline banner
  var bar = d.createElement("div");
  bar.className = "offline"; bar.setAttribute("role", "status");
  bar.textContent = "You're offline. Live data will resume when you reconnect.";
  d.body.appendChild(bar);
  function net() { bar.classList.toggle("is-on", navigator.onLine === false); }
  window.addEventListener("online", net); window.addEventListener("offline", net); net();

  // the title of a tapped section card morphs into the destination page's title (cross-document view transition)
  d.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-vt]");
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    var t = $("[data-vt-title]", a);
    if (t) t.style.viewTransitionName = "sect";
  });
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) $$("[data-vt-title]").forEach(function (t) { t.style.viewTransitionName = ""; });
  });
})();
