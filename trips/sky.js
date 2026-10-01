/* Animated harbour sky: page scroll moves the day from dawn to night. Classic script; exposes const sky. */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const sky = (() => {
  const cv = document.getElementById("sky");
  const ctx = cv.getContext("2d");
  let W = 0, H = 0, DPR = 1, hz = 0;
  let towers = [], stars = [], shimmer = [], streaks = [], neon = [], ridgeBack = [], ridgeFront = [];
  let winLayer = null;
  let p = 0, target = 0, raf = 0, start = performance.now(), lastT = 0;

  const KF = [
    { p: 0.00, top: "#3e5c9a", mid: "#e39ba3", hor: "#ffd3a1" },
    { p: 0.26, top: "#2d7dcf", mid: "#7fbde9", hor: "#d7ecf8" },
    { p: 0.48, top: "#3a6db6", mid: "#a2badf", hor: "#f5d6ae" },
    { p: 0.64, top: "#33276a", mid: "#bf4f8a", hor: "#ff9d58" },
    { p: 0.80, top: "#121a44", mid: "#2e3d86", hor: "#6b5aa5" },
    { p: 1.00, top: "#040820", mid: "#0b1640", hor: "#1b2760" }
  ];

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  KF.forEach((k) => { k.T = hex(k.top); k.M = hex(k.mid); k.R = hex(k.hor); });
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function palette(p) {
    let i = 0;
    while (i < KF.length - 2 && p > KF[i + 1].p) i++;
    const a = KF[i], b = KF[i + 1];
    const t = smooth(0, 1, (p - a.p) / (b.p - a.p));
    return { top: mix(a.T, b.T, t), mid: mix(a.M, b.M, t), hor: mix(a.R, b.R, t) };
  }

  function seeded(seed) {
    return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  }

  function build() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    hz = Math.round(H * 0.66);
    const r = seeded(20261013);

    ridgeBack = []; ridgeFront = [];
    for (let x = 0; x <= W + 6; x += 6) {
      const u = x / W;
      ridgeBack.push([x, hz - H * (0.065 + 0.1 * Math.exp(-(((u - 0.3) / 0.16) ** 2)) + 0.055 * Math.exp(-(((u - 0.8) / 0.12) ** 2)) + 0.012 * Math.sin(u * 23) + 0.007 * Math.sin(u * 51 + 1))]);
      ridgeFront.push([x, hz - H * (0.03 + 0.045 * Math.exp(-(((u - 0.62) / 0.2) ** 2)) + 0.008 * Math.sin(u * 31 + 2) + 0.005 * Math.sin(u * 73))]);
    }

    towers = [];
    let x = -4;
    while (x < W + 10) {
      const w = 12 + r() * 24;
      const u = x / W;
      const cluster = 1 + 0.9 * Math.exp(-(((u - 0.45) / 0.17) ** 2));
      const h = H * (0.03 + Math.pow(r(), 2) * 0.13) * cluster;
      towers.push({ x, w, h, top: hz - h, spire: h > H * 0.14 && r() < 0.5 });
      x += w + 1 + r() * 3;
    }

    winLayer = document.createElement("canvas");
    winLayer.width = cv.width; winLayer.height = cv.height;
    const wc = winLayer.getContext("2d");
    wc.setTransform(DPR, 0, 0, DPR, 0, 0);
    const warm = ["#ffd98a", "#ffe9b8", "#fff4dc", "#cfe6ff"];
    streaks = []; neon = [];
    towers.forEach((t) => {
      const cols = Math.max(1, Math.floor((t.w - 4) / 5));
      const rows = Math.max(1, Math.floor((t.h - 6) / 6));
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < rows; k++) {
          if (r() < 0.32) {
            wc.fillStyle = warm[(r() * warm.length) | 0];
            wc.fillRect(t.x + 2.5 + c * 5, t.top + 4 + k * 6, 2.2, 2.6);
          }
        }
      }
      if (t.h > H * 0.08) {
        streaks.push({ x: t.x + t.w * (0.2 + r() * 0.6), len: H * (0.04 + r() * 0.1), w: 1.4 + r() * 2.2, c: hex(warm[(r() * 3) | 0]), ph: r() * 6.28 });
      }
      if (t.h > H * 0.1 && r() < 0.35) {
        neon.push({ x: t.x + 2, y: t.top + 6 + r() * t.h * 0.3, w: Math.max(4, t.w - 4), h: 3, c: r() < 0.5 ? [255, 79, 154] : [80, 235, 255], ph: r() * 6.28 });
      }
    });

    stars = [];
    const n = Math.round((W * hz) / 2600);
    for (let i = 0; i < n; i++) stars.push({ x: r() * W, y: r() * hz * 0.82, s: 0.5 + r() * 1.2, ph: r() * 6.28 });

    shimmer = [];
    for (let i = 0; i < 70; i++) shimmer.push({ x: r() * W, v: r(), ph: r() * 6.28 });
  }

  function draw(p, t) {
    const pal = palette(p);
    const night = smooth(0.58, 0.86, p);

    // Sky
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, rgb(pal.top));
    g.addColorStop(0.62, rgb(pal.mid));
    g.addColorStop(1, rgb(pal.hor));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hz + 1);

    // Stars
    if (night > 0.01) {
      stars.forEach((s) => {
        const a = night * (0.55 + 0.45 * Math.sin(t * 1.3 + s.ph));
        ctx.fillStyle = `rgba(255,255,245,${a})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      });
    }

    // Sun
    const s = p / 0.66;
    if (s < 1.08) {
      const arc = Math.sin(Math.PI * clamp(s, 0, 1));
      const sx = W * (0.12 + 0.76 * clamp(s, 0, 1.05));
      const sy = hz - H * 0.05 - arc * hz * 0.66 + (s > 1 ? (s - 1) * 400 : 0);
      const core = mix(mix([255, 206, 150], [255, 252, 232], arc), [255, 118, 64], smooth(0.78, 1, s));
      const rad = Math.max(W, H) * 0.35;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      glow.addColorStop(0, rgb(core, 0.55));
      glow.addColorStop(0.12, rgb(core, 0.22));
      glow.addColorStop(1, rgb(core, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, hz);
      ctx.fillStyle = rgb(core, 1);
      ctx.beginPath(); ctx.arc(sx, sy, Math.min(W, H) * 0.045, 0, Math.PI * 2); ctx.fill();
    }

    // Moon
    const m = smooth(0.7, 0.97, p);
    if (m > 0.01) {
      const mx = W * 0.8, my = hz - m * hz * 0.6 + (1 - m) * 30;
      const mr = Math.min(W, H) * 0.032;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 6);
      mg.addColorStop(0, `rgba(240,236,210,${0.28 * m})`);
      mg.addColorStop(1, "rgba(240,236,210,0)");
      ctx.fillStyle = mg;
      ctx.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
      ctx.fillStyle = `rgba(246,242,222,${m})`;
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    }

    // Ridges
    const ink = [22, 30, 54];
    const ridge = (pts, col) => {
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.moveTo(0, hz + 2);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(W, hz + 2); ctx.closePath(); ctx.fill();
    };
    ridge(ridgeBack, mix(pal.hor, ink, 0.34 + night * 0.3));
    ridge(ridgeFront, mix(pal.hor, ink, 0.55 + night * 0.3));

    // Towers
    const tc = mix(mix(pal.hor, [36, 50, 79], 0.72), [7, 11, 30], night);
    ctx.fillStyle = rgb(tc);
    towers.forEach((tw) => {
      ctx.fillRect(tw.x, tw.top, tw.w, tw.h + 2);
      if (tw.spire) ctx.fillRect(tw.x + tw.w / 2 - 0.75, tw.top - H * 0.025, 1.5, H * 0.025);
    });
    // Day-time facade sheen on the tallest towers
    if (night < 0.9) {
      ctx.fillStyle = rgb(pal.hor, 0.12 * (1 - night));
      towers.forEach((tw) => { if (tw.h > H * 0.1) ctx.fillRect(tw.x, tw.top, tw.w * 0.35, tw.h); });
    }

    // Windows and neon
    if (night > 0.01) {
      ctx.globalAlpha = night;
      ctx.drawImage(winLayer, 0, 0, W, H);
      ctx.globalAlpha = 1;
      neon.forEach((n) => {
        const a = night * (0.65 + 0.35 * Math.sin(t * 2.2 + n.ph));
        ctx.fillStyle = rgb(n.c, a);
        ctx.fillRect(n.x, n.y, n.w, n.h);
      });
    }

    // Water
    const wg = ctx.createLinearGradient(0, hz, 0, H);
    wg.addColorStop(0, rgb(mix(pal.hor, [29, 58, 95], 0.42)));
    wg.addColorStop(1, rgb(mix(pal.top, [3, 7, 22], 0.55)));
    ctx.fillStyle = wg;
    ctx.fillRect(0, hz, W, H - hz);

    // Sun path on the water
    if (s < 1) {
      const sx = W * (0.12 + 0.76 * clamp(s, 0, 1));
      const core = mix([255, 214, 160], [255, 246, 226], Math.sin(Math.PI * s));
      for (let y = hz + 3; y < H; y += 5) {
        const d = (y - hz) / (H - hz);
        const w = 10 + d * 70;
        const off = Math.sin(t * 1.4 + y * 0.09) * (4 + d * 12);
        ctx.fillStyle = rgb(core, 0.22 * (1 - d) * (1 - night));
        ctx.fillRect(sx - w / 2 + off, y, w, 1.6);
      }
    }

    // Night reflections of city lights
    if (night > 0.01) {
      streaks.forEach((st) => {
        for (let k = 0; k < st.len; k += 3) {
          const off = Math.sin(t * 1.6 + k * 0.22 + st.ph) * (1 + k * 0.05);
          ctx.fillStyle = rgb(st.c, night * 0.42 * (1 - k / st.len));
          ctx.fillRect(st.x + off, hz + 2 + k, st.w, 1.6);
        }
      });
    }

    // Shimmer
    const shimCol = mix([255, 255, 255], [150, 175, 255], night);
    shimmer.forEach((sh) => {
      const y = hz + Math.pow(sh.v, 1.6) * (H - hz);
      const len = 5 + sh.v * 34;
      const a = (0.1 + 0.14 * Math.sin(t * 0.9 + sh.ph)) * (0.9 - night * 0.4);
      if (a <= 0) return;
      ctx.fillStyle = rgb(shimCol, a);
      ctx.fillRect(sh.x + Math.sin(t * 0.7 + sh.ph) * 9, y, len, 1.2);
    });

    // Star Ferry crossing
    const sc = clamp(W / 420, 0.8, 1.3);
    const fx = ((t * 16) % (W + 160)) - 80;
    const fy = hz + (H - hz) * 0.24;
    const hull = mix([28, 107, 76], [10, 38, 30], night * 0.7);
    const deck = mix([242, 245, 240], [120, 128, 140], night * 0.6);
    ctx.fillStyle = `rgba(255,255,255,${0.35 - night * 0.15})`;
    for (let k = 1; k <= 3; k++) ctx.fillRect(fx - 26 * sc - k * 9 * sc, fy + 3 * sc + k * 1.2, 7 * sc, 1);
    ctx.fillStyle = rgb(hull);
    ctx.beginPath();
    ctx.moveTo(fx - 25 * sc, fy); ctx.lineTo(fx + 25 * sc, fy);
    ctx.lineTo(fx + 21 * sc, fy + 6 * sc); ctx.lineTo(fx - 21 * sc, fy + 6 * sc);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(deck);
    ctx.fillRect(fx - 21 * sc, fy - 5 * sc, 42 * sc, 5 * sc);
    ctx.fillStyle = rgb(hull);
    ctx.fillRect(fx - 15 * sc, fy - 9 * sc, 30 * sc, 4 * sc);
    ctx.fillRect(fx - 2 * sc, fy - 13 * sc, 4 * sc, 4 * sc);
    if (night > 0.05) {
      ctx.fillStyle = `rgba(255,217,138,${night})`;
      for (let k = -18; k <= 16; k += 5) ctx.fillRect(fx + k * sc, fy - 3.6 * sc, 2.4 * sc, 1.8 * sc);
    }

    // Haze at the horizon
    const hg = ctx.createLinearGradient(0, hz - 16, 0, hz + 14);
    hg.addColorStop(0, rgb(pal.hor, 0));
    hg.addColorStop(0.5, rgb(pal.hor, 0.35 * (1 - night * 0.6)));
    hg.addColorStop(1, rgb(pal.hor, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, hz - 16, W, 30);
  }

  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    target = max > 4 ? clamp(window.scrollY / max, 0, 1) : 0;
  }

  function frame(now) {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, t - lastT); lastT = t;
    p += (target - p) * (1 - Math.pow(0.001, dt));
    draw(p, t);
    raf = requestAnimationFrame(frame);
  }

  let idle = false;   // true in the detail view: one static frame, no animation loop (saves battery)
  function startLoop() {
    cancelAnimationFrame(raf);
    if (idle) { p = target; draw(p, 0); return; }
    if (reduceMotion.matches) { p = target; draw(p, 0); return; }
    raf = requestAnimationFrame(frame);
  }

  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); readScroll(); if (reduceMotion.matches) draw(target, 0); }, 120); });
  window.addEventListener("scroll", () => { readScroll(); if (reduceMotion.matches || idle) { p = target; draw(p, 0); } }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); else startLoop(); });
  // also stop when the canvas is scrolled away or covered (it is fixed, so this only matters for the site footer band)
  reduceMotion.addEventListener?.("change", startLoop);

  build();
  readScroll();
  p = target;
  startLoop();

  return {
    setIdle(v) { if (idle === v) return; idle = v; startLoop(); },
    syncScroll(jump) { readScroll(); if (reduceMotion.matches || jump === "now") { p = target; draw(p, 0); } }
  };
})();

