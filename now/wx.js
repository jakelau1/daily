// Weather for the "now" display, from the same sources and the same "Happy Valley" setting as the Weather page:
//   warnings            Observatory warning summary (live)            -> typhoon / rainstorm takeover, heat warning
//   current readings    Observatory hourly readings (live)            -> Happy Valley temperature, Wan Chai rainfall
//   sunset              Observatory sunrise/sunset table (live)       -> "ends after sunset"
//   rain nowcast        weather relay /nowcast, else ../weather/data/nowcast.json -> rain in the next 2 hours at Happy Valley
//   hourly forecast     weather relay /ocf,     else ../weather/data/ocf.json     -> rain and temperature by hour
//   air quality         weather relay /aqhi,    else ../weather/data/aqhi.json    -> Eastern station and the forecast
// The nowcast, forecast and air-quality servers don't let other web pages read them (checked: no CORS permission).
// The weather relay (relay/worker.js, on Cloudflare; its address is in <html data-relay>) fetches them when asked.
// If it can't be reached, the copies saved by the recorder (.github/workflows/record-weather.yml) are used; GitHub
// runs that recorder hours late, so each reading keeps its own time and is ignored or greyed out once it is old.
(function () {
  'use strict';
  var API = 'https://data.weather.gov.hk/weatherAPI/opendata/';
  var COPY = document.documentElement.getAttribute('data-copy') || '../weather/data/';   // the app serves these from another folder
  var RELAY = document.documentElement.getAttribute('data-relay') || '';
  // The app (window.NowDirect, app/web/direct-feeds.js) reads the servers itself; else the relay; each falls back to the recorder's copy.
  function relayed(name) {
    var direct = window.NowDirect && window.NowDirect[name];
    if (direct) return direct().catch(function () { return get(COPY + name + '.json'); });
    if (!RELAY) return get(COPY + name + '.json');
    return get(RELAY + '/' + name).catch(function () { return get(COPY + name + '.json'); });
  }
  var TEMP_PLACE = 'Happy Valley', RAIN_PLACE = 'Wan Chai', AIR_STATION = 'Eastern';
  var FORECAST_POINTS = ['HPV', 'HKP', 'HKO'];     // as the Weather page: first point that forecasts each thing
  var RAIN_ICONS = [53, 54, 62, 63, 64, 65];       // Observatory weather icons with showers or rain (as the Weather page)
  var HOT = 33;                                    // °C
  var POOR_AIR = 7;                                // AQHI: 7 and above is "High" health risk or worse
  var RAIN_MM = 0.5;                               // nowcast: this much in half an hour counts as rain
  var EVERY = { warn: 5, now: 10, nowcast: 5, ocf: 15, aqhi: 10, srs: 360 };                 // minutes between fetches
  // Minutes after a reading's own time before it counts as old. The sources update: nowcast every few minutes,
  // forecast about every 2 hours, air quality hourly, current readings hourly.
  var OLD_AFTER = { warn: 20, now: 90, nowcast: 45, ocf: 3 * 60, aqhi: 2 * 60, srs: 48 * 60 };

  var S = {};      // source -> { data, fetched (ms), time (ms of the reading itself), error }
  var opt;

  function get(url, type) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) {
        if (!r.ok) throw new Error('the server answered ' + r.status);
        return type === 'text' ? r.text() : r.json();
      })
      .finally(function () { clearTimeout(timer); });
  }
  function hkDate() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day };
  }
  var SOURCES = {
    warn: function () { return get(API + 'weather.php?dataType=warnsum&lang=en').then(function (j) { return { data: j || {}, time: Date.now() }; }); },
    now: function () {
      return get(API + 'weather.php?dataType=rhrread&lang=en').then(function (j) {
        return { data: j, time: Date.parse(j && j.temperature && j.temperature.recordTime) || Date.now() };
      });
    },
    srs: function () {
      var d = hkDate();
      return get(API + 'opendata.php?dataType=SRS&rformat=json&year=' + d.y + '&month=' + d.m).then(function (j) {
        return { data: j, time: Date.now() };
      });
    },
    nowcast: function () {
      return relayed('nowcast').then(function (j) { return { data: j, time: Date.parse(j && j.updated) }; });
    },
    ocf: function () {
      return relayed('ocf').then(function (j) {
        var times = FORECAST_POINTS.map(function (c) { var s = j.stations && j.stations[c]; return s ? compact(s.LastModified) : NaN; }).filter(isFinite);
        return { data: j, time: times.length ? Math.max.apply(null, times) : NaN };
      });
    },
    aqhi: function () {
      return relayed('aqhi').then(function (j) {
        var st = airStation(j);
        return { data: j, time: st ? st.time : NaN };
      });
    }
  };
  // "20261001133213" (Hong Kong time) -> ms
  function compact(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(s || ''));
    return m ? Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00+08:00') : NaN;
  }

  function refresh(key) {
    var s = S[key] || (S[key] = {});
    s.next = Date.now() + EVERY[key] * 60e3;
    return SOURCES[key]().then(function (r) {
      s.data = r.data; s.time = r.time; s.fetched = Date.now(); s.error = null;
    }, function (e) {
      s.error = e.name === 'AbortError' ? 'timed out' : (e.message || 'unreachable');
      s.next = Date.now() + Math.min(5, EVERY[key]) * 60e3;   // try again sooner
    }).then(function () { opt.onChange(key); });
  }
  function poll() {
    // options.needs(key), if given, says whether a source is wanted right now (the app skips the big rain file when no walk is near).
    Object.keys(SOURCES).forEach(function (k) { if (opt.needs && !opt.needs(k)) return; if (!S[k] || Date.now() >= S[k].next) refresh(k); });
  }
  // Is this reading too old to trust? (Also true when there has never been one.)
  function old(key) {
    var s = S[key];
    return !s || !s.data || !isFinite(s.time) || Date.now() - s.time > OLD_AFTER[key] * 60e3;
  }

  // ---------- reading the data ----------
  function airStation(j) {
    if (!j || !j.ind) return null;
    var items = new DOMParser().parseFromString(j.ind, 'application/xml').querySelectorAll('item');
    for (var i = 0; i < items.length; i++) {
      var title = (items[i].querySelector('title') || {}).textContent || '';
      if (title.trim() !== AIR_STATION) continue;
      var d = (items[i].querySelector('description') || {}).textContent || '';
      var m = d.match(/General Stations?:\s*(10\+|\d+)\s+(Low|Moderate|Very High|High|Serious)/i);
      var t = d.match(/(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2})\s*$/);
      if (!m) return null;
      return { value: m[1], level: parseInt(m[1], 10), risk: m[2], time: t ? Date.parse(t[2] + ' ' + t[1] + ', ' + t[3] + ' ' + t[4] + ':' + t[5] + ':00 GMT+0800') : NaN };
    }
    return null;
  }
  // Health-risk words -> rank, by the worst word mentioned ("Moderate to High" -> 3), as the Weather page does.
  function riskRank(text) {
    text = String(text).toLowerCase();
    return text.indexOf('serious') >= 0 ? 5 : text.indexOf('very high') >= 0 ? 4 : text.indexOf('high') >= 0 ? 3 :
      text.indexOf('moderate') >= 0 ? 2 : text.indexOf('low') >= 0 ? 1 : 0;
  }
  // The air-quality forecast for the half-day containing a Hong Kong time ("today p.m." etc.): risk word, or ''.
  function airForecast(dayOffset, min) {
    var j = S.aqhi && S.aqhi.data;
    if (!j || !j.range) return '';
    var items = new DOMParser().parseFromString(j.range, 'application/xml').querySelectorAll('item');
    for (var i = 0; i < items.length; i++) {
      if (!/forecast/i.test((items[i].querySelector('title') || {}).textContent || '')) continue;
      var text = new DOMParser().parseFromString((items[i].querySelector('description') || {}).textContent || '', 'text/html').body.textContent;
      var want = (dayOffset ? 'tomorrow' : 'today') + ' ' + (min < 720 ? 'a' : 'p');
      var re = /<([^>]+)>([^<]*)/g, m;
      while ((m = re.exec(text))) {
        if (m[1].toLowerCase().replace(/[.\s]+/g, ' ').indexOf(want) !== 0) continue;
        var g = m[2].match(/General Stations:\s*([A-Za-z ]+?)(?=Roadside|$)/i);
        return g ? g[1].trim() : '';
      }
    }
    return '';
  }
  // Hourly forecast values for today's hours [fromMin, toMin], from the first forecast point that has the field.
  function hours(field, fromMin, toMin) {
    var j = S.ocf && S.ocf.data, d = hkDate(), out = [];
    if (!j || !j.stations) return out;
    var day = d.y + pad(d.m) + pad(d.d);
    for (var i = 0; i < FORECAST_POINTS.length; i++) {
      var st = j.stations[FORECAST_POINTS[i]];
      var list = (st && st.HourlyWeatherForecast || []).filter(function (h) { return h[field] != null; });
      if (!list.length) continue;
      list.forEach(function (h) {
        var k = String(h.ForecastHour);
        var hm = +k.slice(8, 10) * 60;
        if (k.slice(0, 8) === day && hm >= fromMin && hm <= toMin) out.push({ min: hm, value: h[field] });
      });
      return out;
    }
    return out;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sunsetToday() {
    var j = S.srs && S.srs.data, d = hkDate();
    var key = d.y + '-' + pad(d.m) + '-' + pad(d.d);
    var row = j && (j.data || []).filter(function (r) { return r[0] === key; })[0];
    if (!row) return null;
    var i = (j.fields || []).indexOf('SET'), m = /^(\d{2}):(\d{2})$/.exec(row[i >= 0 ? i : 3] || '');
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function active(key) {
    var w = S.warn && S.warn.data && S.warn.data[key];
    return w && w.actionCode !== 'CANCEL' ? w : null;
  }
  function currentTemp() {
    var j = S.now && S.now.data;
    var r = j && j.temperature && (j.temperature.data || []).filter(function (x) { return x.place === TEMP_PLACE; })[0];
    return r && typeof r.value === 'number' ? r.value : null;
  }
  function rainingNow() {
    var j = S.now && S.now.data;
    if (!j || !j.rainfall || old('now')) return false;
    var r = (j.rainfall.data || []).filter(function (x) { return x.place === RAIN_PLACE; })[0];
    return !!(r && r.max > 0);
  }

  // ---------- what the display asks for ----------
  var DIRS = { NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west' };
  // Typhoon signal or rainstorm warning in force: [{ kind, title, issued (ms), level }] (rainstorm first if both).
  function takeover() {
    if (old('warn') && !(S.warn && S.warn.data)) return [];
    var out = [], rain = active('WRAIN'), tc = active('WTCSGNL');
    if (rain) {
      var c = { WRAINA: ['amber', 'Amber Rainstorm Warning'], WRAINR: ['red', 'Red Rainstorm Warning'], WRAINB: ['black', 'Black Rainstorm Warning'] }[rain.code];
      out.push({ kind: 'rain', level: c ? c[0] : 'amber', title: c ? c[1] : (rain.name || 'Rainstorm Warning'), issued: Date.parse(rain.issueTime) });
    }
    if (tc) {
      var m = String(tc.code).match(/^TC(\d+)([A-Z]*)$/);
      var title = m ? 'Typhoon Signal No. ' + m[1] + (DIRS[m[2]] ? ' (' + DIRS[m[2]] + ')' : '') : (tc.type || tc.name || 'Tropical Cyclone Warning Signal');
      out.push({ kind: 'tc', level: m && +m[1] >= 8 ? 'high' : 'low', title: title, issued: Date.parse(tc.issueTime) });
    }
    out.forEach(function (a) { a.checked = S.warn.fetched; a.old = old('warn'); });
    return out;
  }
  // Prompts for an outdoor item today: { walk: bool, move: bool, start, end } in minutes after midnight.
  function prompts(item) {
    var out = [];
    if (item.walk) {
      var nc = !old('nowcast') && S.nowcast.data.periods || [];
      // half-hour periods (each ends at p.end) that overlap the walk; only if the 2-hour nowcast reaches the walk
      var covers = nc.length && Date.parse(nc[nc.length - 1].end) >= opt.at(item.start);
      var wetNc = nc.filter(function (p) {
        var end = Date.parse(p.end), from = end - 30 * 60e3;
        return p.mm >= RAIN_MM && end > opt.at(item.start) && from < opt.at(item.end);
      });
      if (rainingNow()) out.push('Raining in ' + RAIN_PLACE + ' now');
      else if (covers) {
        if (wetNc.length) out.push('Rain expected from about ' + opt.fmtTime(opt.minOf(Math.max(Date.parse(wetNc[0].end) - 30 * 60e3, Date.now()))));
      } else {
        var wet = hours('ForecastWeather', Math.floor(item.start / 60) * 60 - 60, item.end).filter(function (h) { return RAIN_ICONS.indexOf(+h.value) >= 0; });
        if (wet.length && !old('ocf')) out.push('Showers forecast around ' + opt.fmtTime(wet[0].min));
      }
    }
    if (item.move) {
      if (active('WHOT')) out.push('Very Hot Weather Warning in force');
      else {
        var temps = old('ocf') ? [] : hours('ForecastTemperature', Math.floor(item.start / 60) * 60, item.end);
        var hot = temps.filter(function (h) { return h.value >= HOT; }).sort(function (a, b) { return b.value - a.value; })[0];
        var nowT = old('now') ? null : currentTemp();
        if (hot) out.push('Hot: ' + Math.round(hot.value) + '° forecast at ' + opt.fmtTime(hot.min));
        else if (nowT != null && nowT >= HOT) out.push('Hot: ' + Math.round(nowT) + '° now');
      }
      var air = old('aqhi') ? null : airStation(S.aqhi.data);
      if (air && air.level >= POOR_AIR) out.push('Air quality ' + air.value + ' (' + air.risk + ') at ' + AIR_STATION);
      else {
        var fc = airForecast(0, item.start);
        if (fc && riskRank(fc) >= 3) out.push('Air quality forecast: ' + fc);
      }
    }
    var set = sunsetToday();
    if ((item.walk || item.move) && set != null && item.end > set) out.push('Ends after sunset (' + opt.fmtTime(set) + ')');
    return out;
  }
  // Small status line: current temperature and air quality, each with its own age.
  function status() {
    var t = currentTemp(), air = S.aqhi && airStation(S.aqhi.data);
    return {
      temp: t == null ? '' : Math.round(t) + '°', tempOld: old('now'),
      air: air ? 'Air ' + air.value : '', airOld: old('aqhi'),
      problem: ['warn', 'now'].filter(function (k) { return S[k] && S[k].error; }).length ? 'Weather unavailable' : ''
    };
  }

  window.NowWx = {
    init: function (options) { opt = options; poll(); setInterval(poll, 60e3); },
    takeover: takeover,
    prompts: prompts,
    status: status,
    sunset: sunsetToday
  };
})();
