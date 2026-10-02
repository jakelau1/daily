// The app reads the three feeds that block web pages (hourly forecast, air quality, rain nowcast) straight from the
// Observatory and the EPD, and hands wx.js the same shapes the website's relay returns (relay/worker.js). Inside the app
// fetch() goes through Android's own network code, so the "no permission header" block that stops web pages does not apply.
// The reading points come from the private config bundled with the schedule (data.json "feeds"), not from this file.
// Gentle on the servers: wx.js asks at its own slow pace; the 2.7 MB rain file is asked for only when its timestamp has changed
// and (see now.js) only while an outdoor walk is about to start or under way.
(function () {
  'use strict';
  var status = {};                    // feed -> { ok, at (ms), how } for the tests and any status page
  var lastNowcast = null;             // { modified, data }

  function points() {
    var p = window.NowFeedPoints;
    if (!p || !p.forecastPoints || !p.forecastPoints.length || !p.nowcastPoint) throw new Error('no reading points configured');
    return p;
  }
  function request(url, headers, method) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 30000);
    return fetch(url, { method: method || 'GET', signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: headers || {} })
      .finally(function () { clearTimeout(timer); });
  }
  function ok(r) { if (!r.ok) throw new Error(new URL(r.url || 'https://x').host + ' answered ' + r.status); return r; }
  function text(url) { return request(url).then(ok).then(function (r) { return r.text(); }); }
  function done(name, how, promise) {
    return promise.then(function (v) { status[name] = { ok: true, at: Date.now(), how: how }; return v; },
      function (e) { status[name] = { ok: false, at: Date.now(), error: String((e && e.message) || e) }; throw e; });
  }

  function ocf() {
    var stations = {};
    return done('ocf', 'direct', Promise.all(points().forecastPoints.map(function (code) {
      return text('https://maps.weather.gov.hk/ocf/dat/' + encodeURIComponent(code) + '.xml').then(function (t) {
        var j = JSON.parse(t.replace(/^﻿/, ''));
        stations[code] = {
          LastModified: j.LastModified, ModelTime: j.ModelTime,
          DailyForecast: (j.DailyForecast || []).slice(0, 3),
          HourlyWeatherForecast: (j.HourlyWeatherForecast || []).slice(0, 72)
        };
      });
    })).then(function () { return { stations: stations }; }));
  }

  function aqhi() {
    return done('aqhi', 'direct', Promise.all([
      text('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_Eng.xml'),
      text('https://www.aqhi.gov.hk/epd/ddata/html/out/aqhirss_Eng.xml')
    ]).then(function (r) { return { ind: r[0], range: r[1] }; }));
  }

  // The file covers the whole region (about 2.7 MB); only the four rows for one grid point are kept.
  // A tiny HEAD request first: the file is downloaded only if its "last modified" time differs from the copy kept.
  // (Not an "if modified since" request: the app's fetch cannot return a 304 "not changed" answer.)
  var URL_NOWCAST = 'https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv';
  function nowcast() {
    var point = points().nowcastPoint;
    return done('nowcast', 'direct', request(URL_NOWCAST, null, 'HEAD').then(ok).then(function (h) {
      var stamp = h.headers.get('last-modified');
      if (stamp && lastNowcast && lastNowcast.modified === stamp) { status.nowcastUnchanged = (status.nowcastUnchanged || 0) + 1; return lastNowcast.data; }
      return request(URL_NOWCAST).then(ok).then(function (r) {
        var modified = r.headers.get('last-modified') || stamp;
        return r.text().then(function (t) {
          var rows = [];
          for (var i = t.indexOf(point); i !== -1; i = t.indexOf(point, i + 1)) {
            var start = t.lastIndexOf('\n', i) + 1, end = t.indexOf('\n', i);
            rows.push(t.slice(start, end === -1 ? undefined : end).trim().split(','));
          }
          if (!rows.length) throw new Error('grid point not found in the nowcast');
          var iso = function (x) { return x.slice(0, 4) + '-' + x.slice(4, 6) + '-' + x.slice(6, 8) + 'T' + x.slice(8, 10) + ':' + x.slice(10, 12) + ':00+08:00'; };
          var data = {
            updated: iso(rows[0][0]), lat: +rows[0][2], lon: +rows[0][3],
            periods: rows.map(function (x) { return { end: iso(x[1]), mm: +x[4] }; }).sort(function (p, q) { return p.end < q.end ? -1 : p.end > q.end ? 1 : 0; })
          };
          lastNowcast = { modified: modified, data: data };
          return data;
        });
      });
    }));
  }

  window.NowDirect = { ocf: ocf, aqhi: aqhi, nowcast: nowcast, status: status };
})();
