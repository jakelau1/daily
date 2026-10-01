/* Compound-interest calculator, ported from the standalone page. Changes: dark chart palette, site fonts, no inline styles. */
(function () {
  const $ = (id) => document.getElementById(id);
  const SANS = '"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif';
  const DEFAULTS = { currency: "HK$", principal: 0, monthly: 10000, raise: 3, rate: 6, years: 30, freq: "12", inflation: 2.5, timing: "end" };
  let timing = DEFAULTS.timing;
  let last = null;

  function num(id, fallback, min, max) {
    const v = parseFloat($(id).value);
    if (!isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  function readInputs() {
    return {
      currency: $("currency").value,
      principal: num("principal", 0, 0, 1e12),
      monthly: num("monthly", 0, 0, 1e10),
      raise: num("raise", 0, 0, 50) / 100,
      rate: num("rate", 0, -50, 50) / 100,
      years: Math.round(num("years", 1, 1, 70)),
      freq: parseInt($("freq").value, 10),
      inflation: num("inflation", 0, 0, 30) / 100,
      timing: timing
    };
  }

  function compute(p) {
    // Equivalent monthly growth rate for the chosen compounding frequency
    const m = Math.pow(1 + p.rate / p.freq, p.freq / 12) - 1;
    let bal = p.principal, putIn = p.principal;
    const rows = [];
    let crossoverYear = null;
    for (let y = 1; y <= p.years; y++) {
      const c = p.monthly * Math.pow(1 + p.raise, y - 1);
      const start = bal;
      let added = 0;
      for (let k = 0; k < 12; k++) {
        if (p.timing === "start") { bal += c; added += c; bal *= (1 + m); }
        else { bal *= (1 + m); bal += c; added += c; }
      }
      putIn += added;
      const growth = bal - start - added;
      const real = bal / Math.pow(1 + p.inflation, y);
      if (crossoverYear === null && growth > added && added > 0) crossoverYear = y;
      rows.push({ y, added, growth, putIn, bal, real });
    }
    const final = rows[rows.length - 1];
    return {
      rows, crossoverYear, final: final.bal, real: final.real,
      principal: p.principal, contributions: final.putIn - p.principal,
      growth: final.bal - final.putIn, monthlyRate: m
    };
  }

  function fmt(cur, v, compact) {
    const sign = v < 0 ? "−" : "";
    const a = Math.abs(v);
    if (compact) {
      if (a >= 1e9) return sign + cur + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
      if (a >= 1e6) return sign + cur + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
      if (a >= 1e3) return sign + cur + Math.round(a / 1e3) + "k";
    }
    return sign + cur + Math.round(a).toLocaleString("en-US");
  }


  // Shared chart renderer: used for the on-screen chart and the exported image
  function drawChart(ctx, x0, y0, w, h, res, p, colors, font) {
    const rows = res.rows;
    const n = rows.length;
    const maxV = Math.max(res.principal, ...rows.map(r => r.bal), 1);
    const minV = Math.min(0, ...rows.map(r => r.bal));
    ctx.font = `400 12px ${font}`;
    const ticks = niceTicks(minV, maxV, 5);
    const labelW = Math.max(...ticks.map(t => ctx.measureText(fmt(p.currency, t, true)).width));
    const padL = Math.ceil(labelW) + 16, padR = 16, padT = 12, padB = 34;
    const cw = w - padL - padR, chH = h - padT - padB;
    const X = (i) => x0 + padL + (i / n) * cw;             // i = 0..n (year index)
    const Y = (v) => y0 + padT + chH - ((v - minV) / (maxV - minV)) * chH;

    // gridlines + y labels
    ctx.fillStyle = colors.muted; ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ticks.forEach(t => {
      const yy = Math.round(Y(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0 + padL, yy); ctx.lineTo(x0 + w - padR, yy); ctx.stroke();
      ctx.fillText(fmt(p.currency, t, true), x0 + padL - 8, yy);
    });
    // x labels
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const step = n <= 10 ? 1 : n <= 20 ? 2 : n <= 40 ? 5 : 10;
    for (let i = 0; i <= n; i += step) ctx.fillText(String(i), X(i), y0 + padT + chH + 8);
    ctx.textAlign = "right";
    ctx.fillText("years", x0 + w - padR, y0 + padT + chH + 20);

    const putPts = [[X(0), Y(res.principal)]].concat(rows.map(r => [X(r.y), Y(r.putIn)]));
    const balPts = [[X(0), Y(res.principal)]].concat(rows.map(r => [X(r.y), Y(r.bal)]));
    const realPts = [[X(0), Y(res.principal)]].concat(rows.map(r => [X(r.y), Y(r.real)]));
    const base = Y(Math.max(0, minV));

    // contributions area
    ctx.beginPath(); ctx.moveTo(putPts[0][0], base);
    putPts.forEach(pt => ctx.lineTo(pt[0], pt[1]));
    ctx.lineTo(putPts[putPts.length - 1][0], base); ctx.closePath();
    ctx.fillStyle = colors.slateSoft; ctx.fill();
    // growth area (between put-in and balance)
    ctx.beginPath(); ctx.moveTo(balPts[0][0], balPts[0][1]);
    balPts.forEach(pt => ctx.lineTo(pt[0], pt[1]));
    for (let i = putPts.length - 1; i >= 0; i--) ctx.lineTo(putPts[i][0], putPts[i][1]);
    ctx.closePath(); ctx.fillStyle = colors.jadeSoft; ctx.fill();
    // balance line
    ctx.beginPath(); balPts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
    ctx.strokeStyle = colors.jade; ctx.lineWidth = 2.5; ctx.stroke();
    // today's money dashed line
    if (p.inflation > 0) {
      ctx.save(); ctx.setLineDash([5, 4]);
      ctx.beginPath(); realPts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.restore();
    }
    // crossover marker
    if (res.crossoverYear) {
      const cx = X(res.crossoverYear);
      ctx.save(); ctx.strokeStyle = colors.brass; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, y0 + padT); ctx.lineTo(cx, y0 + padT + chH); ctx.stroke(); ctx.restore();
      ctx.fillStyle = colors.brass; ctx.font = `600 12px ${font}`; ctx.textBaseline = "top";
      let label = `Year ${res.crossoverYear}: growth beats contributions`;
      let tw = ctx.measureText(label).width;
      const fitsRight = (t) => cx + 6 + t < x0 + w - padR;
      const fitsLeft = (t) => cx - 6 - t > x0 + padL;
      if (!fitsRight(tw) && !fitsLeft(tw)) { label = `Year ${res.crossoverYear}`; tw = ctx.measureText(label).width; }
      const left = fitsRight(tw);
      ctx.textAlign = left ? "left" : "right";
      ctx.fillText(label, left ? cx + 6 : cx - 6, y0 + padT + 2);
    }
    // inline legend
    ctx.font = `400 12px ${font}`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    let lx = x0 + padL + 8, ly = y0 + padT + 26;
    const items = [[colors.slateSoft, "Money put in", "box"], [colors.jadeSoft, "Growth", "box"], [colors.jade, "Balance", "line"]];
    if (p.inflation > 0) items.push([colors.ink, "Balance in today's money", "dash"]);
    items.forEach(([c, t, kind]) => {
      if (kind === "box") { ctx.fillStyle = c; ctx.fillRect(lx, ly - 5, 10, 10); }
      else { ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 2; if (kind === "dash") ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 12, ly); ctx.stroke(); ctx.restore(); }
      ctx.fillStyle = colors.muted; ctx.fillText(t, lx + 16, ly);
      ly += 18;
    });
  }

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const stepN = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    const step = stepN * mag;
    const ticks = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
    return ticks;
  }

  // The chart sits on dark glass, so it uses the site's dark palette. (The exported image below always uses a light one.)
  function colorsFromCSS() {
    return {
      ink: "#ffffff", muted: "rgba(255,255,255,.66)", line: "rgba(255,255,255,.16)", jade: "#5cb89f",
      jadeSoft: "rgba(92,184,159,.28)", slateSoft: "rgba(143,163,181,.42)", slate: "#8fa3b5",
      brass: "#e0b25a", panel: "#12212b", field: "#15262f"
    };
  }

  function renderScreenChart() {
    if (!last) return;
    const canvas = $("chart");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawChart(ctx, 0, 0, rect.width, rect.height, last.res, last.p, colorsFromCSS(), SANS);
  }

  function update() {
    const p = readInputs();
    document.querySelectorAll(".cur").forEach(el => el.textContent = p.currency);
    const res = compute(p);
    last = { p, res };
    const C = p.currency;

    $("finalBig").textContent = fmt(C, res.final);
    const infl = p.inflation > 0
      ? ` Adjusted for ${(p.inflation * 100).toFixed(1)}% yearly inflation, that's about <strong>${fmt(C, res.real)}</strong> in today's money.`
      : "";
    $("summary").innerHTML =
      `Your balance after <strong>${p.years} year${p.years > 1 ? "s" : ""}</strong>. ` +
      `You put in <strong>${fmt(C, res.principal + res.contributions)}</strong>, and growth added <strong>${fmt(C, res.growth)}</strong>.` + infl;

    const total = Math.max(res.final, 1);
    const pos = (v) => Math.max(0, v);
    $("barPrincipal").style.width = (pos(res.principal) / total * 100) + "%";
    $("barContrib").style.width = (pos(res.contributions) / total * 100) + "%";
    $("barGrowth").style.width = (pos(res.growth) / total * 100) + "%";
    $("lgP").textContent = fmt(C, res.principal);
    $("lgC").textContent = fmt(C, res.contributions);
    $("lgG").textContent = fmt(C, res.growth);

    const cross = $("crossover");
    if (res.crossoverYear) {
      const r = res.rows[res.crossoverYear - 1];
      cross.innerHTML = `In <strong>year ${res.crossoverYear}</strong>, your investments grow by more (${fmt(C, r.growth)}) than you add yourself (${fmt(C, r.added)}). From here on, your money does more of the work than your saving does.`;
    } else if (p.monthly <= 0) {
      cross.textContent = "Add a monthly contribution to see the year when growth overtakes what you put in.";
    } else {
      cross.textContent = `With these numbers, yearly growth doesn't overtake your yearly contributions within ${p.years} years. Try more years or a higher return to see when it would.`;
    }

    const tb = $("tbody");
    tb.innerHTML = res.rows.map(r =>
      `<tr${r.y === res.crossoverYear ? ' class="cross"' : ""}><td>${r.y}</td><td>${fmt(C, r.added)}</td><td>${fmt(C, r.growth)}</td><td>${fmt(C, r.putIn)}</td><td>${fmt(C, r.bal)}</td><td>${fmt(C, r.real)}</td></tr>`
    ).join("");

    renderScreenChart();
    $("status").textContent = "";
  }

  // ---------- Export as image ----------
  function wrapText(ctx, text, maxW) {
    const words = text.split(" "); const lines = []; let line = "";
    words.forEach(w => {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  async function saveImage() {
    if (!last) return;
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    const { p, res } = last;
    const C = p.currency;
    // Always export in the light palette so the image prints and shares well
    const colors = { ink: "#1b2b3a", muted: "#5c6b78", line: "#d5dde3", jade: "#2e7d6b", jadeSoft: "rgba(46,125,107,0.22)",
                     slateSoft: "rgba(143,163,181,0.45)", slate: "#8fa3b5", brass: "#a8781f", panel: "#ffffff", field: "#f6f8f9" };
    const sans = SANS, serif = SANS;
    const W = 1200, H = 1000, scale = 2, M = 56;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    ctx.fillStyle = "#eef2f4"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = colors.panel;
    roundRect(ctx, 24, 24, W - 48, H - 48, 18); ctx.fill();

    // Title
    ctx.fillStyle = colors.ink; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `600 34px ${serif}`;
    ctx.fillText("Compound interest calculation", M, M + 40);
    ctx.font = `400 15px ${sans}`; ctx.fillStyle = colors.muted;
    const d = new Date();
    ctx.fillText(`Saved ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, M, M + 66);

    // Inputs column
    const freqName = { 1: "yearly", 4: "quarterly", 12: "monthly", 365: "daily" }[p.freq];
    const inputs = [
      ["Starting amount", fmt(C, p.principal)],
      ["Monthly contribution", fmt(C, p.monthly)],
      ["Yearly increase in contribution", (p.raise * 100).toFixed(1) + "%"],
      ["Annual return", (p.rate * 100).toFixed(1) + "%"],
      ["Years", String(p.years)],
      ["Compounding", freqName.charAt(0).toUpperCase() + freqName.slice(1)],
      ["Contributions added at", p.timing === "start" ? "Start of month" : "End of month"],
      ["Inflation", (p.inflation * 100).toFixed(1) + "%"]
    ];
    let y = M + 120;
    ctx.font = `600 18px ${serif}`; ctx.fillStyle = colors.ink; ctx.fillText("Inputs", M, y);
    y += 14;
    inputs.forEach(([k, v]) => {
      y += 30;
      ctx.font = `400 15px ${sans}`; ctx.fillStyle = colors.muted; ctx.textAlign = "left"; ctx.fillText(k, M, y);
      ctx.font = `600 15px ${sans}`; ctx.fillStyle = colors.ink; ctx.textAlign = "right"; ctx.fillText(v, M + 340, y);
      ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + 11.5); ctx.lineTo(M + 340, y + 11.5); ctx.stroke();
    });

    // Results column
    const RX = M + 400;
    ctx.textAlign = "left";
    ctx.font = `400 16px ${sans}`; ctx.fillStyle = colors.muted;
    ctx.fillText(`Balance after ${p.years} year${p.years > 1 ? "s" : ""}`, RX, M + 128);
    ctx.font = `600 64px ${serif}`; ctx.fillStyle = colors.ink;
    ctx.fillText(fmt(C, res.final), RX, M + 194);

    const stats = [
      ["Total put in", fmt(C, res.principal + res.contributions), colors.slate],
      ["Growth", fmt(C, res.growth), colors.jade],
      ["In today's money", p.inflation > 0 ? fmt(C, res.real) : "n/a", colors.ink]
    ];
    let sx = RX;
    stats.forEach(([k, v, c]) => {
      ctx.fillStyle = c; ctx.fillRect(sx, M + 222, 4, 44);
      ctx.font = `400 14px ${sans}`; ctx.fillStyle = colors.muted; ctx.fillText(k, sx + 14, M + 238);
      ctx.font = `600 22px ${sans}`; ctx.fillStyle = colors.ink; ctx.fillText(v, sx + 14, M + 264);
      sx += 230;
    });

    // Crossover sentence
    ctx.font = `400 16px ${sans}`; ctx.fillStyle = colors.ink;
    let crossText;
    if (res.crossoverYear) {
      const r = res.rows[res.crossoverYear - 1];
      crossText = `In year ${res.crossoverYear}, growth (${fmt(C, r.growth)}) exceeds what you add that year (${fmt(C, r.added)}).`;
    } else {
      crossText = `Yearly growth does not overtake yearly contributions within ${p.years} years.`;
    }
    ctx.fillStyle = colors.brass; ctx.fillRect(RX, M + 294, 3, 48);
    ctx.fillStyle = colors.ink;
    wrapText(ctx, crossText, W - RX - M - 20).forEach((ln, i) => ctx.fillText(ln, RX + 14, M + 314 + i * 22));

    // Chart
    drawChart(ctx, M - 8, M + 420, W - 2 * M + 8, 430, res, p, colors, sans);

    // Footer
    ctx.font = `400 13px ${sans}`; ctx.fillStyle = colors.muted; ctx.textAlign = "left";
    ctx.fillText("Assumes a smooth average return every year. Real markets rise and fall. Taxes and fees are not included.", M, H - 50);

    const fileName = `compound-interest-${p.years}y-${(p.rate * 100).toFixed(1)}pct.png`;
    const dataUrl = canvas.toDataURL("image/png");
    try {
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      $("status").textContent = `Saved ${fileName}`;
    } catch (e) {
      $("status").textContent = "Your browser blocked the download. Use the preview to save the image.";
    }
    // Always show a preview as a fallback for browsers that block downloads
    $("imgPreview").src = dataUrl;
    if (typeof $("imgDialog").showModal === "function") $("imgDialog").showModal();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // ---------- Wiring ----------
  function setTiming(t) {
    timing = t;
    $("timingStart").setAttribute("aria-pressed", String(t === "start"));
    $("timingEnd").setAttribute("aria-pressed", String(t === "end"));
    update();
  }
  $("timingStart").addEventListener("click", () => setTiming("start"));
  $("timingEnd").addEventListener("click", () => setTiming("end"));
  ["currency", "principal", "monthly", "raise", "rate", "years", "freq", "inflation"].forEach(id => {
    $(id).addEventListener("input", update);
    $(id).addEventListener("change", update);
  });
  $("saveBtn").addEventListener("click", saveImage);
  $("closeDialog").addEventListener("click", () => $("imgDialog").close());
  $("resetBtn").addEventListener("click", () => {
    Object.entries(DEFAULTS).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
    setTiming(DEFAULTS.timing);
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderScreenChart, 100); });

  update();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderScreenChart);
})();
