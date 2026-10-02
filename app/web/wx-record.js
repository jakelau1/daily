// The phone records its own weather readings (the website's recorder runs on GitHub's timer, which skipped most of its slots).
// wx.js calls window.NowRecord(source, data) after each successful read. Hourly temperatures at every station and hourly
// rain-gauge totals are kept in the same shape as weather/data/history.json (so the Weather page can use them later),
// in the app's database under "wx.history", for 14 days. A reading with the same time is never stored twice. Nothing is invented:
// when the phone was off or offline, those hours are simply missing, and the Weather page already says "N of 12 hours recorded".
(function () {
  'use strict';
  var KEY = 'wx.history', KEEP_MS = 14 * 24 * 3600e3;
  function load() {
    try { var h = JSON.parse(window.NowStorage.getItem(KEY) || 'null'); if (h && Array.isArray(h.temps) && Array.isArray(h.gauges)) return h; } catch (e) { /* start again */ }
    return { temps: [], gauges: [] };
  }
  function add(list, t, v) {
    if (!t || !isFinite(Date.parse(t)) || list.some(function (e) { return e.t === t; })) return false;
    list.push({ t: t, v: v });
    return true;
  }
  window.NowRecord = function (key, data) {
    if (!window.NowStorage || !data) return;
    var h = load(), changed = false, v = {};
    if (key === 'now') {
      var temp = data.temperature;
      (temp && temp.data || []).forEach(function (d) { if (typeof d.value === 'number') v[d.place] = d.value; });
      if (temp && Object.keys(v).length) changed = add(h.temps, temp.recordTime, v);
    } else if (key === 'gauges') {
      (data.hourlyRainfall || []).forEach(function (d) { v[d.automaticWeatherStation] = d.value; });
      if (Object.keys(v).length) changed = add(h.gauges, data.obsTime, v);
    }
    if (!changed) return;
    var cutoff = Date.now() - KEEP_MS;
    ['temps', 'gauges'].forEach(function (k) {
      h[k] = h[k].filter(function (e) { return Date.parse(e.t) >= cutoff; }).sort(function (a, b) { return Date.parse(a.t) - Date.parse(b.t); });
    });
    window.NowStorage.setItem(KEY, JSON.stringify(h));
  };
})();
