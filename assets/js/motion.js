/* Scroll and reveal motion, ported from NTTCB. Attributes:
   data-split (headline words rise out of masks), data-reveal / data-stagger (fade up), data-scroll="pin|out" (sets --p 0..1),
   data-words (words brighten with --p), data-count (count-up), data-carousel, data-sphere (particle globe). */
(function () {
  var d = document;
  var reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var nav = $("[data-nav]");
  // custom properties from attributes (inline style="" is blocked by the site CSP)
  $$("[data-i]").forEach(function (el) { el.style.setProperty("--i", el.getAttribute("data-i")); });
  $$("[data-dir]").forEach(function (el) { el.style.setProperty("--dir", el.getAttribute("data-dir")); });

  $$("[data-split]").forEach(function (el) {
    var words = el.textContent.trim().split(/\s+/);
    el.setAttribute("aria-label", words.join(" "));
    el.textContent = "";
    words.forEach(function (w, i) {
      var o = d.createElement("span"), s = d.createElement("span");
      o.className = "w"; o.setAttribute("aria-hidden", "true");
      s.textContent = w; s.style.setProperty("--i", i);
      o.appendChild(s); el.appendChild(o); el.appendChild(d.createTextNode(" "));
    });
    el.classList.add("is-split");
  });

  $$("[data-words]").forEach(function (el) {
    var words = el.textContent.trim().split(/\s+/), n = words.length;
    el.textContent = "";
    words.forEach(function (w, i) {
      var s = d.createElement("span");
      s.className = "sw"; s.textContent = w; s.style.setProperty("--w", (0.12 + 0.68 * i / n).toFixed(3));
      el.appendChild(s); el.appendChild(d.createTextNode(" "));
    });
  });

  function indexStagger(p) {
    Array.prototype.forEach.call(p.children, function (c, i) { c.style.setProperty("--i", Math.min(i, 14)); });
  }
  $$("[data-stagger]").forEach(indexStagger);

  function count(el) {
    var to = +el.getAttribute("data-count"), t0 = null;
    function f(t) {
      t0 = t0 || t;
      var k = Math.min(1, (t - t0) / 1200);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(f);
    }
    requestAnimationFrame(f);
  }
  var io = null;
  if (!reduce && "IntersectionObserver" in window) {
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        $$("[data-count]", e.target).forEach(count);
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
  }
  // Pages that add revealable elements after load (lists built from data) call HK.observe(container).
  function observe(root) {
    $$("[data-reveal],[data-stagger],[data-split]", root).concat(root && root.matches && root.matches("[data-reveal],[data-stagger]") ? [root] : []).forEach(function (el) {
      if (el.hasAttribute("data-stagger")) indexStagger(el);
      if (io) { if (!el.classList.contains("is-in")) io.observe(el); } else el.classList.add("is-in");
    });
  }
  window.HKMotion = { observe: observe, reduce: reduce };
  observe(d);

  // scroll progress (--p, 0..1): "pin" = tall wrapper with sticky child, "out" = element scrolling away
  var scrollers = $$("[data-scroll]").map(function (el) { return { el: el, mode: el.getAttribute("data-scroll"), last: -1 }; });
  function update() {
    var navh = nav ? nav.offsetHeight : 0;
    scrollers.forEach(function (s) {
      var r = s.el.getBoundingClientRect(), p = 0;
      if (s.mode === "pin") {
        var range = r.height - s.el.firstElementChild.offsetHeight;
        p = range > 0 ? (navh - r.top) / range : 0;
      } else p = (navh - r.top) / r.height;
      p = Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000;
      if (p !== s.last) { s.last = p; s.el.style.setProperty("--p", p); }
    });
  }
  if (reduce) {
    scrollers.forEach(function (s) { s.el.style.setProperty("--p", s.el.getAttribute("data-static") || 0); });
  } else if (scrollers.length) {
    var ticking = false;
    var onScroll = function () { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; update(); }); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  $$("[data-carousel]").forEach(function (c) {
    var vp = $("[data-viewport]", c), track = $("[data-track]", c), cards = $$("[data-card]", c);
    var tabs = $$("[data-tab]", c), dots = $$("[data-dot]", c);
    var prev = $("[data-prev]", c), next = $("[data-next]", c), pause = $("[data-pause]", c);
    var i = 0, playing = !reduce, hover = false, visible = true, timer = null, sx = null, moved = false;
    function layout() {
      var k = cards[i];
      track.style.transform = "translate3d(" + (vp.clientWidth / 2 - (k.offsetLeft + k.offsetWidth / 2)) + "px,0,0)";
      cards.forEach(function (card, j) {
        card.classList.toggle("is-active", j === i);
        card.tabIndex = j === i ? 0 : -1;
        if (j === i) card.setAttribute("aria-current", "true"); else card.removeAttribute("aria-current");
      });
      tabs.forEach(function (t, j) { t.setAttribute("aria-current", j === i); });
      dots.forEach(function (t, j) { t.setAttribute("aria-current", j === i); });
    }
    function go(n) { i = (n + cards.length) % cards.length; layout(); }
    function sync() {
      clearInterval(timer); timer = null;
      if (pause) { pause.textContent = playing ? "❚❚" : "▶"; pause.setAttribute("aria-label", playing ? "Pause autoplay" : "Play autoplay"); }
      if (playing && !hover && visible) timer = setInterval(function () { if (!d.hidden) go(i + 1); }, 5000);
    }
    tabs.forEach(function (t, j) { t.addEventListener("click", function () { go(j); }); });
    dots.forEach(function (t, j) { t.addEventListener("click", function () { go(j); }); });
    if (prev) prev.addEventListener("click", function () { go(i - 1); });
    if (next) next.addEventListener("click", function () { go(i + 1); });
    if (pause) pause.addEventListener("click", function () { playing = !playing; sync(); });
    cards.forEach(function (card, j) {
      card.addEventListener("click", function (e) { if (moved || j !== i) { e.preventDefault(); if (!moved) go(j); } });
    });
    vp.addEventListener("pointerdown", function (e) { sx = e.clientX; moved = false; });
    vp.addEventListener("pointerup", function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 50) { moved = true; go(i + (dx < 0 ? 1 : -1)); setTimeout(function () { moved = false; }, 0); }
    });
    c.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft") go(i - 1); else if (e.key === "ArrowRight") go(i + 1); });
    c.addEventListener("mouseenter", function () { hover = true; sync(); });
    c.addEventListener("mouseleave", function () { hover = false; sync(); });
    c.addEventListener("focusin", function () { hover = true; sync(); });
    c.addEventListener("focusout", function () { hover = false; sync(); });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); }).observe(c);
    window.addEventListener("resize", layout);
    layout(); sync();
    requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add("is-ready"); }); });
  });

  $$("[data-sphere]").forEach(function (cv) {
    var ctx = cv.getContext("2d"), N = 1300, pts = [], ga = Math.PI * (3 - Math.sqrt(5));
    var w = 0, h = 0, ang = 0.6, tilt = 0.35, raf = 0, vis = false;
    var cols = (cv.getAttribute("data-colors") || "#fff").split(",");
    for (var k = 0; k < N; k++) {
      var y = 1 - (k / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * k;
      pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = w * 0.44, ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt);
      for (var j = 0; j < N; j++) {
        var p = pts[j], x = p[0] * ca + p[2] * sa, z = -p[0] * sa + p[2] * ca;
        var yy = p[1] * ct - z * st, zz = p[1] * st + z * ct, depth = (zz + 1) / 2;
        ctx.globalAlpha = 0.12 + 0.8 * depth;
        var s = 1.2 + depth * 1.8;
        ctx.fillStyle = cols[(j * 7 + 3) % cols.length];
        ctx.beginPath(); ctx.arc(cx + x * R, cy + yy * R, s / 2, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function loop() { ang += 0.003; draw(); raf = requestAnimationFrame(loop); }
    size(); draw();
    window.addEventListener("resize", function () { size(); draw(); });
    if (!reduce && "IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        var v = es[0].isIntersecting;
        if (v && !vis) raf = requestAnimationFrame(loop);
        if (!v) cancelAnimationFrame(raf);
        vis = v;
      }).observe(cv);
    }
  });
})();
