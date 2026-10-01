/* Section art, drawn in code. <canvas class="art" data-art="home|weather|hiking|arrivals|cams|trips|study">.
   Each scene is painted with plain shapes on an offscreen canvas, then re-painted as jittered dots (pointillism, after NTTCB's painted art).
   Paints when first visible, repaints on resize, and never animates. */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;

  function rngFor(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    var a = h >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function grad(ctx, x0, y0, x1, y1, stops) { var g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); return g; }
  function glow(ctx, x, y, r, color, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  // a row of towers with lit windows
  function towers(ctx, w, h, rnd, baseY, color, hMin, hMax, opts) {
    opts = opts || {};
    var k = Math.max(0.6, w / 1200), x = -20;
    while (x < w + 20) {
      var tw = (24 + rnd() * 50) * k, th = (hMin + rnd() * (hMax - hMin)) * h;
      ctx.fillStyle = color; ctx.fillRect(x, baseY - th, tw, th + 4);
      if (rnd() < 0.3) ctx.fillRect(x + tw * 0.35, baseY - th - 14 * k, tw * 0.3, 14 * k); // antenna block
      if (opts.lit) {
        var cw = 5 * k, ch = 7 * k;
        for (var yy = baseY - th + 8 * k; yy < baseY - 6; yy += 13 * k)
          for (var xx = x + 5 * k; xx < x + tw - cw; xx += 10 * k)
            if (rnd() < opts.lit) { ctx.fillStyle = opts.litColors[(rnd() * opts.litColors.length) | 0]; ctx.fillRect(xx, yy, cw, ch); }
      }
      x += tw + rnd() * 6 * k;
    }
  }
  function ridge(ctx, w, h, rnd, baseY, amp, color, rough) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h);
    var ph = rnd() * 6, y;
    for (var x = 0; x <= w + 8; x += 8) {
      y = baseY - amp * (0.5 + 0.28 * Math.sin(x / w * 5 + ph) + 0.16 * Math.sin(x / w * 11 + ph * 2) + (rough || 0.06) * (rnd() - 0.5));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  }
  function water(ctx, w, h, y0, top, bot) { ctx.fillStyle = grad(ctx, 0, y0, 0, h, [[0, top], [1, bot]]); ctx.fillRect(0, y0, w, h - y0); }
  function streaks(ctx, rnd, x0, x1, y0, y1, colors, n, len) {
    for (var i = 0; i < n; i++) {
      ctx.globalAlpha = 0.25 + rnd() * 0.5; ctx.fillStyle = colors[(rnd() * colors.length) | 0];
      var l = len * (0.3 + rnd()), x = x0 + rnd() * (x1 - x0);
      ctx.fillRect(x, y0 + rnd() * (y1 - y0), l, 2 + rnd() * 2);
    }
    ctx.globalAlpha = 1;
  }
  function junk(ctx, x, y, s, hull, sail) {
    ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(x - 60 * s, y); ctx.lineTo(x + 70 * s, y); ctx.lineTo(x + 50 * s, y + 16 * s); ctx.lineTo(x - 44 * s, y + 16 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#2a1a14"; ctx.fillRect(x - 3 * s, y - 100 * s, 5 * s, 100 * s);
    [[-42, -8, 88, 0.62], [12, -18, 86, 0.5]].forEach(function (p, i) {
      ctx.fillStyle = sail[i % sail.length]; ctx.beginPath();
      ctx.moveTo(x + p[0] * s, y - 6 * s); ctx.lineTo(x + (p[0] + 36) * s, y - 96 * s); ctx.lineTo(x + (p[0] + 40) * s, y - 8 * s); ctx.closePath(); ctx.fill();
    });
  }

  var SCENES = {
    home: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h * 0.72, [[0, "#06121c"], [0.55, "#123247"], [1, "#e4643f"]]); c.fillRect(0, 0, w, h);
      glow(c, w * 0.78, h * 0.2, h * 0.16, "#fff3d6", 1); c.fillStyle = "#fff6e0"; c.beginPath(); c.arc(w * 0.78, h * 0.2, h * 0.045, 0, 7); c.fill();
      towers(c, w, h, r, h * 0.7, "#0b2231", 0.12, 0.34, { lit: 0.35, litColors: ["#ffd98a", "#ffb35c", "#9fe3ff"] });
      towers(c, w, h, r, h * 0.72, "#08161f", 0.07, 0.24, { lit: 0.5, litColors: ["#ffd98a", "#ff5a4e", "#4fe0d0"] });
      // neon signs
      var neon = ["#ff5a4e", "#4fe0d0", "#ffd166", "#ff7bd0"];
      for (var i = 0; i < 9; i++) { var sx = w * (0.06 + r() * 0.88), sy = h * (0.42 + r() * 0.2), sh = h * (0.06 + r() * 0.08); c.fillStyle = neon[i % 4]; glow(c, sx, sy + sh / 2, sh * 1.2, neon[i % 4], 0.35); c.fillRect(sx, sy, 7 + r() * 5, sh); }
      water(c, w, h, h * 0.72, "#0f3550", "#04101a");
      streaks(c, r, 0, w, h * 0.73, h, ["#ffd98a", "#ff5a4e", "#4fe0d0", "#9fe3ff"], 90, w * 0.06);
      junk(c, w * 0.3, h * 0.83, Math.max(0.5, w / 1400), "#1a0d0a", ["#c8402f", "#a8321f"]);
    },
    weather: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h, [[0, "#2f6fa8"], [0.6, "#8cc8ea"], [1, "#e8f3f6"]]); c.fillRect(0, 0, w, h);
      glow(c, w * 0.7, h * 0.28, h * 0.5, "#fff2c2", 0.9); c.fillStyle = "#fff8dc"; c.beginPath(); c.arc(w * 0.7, h * 0.28, h * 0.075, 0, 7); c.fill();
      for (var i = 0; i < 16; i++) { var cx = r() * w, cy = h * (0.12 + r() * 0.4), cr = h * (0.05 + r() * 0.08); c.fillStyle = "rgba(255,255,255," + (0.35 + r() * 0.4) + ")"; for (var j = 0; j < 5; j++) { c.beginPath(); c.arc(cx + j * cr * 0.8, cy + Math.sin(j) * cr * 0.25, cr * (0.7 + r() * 0.5), 0, 7); c.fill(); } }
      ridge(c, w, h, r, h * 0.78, h * 0.4, "#5f8fa6", 0.05);
      ridge(c, w, h, r, h * 0.86, h * 0.34, "#3d6f6a", 0.07);
      towers(c, w, h, r, h * 0.92, "#25404c", 0.08, 0.2, { lit: 0.25, litColors: ["#ffe6a8", "#e9f7ff"] });
      c.fillStyle = "#1a3038"; c.fillRect(0, h * 0.92, w, h * 0.08);
    },
    hiking: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h, [[0, "#12303a"], [0.5, "#6a8f7d"], [0.85, "#f0b98a"], [1, "#f6d5a8"]]); c.fillRect(0, 0, w, h);
      glow(c, w * 0.32, h * 0.62, h * 0.55, "#ffe1a8", 0.85);
      ridge(c, w, h, r, h * 0.55, h * 0.42, "#7fa094", 0.05);
      ridge(c, w, h, r, h * 0.66, h * 0.4, "#4f7a6b", 0.08);
      ridge(c, w, h, r, h * 0.78, h * 0.36, "#2e5a4c", 0.1);
      ridge(c, w, h, r, h * 0.92, h * 0.3, "#163a30", 0.12);
      // trail
      c.strokeStyle = "rgba(255,236,190,.8)"; c.lineWidth = Math.max(2, h * 0.008); c.lineCap = "round"; c.beginPath(); c.moveTo(w * 0.2, h);
      c.bezierCurveTo(w * 0.35, h * 0.86, w * 0.6, h * 0.9, w * 0.55, h * 0.78); c.bezierCurveTo(w * 0.5, h * 0.7, w * 0.7, h * 0.7, w * 0.72, h * 0.6); c.stroke();
      for (var i = 0; i < 60; i++) { var px = r() * w, py = h * (0.82 + r() * 0.18), ph = h * (0.03 + r() * 0.05); c.fillStyle = "#0d2a22"; c.beginPath(); c.moveTo(px, py - ph); c.lineTo(px - ph * 0.3, py); c.lineTo(px + ph * 0.3, py); c.fill(); }
    },
    arrivals: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h * 0.7, [[0, "#0f1c26"], [0.7, "#5b4a4a"], [1, "#e8a35a"]]); c.fillRect(0, 0, w, h);
      towers(c, w, h, r, h * 0.7, "#1a232b", 0.25, 0.55, { lit: 0.4, litColors: ["#ffd98a", "#ffbf5e", "#ffe9b8"] });
      c.fillStyle = "#23272b"; c.fillRect(0, h * 0.7, w, h * 0.3);
      c.fillStyle = "rgba(255,240,190,.5)"; for (var i = 0; i < 12; i++) c.fillRect(i * w / 11, h * 0.86, w / 28, 4);
      var bw = w * 0.42, bh = h * 0.32, bx = w * 0.06, by = h * 0.7 - bh * 0.12;
      c.fillStyle = "#f2c230"; c.beginPath(); if (c.roundRect) c.roundRect(bx, by - bh, bw, bh, 12); else c.rect(bx, by - bh, bw, bh); c.fill();
      c.fillStyle = "#c8102e"; c.fillRect(bx, by - bh * 0.32, bw, bh * 0.07);
      c.fillStyle = "#17222b"; for (var k = 0; k < 6; k++) { c.fillRect(bx + 14 + k * (bw - 28) / 6, by - bh * 0.88, (bw - 28) / 6 - 8, bh * 0.22); c.fillRect(bx + 14 + k * (bw - 28) / 6, by - bh * 0.6, (bw - 28) / 6 - 8, bh * 0.22); }
      c.fillStyle = "#111"; [0.2, 0.75].forEach(function (f) { c.beginPath(); c.arc(bx + bw * f, by, bh * 0.11, 0, 7); c.fill(); });
      var gx = w * 0.62; c.fillStyle = "#3fb887"; c.beginPath(); if (c.roundRect) c.roundRect(gx, by - bh * 0.5, bw * 0.5, bh * 0.5, 10); else c.rect(gx, by - bh * 0.5, bw * 0.5, bh * 0.5); c.fill();
      c.fillStyle = "#17222b"; c.fillRect(gx + 10, by - bh * 0.42, bw * 0.5 - 20, bh * 0.16);
      c.fillStyle = "#111"; [0.22, 0.78].forEach(function (f) { c.beginPath(); c.arc(gx + bw * 0.5 * f, by, bh * 0.07, 0, 7); c.fill(); });
      glow(c, w * 0.9, h * 0.5, h * 0.3, "#ffe3a0", 0.7); c.fillStyle = "#2a2a2a"; c.fillRect(w * 0.9 - 2, h * 0.5, 4, h * 0.2);
    },
    cams: function (c, w, h, r) {
      c.fillStyle = "#07090c"; c.fillRect(0, 0, w, h);
      var cx = w * 0.5, cy = h * 0.5;
      for (var i = 9; i >= 0; i--) {
        var f = i / 9, rw = w * (0.08 + f * 0.36), rh = h * (0.1 + f * 0.46);
        c.fillStyle = grad(c, 0, cy - rh, 0, cy + rh, [[0, "hsl(" + (28 + f * 6) + ",95%," + (20 + (1 - f) * 40) + "%)"], [1, "hsl(24,80%," + (8 + (1 - f) * 18) + "%)"]]);
        c.beginPath(); c.ellipse(cx, cy, rw, rh, 0, 0, 7); c.fill();
      }
      glow(c, cx, cy, h * 0.4, "#ffc46b", 0.9);
      // road + light trails
      c.fillStyle = "#101418"; c.beginPath(); c.moveTo(cx - w * 0.03, cy + h * 0.06); c.lineTo(cx + w * 0.03, cy + h * 0.06); c.lineTo(w, h); c.lineTo(0, h); c.fill();
      for (var t = 0; t < 34; t++) {
        var side = t % 2 ? 1 : -1, off = r() * 0.42, col = side > 0 ? "#fff1cf" : "#ff4b3e";
        c.strokeStyle = col; c.globalAlpha = 0.35 + r() * 0.5; c.lineWidth = 1 + r() * 3;
        c.beginPath(); c.moveTo(cx + side * w * 0.01 * (1 + off * 2), cy + h * 0.07); c.lineTo(cx + side * w * (0.06 + off), h); c.stroke();
      }
      c.globalAlpha = 1;
    },
    trips: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h * 0.7, [[0, "#3a5f9a"], [0.55, "#f0a07a"], [1, "#ffd9a0"]]); c.fillRect(0, 0, w, h);
      glow(c, w * 0.24, h * 0.56, h * 0.5, "#fff0c0", 0.9); c.fillStyle = "#fff6d8"; c.beginPath(); c.arc(w * 0.24, h * 0.5, h * 0.07, 0, 7); c.fill();
      ridge(c, w, h, r, h * 0.62, h * 0.45, "#5a5f8a", 0.04);
      towers(c, w, h, r, h * 0.72, "#3d4670", 0.08, 0.26, { lit: 0.2, litColors: ["#ffe6a8"] });
      towers(c, w, h, r, h * 0.74, "#262d4c", 0.04, 0.14, { lit: 0.25, litColors: ["#ffd98a", "#ff7a5e"] });
      water(c, w, h, h * 0.74, "#3f6a9a", "#0f2340");
      streaks(c, r, w * 0.1, w * 0.4, h * 0.75, h, ["#fff0c0", "#ffd28a"], 60, w * 0.05);
      var s = Math.max(0.5, w / 1300);
      junk(c, w * 0.66, h * 0.86, s * 1.2, "#2a120e", ["#d64a34", "#b23a26"]);
      c.fillStyle = "#f4f1e6"; c.fillRect(w * 0.38, h * 0.8, w * 0.1, h * 0.03); c.fillStyle = "#3fb887"; c.fillRect(w * 0.38, h * 0.83, w * 0.1, h * 0.02);
      c.fillStyle = "#f4f1e6"; c.fillRect(w * 0.4, h * 0.77, w * 0.06, h * 0.03);
    },
    savings: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h, [[0, "#06161a"], [1, "#0d2f2c"]]); c.fillRect(0, 0, w, h);
      glow(c, w * 0.78, h * 0.28, h * 0.6, "#e0b25a", 0.5);
      // stacked coins growing to the right, each column taller than the last
      var n = 14, bw = w / (n + 2), i, j;
      for (i = 0; i < n; i++) {
        var cols = 1 + Math.floor(Math.pow(i / (n - 1), 2.2) * 13), x = bw * (i + 1.2), rad = bw * 0.42;
        for (j = 0; j < cols; j++) {
          var y = h * 0.9 - j * rad * 0.62;
          c.fillStyle = j === cols - 1 ? "#f0c878" : (j % 2 ? "#b98a3a" : "#d6a54a");
          c.beginPath(); c.ellipse(x, y, rad, rad * 0.38, 0, 0, 7); c.fill();
          c.fillStyle = "rgba(60,36,8,.45)"; c.beginPath(); c.ellipse(x, y + rad * 0.14, rad, rad * 0.38, 0, 0, Math.PI); c.fill();
        }
      }
      // the exponential curve over the top
      c.strokeStyle = "#5cb89f"; c.lineWidth = Math.max(3, h * 0.012); c.lineCap = "round"; c.beginPath();
      for (i = 0; i <= 60; i++) { var t = i / 60, px = bw * 0.9 + t * (w - bw * 2), py = h * 0.86 - Math.pow(t, 2.2) * h * 0.68; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
      c.stroke();
    },
    study: function (c, w, h, r) {
      c.fillStyle = grad(c, 0, 0, 0, h, [[0, "#1a120b"], [1, "#2c1c10"]]); c.fillRect(0, 0, w, h);
      var cols = ["#8a5a2f", "#b7833f", "#5f3d22", "#c9a26a", "#a34a34", "#3f5f5a", "#d8b27a", "#6b4a3a"];
      for (var row = 0; row < 4; row++) {
        var y = h * (0.06 + row * 0.24), x = 0, bh0 = h * 0.19;
        while (x < w) { var bw = (10 + r() * 26) * Math.max(0.7, w / 1300), bh = bh0 * (0.78 + r() * 0.22); c.fillStyle = cols[(r() * cols.length) | 0]; c.fillRect(x, y + (bh0 - bh), bw - 1, bh); x += bw; }
        c.fillStyle = "#120b06"; c.fillRect(0, y + bh0, w, h * 0.012);
      }
      glow(c, w * 0.7, h * 0.5, h * 0.55, "#ff5a4e", 0.6); glow(c, w * 0.18, h * 0.85, h * 0.4, "#ffc46b", 0.6);
      c.save(); c.textAlign = "center"; c.textBaseline = "middle"; var fs = h * 0.6;
      c.font = "400 " + fs + 'px "LXGW WenKai TC","Kaiti TC","STKaiti",serif'; c.shadowColor = "#ff5a4e"; c.shadowBlur = fs * 0.2; c.fillStyle = "#ffd0c8"; c.fillText("學", w * 0.7, h * 0.5);
      c.shadowBlur = 0; c.strokeStyle = "#ff5a4e"; c.lineWidth = fs * 0.02; c.strokeText("學", w * 0.7, h * 0.5); c.restore();
    }
  };

  function paint(cv) {
    var name = cv.getAttribute("data-art"), scene = SCENES[name] || SCENES.home;
    var w = Math.max(1, Math.round(cv.clientWidth)), h = Math.max(1, Math.round(cv.clientHeight));
    if (w < 4 || h < 4) return;
    var key = w + "x" + h; if (cv.__key === key) return; cv.__key = key;
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var off = document.createElement("canvas"); off.width = w; off.height = h;
    var oc = off.getContext("2d", { willReadFrequently: true });
    scene(oc, w, h, rngFor(name));
    var px = oc.getImageData(0, 0, w, h).data;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.5; ctx.drawImage(off, 0, 0); ctx.globalAlpha = 1;
    var rnd = rngFor(name + "dots"), sp = Math.min(9, Math.max(4.5, w / 170));
    for (var y = sp / 2; y < h; y += sp) for (var x = sp / 2; x < w; x += sp) {
      var jx = x + (rnd() - 0.5) * sp * 0.7, jy = y + (rnd() - 0.5) * sp * 0.7;
      var ix = Math.min(w - 1, Math.max(0, jx | 0)), iy = Math.min(h - 1, Math.max(0, jy | 0)), o = (iy * w + ix) * 4;
      var k = 0.9 + rnd() * 0.3, sh = (rnd() - 0.5) * 26;
      ctx.fillStyle = "rgb(" + Math.min(255, px[o] * k + sh) + "," + Math.min(255, px[o + 1] * k + sh * 0.6) + "," + Math.min(255, px[o + 2] * k - sh * 0.4) + ")";
      ctx.beginPath(); ctx.arc(jx, jy, sp * (0.5 + rnd() * 0.22), 0, 6.2832); ctx.fill();
    }
    cv.classList.add("is-painted");
  }

  var canvases = Array.prototype.slice.call(document.querySelectorAll("canvas[data-art]"));
  function ready() { return document.fonts && document.fonts.load ? document.fonts.load('400 40px "LXGW WenKai TC"', "學").catch(function () {}) : Promise.resolve(); }
  ready().then(function () {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { paint(e.target); e.target.__vis = true; } else e.target.__vis = false; }); }, { rootMargin: "200px" });
      canvases.forEach(function (cv) { io.observe(cv); });
    } else canvases.forEach(paint);
    var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { canvases.forEach(function (cv) { if (cv.__vis || !("IntersectionObserver" in window)) paint(cv); else cv.__key = ""; }); }, 160); });
  });
  window.HKArt = { paint: paint, refresh: function (root) { (root || document).querySelectorAll("canvas[data-art]").forEach(function (cv) { if (canvases.indexOf(cv) < 0) { canvases.push(cv); paint(cv); } }); } };
})();
