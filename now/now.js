// The "now" display: clock, the current block, time left, its floor, and what's next ("Free until …" in gaps).
// unlock.js decrypts the schedule and calls NowApp.start(data); tools/extract-schedule.mjs describes the data.
// This file is published unencrypted, so it must never contain anything from the schedule itself.
(function () {
  'use strict';
  var TZ = 'Asia/Hong_Kong';            // always Hong Kong time, even if the phone's time zone is set wrongly
  var DAY = 1440, WEEK = 7 * DAY;       // minutes
  var STALE_AFTER = 150;                // seconds without an update before a number greys out (also in now.css)
  var SHIFT_EVERY = 3 * 60e3;           // burn-in: nudge the layout every 3 minutes
  var PING_EVERY = 2 * 60e3;            // connection check
  var RELOAD_AT = 4 * 60;               // daily reload at 4am Hong Kong time
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var HUES = [200, 150, 32, 280, 340, 95, 180, 250, 12, 55, 310, 125];

  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var el = {};
  var blocks = [], routines = [], cats = {}, night = { from: 23 * 60, to: 7 * 60 };
  var current = null;                   // the block on screen now (null between blocks)
  var shown = {}, lastMinute = null, lastTick = 0, loadedDay = null, offlineSince = null, wakeLock = null, shiftStep = 0, reloadTry = 0;

  // ---------- time ----------
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
  });
  function hkNow(date) {
    var p = {};
    parts.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    var day = SHORT.indexOf(p.weekday);
    var min = +p.hour * 60 + +p.minute;
    return { day: day, min: min, sec: +p.second, date: +p.day, month: +p.month - 1, year: +p.year, week: day * DAY + min + p.second / 60 };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 435 -> "7:15am", 480 -> "8am", 720 -> "noon", 0 or 1440 -> "midnight"
  function fmtTime(min) {
    min = ((Math.round(min) % DAY) + DAY) % DAY;
    if (min === 0) return 'midnight';
    if (min === 720) return 'noon';
    var h = Math.floor(min / 60), m = min % 60;
    return (h % 12 || 12) + (m ? ':' + pad(m) : '') + (h < 12 ? 'am' : 'pm');
  }
  // whole minutes -> "42 min", "1 hr 5 min", "3 hr"
  function fmtDur(min) {
    if (min < 1) return 'under a minute';
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' hr' + (m ? ' ' + m + ' min' : '');
  }
  // " tomorrow" or " on Saturday" when a week-minute is not today
  function dayWord(weekMin, today) {
    var d = ((Math.floor(weekMin / DAY) - today) % 7 + 7) % 7;
    return d === 0 ? '' : d === 1 ? ' tomorrow' : ' on ' + DAYS[Math.floor(weekMin / DAY) % 7];
  }

  // ---------- schedule ----------
  function load(data) {
    cats = data.cats || {};
    routines = data.routines || [];
    blocks = (data.blocks || []).map(function (b) {
      return { b: b, s: b.day * DAY + b.start, e: b.day * DAY + b.end };
    }).sort(function (x, y) { return x.s - y.s; });
    // When to dim comes with the data (worked out when the page is built); these defaults apply if it is missing.
    if (data.night && data.night.from != null) night.from = data.night.from;
    if (data.night && data.night.to != null) night.to = data.night.to;
  }
  // The block that starts at or after week-minute t, wrapping from Sunday night to Monday.
  function nextFrom(t) {
    for (var i = 0; i < blocks.length; i++) if (blocks[i].s >= t) return blocks[i];
    var f = blocks[0];
    return { b: f.b, s: f.s + WEEK, e: f.e + WEEK };
  }
  function prevEnd(t) {
    var best = null;
    for (var i = 0; i < blocks.length; i++) if (blocks[i].e <= t) best = blocks[i].e;
    if (best === null) best = blocks[blocks.length - 1].e - WEEK;
    return best;
  }
  // Inside a routine block: which step is it? Steps without an end run until the next step (or the block's end).
  function stepAt(cur, min) {
    var r = routines.filter(function (x) { return x.name === cur.b.label; })[0];
    if (!r) return null;
    for (var i = 0; i < r.steps.length; i++) {
      var st = r.steps[i], nx = r.steps[i + 1];
      var end = st.end != null ? st.end : nx ? nx.start : cur.b.end;
      // "or so" when the step ends at the next step's approximate start ("~10:45pm")
      if (st.start <= min && min < end) return { step: st, end: end, approxEnd: st.end == null && !!nx && !!nx.approx };
    }
    return null;
  }
  function floorOf(b) { return cats[b.cat] && cats[b.cat].floor; }
  // Today's choice for a block that gets one (see plan.js), or null.
  function pickOf(b) { return b.open && window.NowPlan ? window.NowPlan.pickFor(b.id) : null; }
  function nameOf(b) { var p = pickOf(b); return p ? b.label + ': ' + p.what : b.label; }
  function hueOf(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return HUES[h % HUES.length];
  }

  // ---------- weather prompts (wx.js) ----------
  var PROMPT_BEFORE = 60;   // minutes: weather prompts start an hour before an outdoor item
  // Today's weather-checked items: routine steps flagged walk and blocks flagged move, in minutes after midnight.
  function outdoorToday(t) {
    var items = [];
    blocks.forEach(function (x) {
      var b = x.b;
      if (b.day !== t.day) return;
      if (b.move) items.push({ move: true, start: b.start, end: b.end, label: nameOf(b) });
      routines.forEach(function (r) {
        if (r.name !== b.label) return;
        r.steps.forEach(function (st, i) {
          if (!st.walk) return;
          var nx = r.steps[i + 1];
          items.push({ walk: true, start: st.start, end: st.end != null ? st.end : nx ? nx.start : b.end, label: st.title });
        });
      });
    });
    return items.sort(function (a, b) { return a.start - b.start; });
  }
  // The weather prompt for the outdoor item that is on now or starts within the hour ('' if none).
  function promptText(t) {
    if (!window.NowWx) return '';
    var items = outdoorToday(t);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (t.min < it.start - PROMPT_BEFORE || t.min >= it.end) continue;
      var p = window.NowWx.prompts(it);
      if (p.length) return (t.min < it.start ? it.label + ' at ' + fmtTime(it.start) + ': ' : '') + p.join(' · ');
    }
    return '';
  }

  // ---------- leave-by countdown (travel saved in the picker, see plan.js) ----------
  var LEAVE_LEAD = 60;      // minutes: the countdown starts an hour before it's time to leave
  // The next block today that needs travel, once it's within an hour of leaving: { b, travel, leave } or null.
  function leaving(t) {
    if (!window.NowPlan) return null;
    var now = t.min + t.sec / 60;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i].b;
      if (b.day !== t.day || b.start <= now) continue;
      var travel = window.NowPlan.travelFor(b);
      if (!travel) continue;
      var leave = window.NowPlan.leaveBy(b, travel);
      return now >= leave - LEAVE_LEAD ? { b: b, travel: travel, leave: leave, now: now } : null;
    }
    return null;
  }
  // Arrival times are estimates from typical travel times, and always say so.
  function arrivalIfLeavingNow(L) {
    var at = Math.round(L.now + L.travel.min), late = at - L.b.start;   // nearest minute: it is an estimate
    return 'leaving now, you’d arrive about ' + fmtTime(at) + (late > 0 ? ', ' + fmtDur(late) + ' late' : '') + ' (estimate)';
  }

  // What the screen should say at a given moment.
  function model(t) {
    var w = t.week, cur = null;
    for (var i = 0; i < blocks.length; i++) if (blocks[i].s <= w && w < blocks[i].e) cur = blocks[i];
    var m = {};
    if (cur) {
      var nx = nextFrom(cur.e), step = stepAt(cur, t.min);
      m.cat = cur.b.cat;
      m.kicker = 'Now · until ' + fmtTime(cur.b.end);
      var pk = pickOf(cur.b);
      m.block = cur.b;
      m.label = pk ? pk.what : cur.b.label;
      m.sub = step ? step.step.title + ' · until ' + fmtTime(step.end) + (step.approxEnd ? ' or so' : '') :
        pk ? cur.b.label : cur.b.open ? 'Not picked yet · tap to choose' : cur.b.note;
      m.left = fmtDur(Math.ceil(cur.e - w)) + ' left';
      m.progress = (w - cur.s) / (cur.e - cur.s);
      var fl = (step && step.step.floor) || (pk && pk.floor) || floorOf(cur.b);
      m.floor = fl ? 'Floor: ' + fl : '';
      m.next = 'Next ' + fmtTime(nx.b.start) + dayWord(nx.s, t.day) + ' · ' + nameOf(nx.b) +
        (nx.s > cur.e ? ' · in ' + fmtDur(Math.ceil(nx.s - w)) : '');
    } else {
      var n = nextFrom(Math.ceil(w)), from = prevEnd(w), np = pickOf(n.b), nf = (np && np.floor) || floorOf(n.b);
      m.block = null;
      m.cat = 'free';
      m.kicker = 'Free time';
      m.label = 'Free until ' + fmtTime(n.b.start) + dayWord(n.s, t.day);
      m.sub = '';
      m.left = fmtDur(Math.ceil(n.s - w)) + ' free';
      m.progress = (w - from) / (n.s - from);
      m.floor = '';
      m.next = 'Then ' + nameOf(n.b) + (nf ? ' · floor: ' + nf : '');
    }
    m.prompt = promptText(t);
    var L = leaving(t);
    m.leave = '';
    if (L && !cur) {
      // free time before a trip: the countdown takes the main place
      m.cat = 'leave';
      if (L.now < L.leave) {
        m.kicker = 'Get ready to leave';
        m.label = 'Leave by ' + fmtTime(L.leave);
        m.left = fmtDur(Math.ceil(L.leave - L.now)) + ' until you leave';
        m.sub = 'For ' + nameOf(L.b) + ' at ' + fmtTime(L.b.start) + ' · arrive about ' + fmtTime(L.b.start - (L.travel.spare || 0)) + ' (estimate)';
        var from = Math.max(L.leave - LEAVE_LEAD, prevEnd(t.week) - t.day * DAY);
        m.progress = (L.now - from) / (L.leave - from);
      } else {
        m.kicker = 'Time to leave · due ' + fmtTime(L.leave);
        m.label = 'Leave now';
        m.left = 'Starts in ' + fmtDur(Math.ceil(L.b.start - L.now));
        m.sub = 'For ' + nameOf(L.b) + ' at ' + fmtTime(L.b.start) + ' · ' + arrivalIfLeavingNow(L);
        m.progress = 1;
      }
      m.floor = L.travel.route ? 'Route: ' + L.travel.route : '';
    } else if (L) {
      // during another block: one line underneath
      m.leave = L.now < L.leave
        ? 'Leave by ' + fmtTime(L.leave) + ' for ' + nameOf(L.b) + ' · in ' + fmtDur(Math.ceil(L.leave - L.now))
        : 'Leave now for ' + nameOf(L.b) + ' (due ' + fmtTime(L.leave) + ') · ' + arrivalIfLeavingNow(L);
    }
    m.night = night.from > night.to ? (t.min >= night.from || t.min < night.to) : (t.min >= night.from && t.min < night.to);
    return m;
  }

  // ---------- screen ----------
  function set(id, text) {
    if (shown[id] === text) return;
    shown[id] = text;
    el[id].textContent = text;
    el[id].hidden = !text;
  }
  // Each number fades to grey STALE_AFTER seconds after its last update. The fade is a CSS animation, so it
  // still happens if this script stops running; every minute the script restarts it.
  function freshen() {
    var live = document.querySelectorAll('.live');
    for (var i = 0; i < live.length; i++) {
      live[i].classList.remove('fresh');
      void live[i].offsetWidth;
      live[i].classList.add('fresh');
    }
  }
  // Shrink the right-hand text in small steps until it fits on one screen (and grow it back when it can).
  function fit() {
    var box = document.querySelector('.block'), f = 1;
    root.style.setProperty('--fit', f);
    while (f > 0.55 && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)) {
      f = Math.round((f - 0.05) * 100) / 100;
      root.style.setProperty('--fit', f);
    }
  }
  function render(now) {
    var t = hkNow(now);
    var hm = (Math.floor(t.min / 60) % 12 || 12) + ':' + pad(t.min % 60);
    set('clockHm', hm);
    set('clockAp', t.min < 720 ? 'am' : 'pm');
    set('date', DAYS[t.day] + ' ' + t.date + ' ' + MONTHS[t.month]);
    if (!blocks.length) { set('label', 'No blocks in the schedule'); return t; }
    var m = model(t);
    current = m.block;
    var before = shown.label + shown.sub + shown.floor + shown.next + shown.prompt + shown.leave + shown.left.length;
    ['kicker', 'label', 'sub', 'left', 'leave', 'prompt', 'floor', 'next'].forEach(function (k) { set(k, m[k]); });
    // Refit when the words change or the screen size does (rotation, keyboard), without relying on resize events.
    var size = innerWidth + 'x' + innerHeight;
    if (shown.label + shown.sub + shown.floor + shown.next + shown.prompt + shown.leave + shown.left.length !== before || size !== shown.size) {
      shown.size = size;
      fit();
    }
    renderWx();
    renderAlert(hm + (t.min < 720 ? 'am' : 'pm'), m);
    el.bar.style.setProperty('--p', Math.max(0, Math.min(1, m.progress)).toFixed(4));
    if (shown.cat !== m.cat) {
      shown.cat = m.cat;
      root.style.setProperty('--hue', m.cat === 'free' ? 210 : m.cat === 'leave' ? 32 : hueOf(m.cat));
      root.classList.toggle('is-free', m.cat === 'free');
    }
    root.classList.toggle('night', m.night);
    return t;
  }
  function renderWx() {
    if (!window.NowWx) return;
    var s = window.NowWx.status();
    set('wxTemp', s.temp);
    set('wxAir', s.air);
    set('wxProblem', s.problem);
    el.wxTemp.classList.toggle('old', s.tempOld);
    el.wxAir.classList.toggle('old', s.airOld);
  }
  // Typhoon signal or rainstorm warning: takes over the screen. A tap shows the schedule for 10 minutes;
  // a new or changed warning takes over again at once.
  var alertHiddenUntil = 0, alertKey = '';
  function renderAlert(clock, m) {
    var list = window.NowWx ? window.NowWx.takeover() : [];
    var key = list.map(function (a) { return a.title + a.issued; }).join('|');
    if (key !== alertKey) {
      alertKey = key;
      alertHiddenUntil = 0;
      el.alertTitles.textContent = '';
      list.forEach(function (a) {
        var p = document.createElement('p');
        p.className = 'alert-title';
        p.textContent = a.title;
        el.alertTitles.appendChild(p);
        if (!isFinite(a.issued)) return;
        var when = document.createElement('p');
        when.className = 'alert-when';
        when.textContent = 'Issued ' + fmtTime(hkNow(new Date(a.issued)).min);
        el.alertTitles.appendChild(when);
      });
      el.alert.className = 'alert' + (list.length ? ' level-' + list[0].level : '');
    }
    var show = list.length > 0 && Date.now() >= alertHiddenUntil;
    el.alert.hidden = !show;
    if (!show) return;
    var a = list[0];
    set('alertIssued', a.old ? 'Last checked ' + (a.checked ? fmtTime(hkNow(new Date(a.checked)).min) : 'a while ago') + ', so this may be out of date' : '');
    set('alertClock', clock);
    set('alertNow', m.block ? m.label + ' · ' + m.left : m.label);
  }
  function tick() {
    var now = new Date();
    var t = render(now);
    if (window.NowPlan) window.NowPlan.tick(t, current);
    var minute = Math.floor(now.getTime() / 60e3);
    if (minute !== lastMinute) { lastMinute = minute; freshen(); maybeReload(); }
    lastTick = now.getTime();
    setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
  }

  // ---------- burn-in: move everything a few pixels every few minutes ----------
  var OFFSETS = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function shift() {
    shiftStep = (shiftStep + 1) % OFFSETS.length;
    root.style.setProperty('--dx', OFFSETS[shiftStep][0]);
    root.style.setProperty('--dy', OFFSETS[shiftStep][1]);
  }

  // ---------- connection ----------
  function setOnline(ok) {
    if (ok) {
      offlineSince = null;
      el.banner.hidden = true;
    } else {
      if (offlineSince === null) offlineSince = new Date();
      el.banner.textContent = 'No connection since ' + fmtTime(hkNow(offlineSince).min) +
        '. The schedule still works; the daily reload will wait for the connection.';
      el.banner.hidden = false;
    }
    root.classList.toggle('offline', !ok);
  }
  function ping() {
    return fetch('ping.txt?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      setOnline(r.ok);
      return r.ok;
    }, function () { setOnline(false); return false; });
  }

  // ---------- daily reload (picks up schedule changes; only when the connection works) ----------
  // The "reload day" changes at 4am, so the page reloads once a day at 4am whenever it was opened.
  function reloadDay(ms) {
    var t = hkNow(new Date(ms - RELOAD_AT * 60e3));
    return t.year + '-' + t.month + '-' + t.date;
  }
  function maybeReload() {
    if (reloadDay(Date.now()) === loadedDay || Date.now() < reloadTry) return;
    reloadTry = Date.now() + 5 * 60e3;
    ping().then(function (ok) { if (ok) location.reload(); });
  }

  // ---------- keep the screen on ----------
  function wake() {
    if (window.NowNative) return;           // the Android app keeps the screen on itself
    if (!('wakeLock' in navigator)) {
      el.wake.textContent = 'This browser can’t keep the screen on. Use the phone’s “Stay awake while charging” setting.';
      el.wake.hidden = false;
      return;
    }
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      el.wake.hidden = true;
      lock.addEventListener('release', function () {
        wakeLock = null;
        if (document.visibilityState === 'visible') wake();
      });
    }, function () { el.wake.hidden = false; });
  }

  function start(data) {
    ['clock', 'date', 'kicker', 'label', 'sub', 'left', 'leave', 'prompt', 'floor', 'next', 'bar', 'banner', 'wake', 'alert'].forEach(function (id) { el[id] = $(id); });
    el.wxTemp = $('wx-temp'); el.wxAir = $('wx-air'); el.wxProblem = $('wx-problem');
    el.alertTitles = $('alert-titles'); el.alertIssued = $('alert-issued'); el.alertClock = $('alert-clock'); el.alertNow = $('alert-now');
    el.alert.addEventListener('click', function () { alertHiddenUntil = Date.now() + 10 * 60e3; render(new Date()); });
    el.clockHm = $('clock-hm');
    el.clockAp = $('clock-ap');
    load(data);
    loadedDay = reloadDay(Date.now());
    window.NowPlan.init({
      blocks: function () { return blocks.map(function (x) { return x.b; }); },
      now: function () { return hkNow(new Date()); },
      dayKey: function () { return reloadDay(Date.now()); },
      fmtTime: fmtTime,
      onChange: function () { render(new Date()); }
    });
    window.NowWx.init({
      fmtTime: fmtTime,
      // today's minute -> ms, and ms -> minutes after midnight (Hong Kong time)
      at: function (min) { var t = hkNow(new Date()); return Date.now() - ((t.min - min) * 60 + t.sec) * 1000; },
      minOf: function (ms) { return hkNow(new Date(ms)).min; },
      onChange: function () { render(new Date()); }
    });
    $('app').addEventListener('click', function (e) { if (e.target !== el.wake) window.NowPlan.tap(); });
    root.style.setProperty('--stale-after', STALE_AFTER + 's');
    shown.left = '';
    window.addEventListener('resize', fit);
    $('app').hidden = false;
    tick();
    setInterval(shift, SHIFT_EVERY);
    setInterval(ping, PING_EVERY);
    window.addEventListener('offline', function () { setOnline(false); });
    window.addEventListener('online', ping);
    el.wake.addEventListener('click', wake);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (!wakeLock) wake();
      if (Date.now() - lastTick > 5000) { render(new Date()); freshen(); }
      ping();
    });
    wake();
    ping();
  }

  window.NowApp = { start: start };
})();
