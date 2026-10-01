// Planning picker for the "now" display. During the Planning block (or after a tap on the display) it lists:
//   - today's blocks that are chosen at Planning (marked open: true by tools/extract-schedule.mjs): type today's
//     choice, its floor, and, if it needs travel, the travel time;
//   - today's blocks that have travel saved, and "Add travel to another block" for the rest.
// Travel is entered as typical minutes (door to door), spare minutes, and an optional note of the route. now.js turns
// it into a "leave by" countdown: leave at start − travel − spare; the arrival time it shows is an estimate.
// Saved in this browser only:
//   daily.now.picks    today's picks, by block; ignored and removed after 4am the next day
//   daily.now.choices  everything typed before (with floor and travel), by category, offered as one-tap buttons
//   daily.now.travel   travel for a fixed block, by block; repeats every week until changed or removed
// Like now.js, this file is published unencrypted, so it must not contain anything from the schedule.
(function () {
  'use strict';
  var PICKS_KEY = 'daily.now.picks', CHOICES_KEY = 'daily.now.choices', TRAVEL_KEY = 'daily.now.travel';
  var MAX_CHOICES = 40;            // per category, most recently used first
  var IDLE_CLOSE = 2 * 60e3;       // close after 2 minutes untouched (not while typing)

  var opt, el = {}, view = 'list', editing = null, forgetMode = false, reason = null, lastTouch = 0, autoShownFor = null;

  // ---------- storage (every access guarded: storage can be unavailable) ----------
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* the change still shows until the next reload */ }
  }
  function todaysPicks() {
    var p = read(PICKS_KEY, null);
    if (!p || p.day !== opt.dayKey()) return {};
    return p.picks || {};
  }
  function setPick(id, pick) {
    var p = todaysPicks();
    if (pick) p[id] = pick; else delete p[id];
    write(PICKS_KEY, { day: opt.dayKey(), picks: p });
    opt.onChange();
  }
  function choicesFor(cat) { return (read(CHOICES_KEY, {})[cat] || []).slice(); }
  function remember(cat, choice) {
    var all = read(CHOICES_KEY, {});
    var list = (all[cat] || []).filter(function (c) { return c.what.toLowerCase() !== choice.what.toLowerCase(); });
    list.unshift(choice);
    all[cat] = list.slice(0, MAX_CHOICES);
    write(CHOICES_KEY, all);
  }
  function forget(cat, what) {
    var all = read(CHOICES_KEY, {});
    all[cat] = (all[cat] || []).filter(function (c) { return c.what !== what; });
    write(CHOICES_KEY, all);
  }
  function weeklyTravel(id) { return read(TRAVEL_KEY, {})[id] || null; }
  function setWeeklyTravel(id, travel) {
    var all = read(TRAVEL_KEY, {});
    if (travel) all[id] = travel; else delete all[id];
    write(TRAVEL_KEY, all);
    opt.onChange();
  }
  // Travel for a block today: the pick's travel for a chosen block, otherwise the block's weekly travel.
  function travelFor(b) {
    var pick = b.open ? todaysPicks()[b.id] : null;
    if (pick) return pick.travel || null;
    return weeklyTravel(b.id);
  }
  function leaveBy(b, travel) { return b.start - travel.min - (travel.spare || 0); }
  // Remove yesterday's picks once the day has turned over (at 4am).
  function tidy() {
    var p = read(PICKS_KEY, null);
    if (p && p.day !== opt.dayKey()) { try { localStorage.removeItem(PICKS_KEY); } catch (e) {} }
  }

  // ---------- which blocks ----------
  function todayLeft(t) {
    return opt.blocks().filter(function (b) { return b.day === t.day && b.end > t.min && !b.planning; })
      .sort(function (a, b) { return a.start - b.start; });
  }
  function openToday(t) { return todayLeft(t).filter(function (b) { return b.open; }); }
  function travelToday(t) { return todayLeft(t).filter(function (b) { return !b.open && weeklyTravel(b.id); }); }
  function addableToday(t) { return todayLeft(t).filter(function (b) { return !b.open && !weeklyTravel(b.id); }); }

  // ---------- building the screen (DOM only, never HTML strings, because the text is typed by hand) ----------
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, text, onTap) {
    var b = make('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onTap);
    return b;
  }
  function input(id, cls, placeholder, attrs) {
    var i = make('input', cls);
    i.id = id; i.placeholder = placeholder; i.autocomplete = 'off';
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function when(b) { return opt.fmtTime(b.start) + '–' + opt.fmtTime(b.end); }
  function travelText(b, travel) {
    return 'leave by ' + opt.fmtTime(leaveBy(b, travel)) + ' (' + travel.min + ' min travel' + (travel.spare ? ' + ' + travel.spare + ' spare' : '') + ')';
  }
  function go(v, b) { view = v; editing = b || null; forgetMode = false; draw(); }

  // Travel fields: minutes door to door, spare minutes, route note. Returns { box, read() -> travel | null | false }.
  function travelFields(current) {
    var box = make('div', 'plan-travel');
    box.appendChild(make('span', 'plan-label', 'Travel'));
    var min = input('plan-travel-min', 'plan-input plan-num', 'minutes', { inputmode: 'numeric', 'aria-label': 'Travel minutes, door to door', enterkeyhint: 'next' });
    var spare = input('plan-travel-spare', 'plan-input plan-num', 'spare', { inputmode: 'numeric', 'aria-label': 'Spare minutes', enterkeyhint: 'next' });
    var route = input('plan-travel-route', 'plan-input', 'Route (optional)', { autocapitalize: 'sentences', enterkeyhint: 'done' });
    if (current) { min.value = current.min; spare.value = current.spare || ''; route.value = current.route || ''; }
    box.appendChild(min); box.appendChild(make('span', 'plan-label', 'min +'));
    box.appendChild(spare); box.appendChild(make('span', 'plan-label', 'spare'));
    box.appendChild(route);
    [min, spare].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); (i === min ? spare : route).focus(); } }); });
    return {
      box: box,
      // null = no travel; false = something typed that isn't a number of minutes
      read: function () {
        var m = min.value.trim(), s = spare.value.trim();
        if (!m && !s && !route.value.trim()) return null;
        if (!/^\d{1,3}$/.test(m) || +m < 1 || (s && !/^\d{1,3}$/.test(s))) return false;
        return { min: +m, spare: s ? +s : 0, route: route.value.trim() };
      },
      focusMin: function () { min.focus(); }
    };
  }
  function done() { if (document.activeElement) document.activeElement.blur(); go('list'); }

  function draw() {
    var t = opt.now(), body = el.body;
    body.textContent = '';
    var picks = todaysPicks();
    if (editing && !todayLeft(t).some(function (b) { return b.id === editing.id; })) { view = 'list'; editing = null; }

    if (view === 'list') {
      el.title.textContent = reason === 'planning' ? 'Plan today' : 'Today’s plan';
      var rows = openToday(t).concat(travelToday(t)).sort(function (a, b) { return a.start - b.start; });
      if (!rows.length) body.appendChild(make('p', 'plan-empty', 'Nothing to choose today.'));
      rows.forEach(function (b) {
        var pick = b.open ? picks[b.id] : null, travel = travelFor(b);
        var row = button('plan-row' + (pick || (!b.open && travel) ? ' picked' : ''), null, function () { go(b.open ? 'edit' : 'travel', b); });
        row.appendChild(make('span', 'plan-when', when(b)));
        row.appendChild(make('span', 'plan-what', b.open ? (pick ? b.label + ': ' + pick.what : b.label + ' · not picked') : b.label));
        var details = [];
        if (pick && pick.floor) details.push('Floor: ' + pick.floor);
        if (travel) details.push(travelText(b, travel));
        if (details.length) row.appendChild(make('span', 'plan-floor', details.join(' · ')));
        body.appendChild(row);
      });
      if (addableToday(t).length) body.appendChild(button('plan-btn plan-add', 'Add travel to another block', function () { go('pickblock'); }));
      return;
    }

    if (view === 'pickblock') {
      el.title.textContent = 'Which block needs travel?';
      addableToday(t).forEach(function (b) {
        var row = button('plan-row', null, function () { go('travel', b); });
        row.appendChild(make('span', 'plan-when', when(b)));
        row.appendChild(make('span', 'plan-what', b.label));
        body.appendChild(row);
      });
      var back = make('div', 'plan-actions');
      back.appendChild(button('plan-btn', 'Back', function () { go('list'); }));
      body.appendChild(back);
      return;
    }

    if (view === 'travel') {
      // travel for a fixed block, every week
      var blk = editing, now = weeklyTravel(blk.id);
      el.title.textContent = when(blk) + ' · ' + blk.label;
      body.appendChild(make('p', 'plan-note', 'Typical door-to-door minutes, plus spare. Repeats every week until you change it.'));
      var form = make('form', 'plan-new'), tf = travelFields(now), save = make('button', 'plan-save', 'Save');
      save.type = 'submit';
      form.appendChild(tf.box); form.appendChild(save);
      var msg = make('p', 'plan-msg');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var tr = tf.read();
        if (!tr) { msg.textContent = 'Type the travel time in whole minutes, like 45.'; tf.focusMin(); return; }
        setWeeklyTravel(blk.id, tr);
        done();
      });
      body.appendChild(form); body.appendChild(msg);
      var acts = make('div', 'plan-actions');
      acts.appendChild(button('plan-btn', 'Back', function () { go('list'); }));
      if (now) acts.appendChild(button('plan-btn', 'Remove travel', function () { setWeeklyTravel(blk.id, null); go('list'); }));
      body.appendChild(acts);
      return;
    }

    // edit view: today's choice for one open block
    var ob = editing, pick = picks[ob.id], saved = choicesFor(ob.cat);
    el.title.textContent = when(ob) + ' · ' + ob.label;
    if (saved.length) {
      var chips = make('div', 'chips' + (forgetMode ? ' forgetting' : ''));
      saved.forEach(function (c) {
        var label = (forgetMode ? '✕ ' : '') + c.what + (c.travel ? ' · ' + c.travel.min + ' min away' : '');
        chips.appendChild(button('chip' + (pick && pick.what === c.what ? ' on' : ''), label, function () {
          if (forgetMode) { forget(ob.cat, c.what); draw(); return; }
          remember(ob.cat, c);
          setPick(ob.id, c);
          go('list');
        }));
      });
      body.appendChild(chips);
    }
    if (!forgetMode) {
      var f = make('form', 'plan-new');
      var what = input('plan-what', 'plan-input', saved.length ? 'Or type a new one' : 'Type today’s choice', { autocapitalize: 'sentences', enterkeyhint: 'next' });
      var floor = input('plan-floor', 'plan-input', 'Floor (optional)', { autocapitalize: 'none', enterkeyhint: 'next' });
      var tf2 = travelFields(null), save2 = make('button', 'plan-save', 'Save'), msg2 = make('p', 'plan-msg');
      save2.type = 'submit';
      f.appendChild(what); f.appendChild(floor); f.appendChild(tf2.box); f.appendChild(save2);
      what.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); floor.focus(); } });
      floor.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); f.requestSubmit(); } });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var w = what.value.trim(), tr = tf2.read();
        if (!w) { what.focus(); return; }
        if (tr === false) { msg2.textContent = 'Type the travel time in whole minutes, like 45, or leave it empty.'; tf2.focusMin(); return; }
        var choice = { what: w, floor: floor.value.trim() };
        if (tr) choice.travel = tr;
        remember(ob.cat, choice);
        setPick(ob.id, choice);
        done();
      });
      body.appendChild(f); body.appendChild(msg2);
    }
    var actions = make('div', 'plan-actions');
    actions.appendChild(button('plan-btn', 'Back', function () { go('list'); }));
    if (pick && !forgetMode) actions.appendChild(button('plan-btn', 'Clear today’s pick', function () { setPick(ob.id, null); draw(); }));
    if (saved.length) actions.appendChild(button('plan-btn', forgetMode ? 'Finished removing' : 'Remove saved choices', function () { forgetMode = !forgetMode; draw(); }));
    body.appendChild(actions);
  }

  function open(why) {
    reason = why;
    view = 'list'; editing = null; forgetMode = false;
    lastTouch = Date.now();
    el.plan.hidden = false;
    draw();
  }
  function close() {
    if (document.activeElement && el.plan.contains(document.activeElement)) document.activeElement.blur();
    el.plan.hidden = true;
    reason = null;
  }
  function typing() { return document.activeElement && document.activeElement.tagName === 'INPUT' && el.plan.contains(document.activeElement); }

  // Called by now.js every second with the time and the current block (or null).
  function tick(t, cur) {
    tidy();
    if (cur && cur.planning) {
      var key = opt.dayKey() + cur.id;
      if (autoShownFor !== key) { autoShownFor = key; if (openToday(t).length || travelToday(t).length) open('planning'); }
    }
    if (el.plan.hidden || typing()) return;
    var planningNow = cur && cur.planning;
    if (!(reason === 'planning' && planningNow) && Date.now() - lastTouch > IDLE_CLOSE) close();
  }

  window.NowPlan = {
    init: function (options) {
      opt = options;
      el.plan = document.getElementById('plan');
      el.title = document.getElementById('plan-title');
      el.body = document.getElementById('plan-body');
      document.getElementById('plan-done').addEventListener('click', close);
      ['pointerdown', 'keydown', 'input'].forEach(function (type) {
        el.plan.addEventListener(type, function () { lastTouch = Date.now(); });
      });
    },
    pickFor: function (id) { return todaysPicks()[id] || null; },
    travelFor: travelFor,
    leaveBy: leaveBy,
    // A tap on the display opens the picker while any of today's blocks are still ahead (to choose or add travel).
    tap: function () { if (todayLeft(opt.now()).length) open('tap'); },
    tick: tick,
    isOpen: function () { return !el.plan.hidden; }
  };
})();
