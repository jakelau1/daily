// Planning picker for the "now" display. During the Planning block (or after a tap on the display) it lists today's
// blocks that are chosen at Planning (marked open: true by tools/extract-schedule.mjs), and lets you type today's
// choice for each one and its floor.
// Saved in this browser only:
//   daily.now.picks    today's picks, by block; ignored and removed after 4am the next day
//   daily.now.choices  everything typed before, with its floor, by category, offered as one-tap buttons next time
// Like now.js, this file is published unencrypted, so it must not contain anything from the schedule.
(function () {
  'use strict';
  var PICKS_KEY = 'daily.now.picks', CHOICES_KEY = 'daily.now.choices';
  var MAX_CHOICES = 40;            // per category, most recently used first
  var IDLE_CLOSE = 2 * 60e3;       // close after 2 minutes untouched (not while typing)

  var opt, el = {}, view = 'list', editing = null, forgetMode = false, reason = null, lastTouch = 0, autoShownFor = null;

  // ---------- storage (every access guarded: storage can be unavailable) ----------
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* the pick still shows until the next reload */ }
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
  function remember(cat, what, floor) {
    var all = read(CHOICES_KEY, {});
    var list = (all[cat] || []).filter(function (c) { return c.what.toLowerCase() !== what.toLowerCase(); });
    list.unshift({ what: what, floor: floor });
    all[cat] = list.slice(0, MAX_CHOICES);
    write(CHOICES_KEY, all);
  }
  function forget(cat, what) {
    var all = read(CHOICES_KEY, {});
    all[cat] = (all[cat] || []).filter(function (c) { return c.what !== what; });
    write(CHOICES_KEY, all);
  }
  // Remove yesterday's picks once the day has turned over (at 4am).
  function tidy() {
    var p = read(PICKS_KEY, null);
    if (p && p.day !== opt.dayKey()) { try { localStorage.removeItem(PICKS_KEY); } catch (e) {} }
  }

  // ---------- which blocks ----------
  // Today's open blocks that haven't ended yet.
  function openToday(t) {
    return opt.blocks().filter(function (b) { return b.open && b.day === t.day && b.end > t.min; })
      .sort(function (a, b) { return a.start - b.start; });
  }

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
  function when(b) { return opt.fmtTime(b.start) + '–' + opt.fmtTime(b.end); }

  function draw() {
    var t = opt.now(), body = el.body;
    body.textContent = '';
    var blocks = openToday(t), picks = todaysPicks();
    if (view === 'edit' && editing && !blocks.some(function (b) { return b.id === editing.id; })) view = 'list';

    if (view === 'list') {
      el.title.textContent = reason === 'planning' ? 'Plan today' : 'Today’s choices';
      if (!blocks.length) { body.appendChild(make('p', 'plan-empty', 'Nothing to choose today.')); return; }
      blocks.forEach(function (b) {
        var pick = picks[b.id];
        var row = button('plan-row' + (pick ? ' picked' : ''), null, function () { editing = b; view = 'edit'; forgetMode = false; draw(); });
        row.appendChild(make('span', 'plan-when', when(b)));
        row.appendChild(make('span', 'plan-what', pick ? b.label + ': ' + pick.what : b.label + ' · not picked'));
        if (pick && pick.floor) row.appendChild(make('span', 'plan-floor', 'Floor: ' + pick.floor));
        body.appendChild(row);
      });
      return;
    }

    // edit view: one block
    var blk = editing, pick = picks[blk.id], saved = choicesFor(blk.cat);
    el.title.textContent = when(blk) + ' · ' + blk.label;
    if (saved.length) {
      var chips = make('div', 'chips' + (forgetMode ? ' forgetting' : ''));
      saved.forEach(function (c) {
        chips.appendChild(button('chip' + (pick && pick.what === c.what ? ' on' : ''), (forgetMode ? '✕ ' : '') + c.what, function () {
          if (forgetMode) { forget(blk.cat, c.what); draw(); return; }
          remember(blk.cat, c.what, c.floor);
          setPick(blk.id, { what: c.what, floor: c.floor });
          view = 'list'; draw();
        }));
      });
      body.appendChild(chips);
    }
    if (!forgetMode) {
      var form = make('form', 'plan-new');
      var what = make('input', 'plan-input');
      what.id = 'plan-what'; what.placeholder = saved.length ? 'Or type a new one' : 'Type today’s choice';
      what.autocomplete = 'off'; what.setAttribute('autocapitalize', 'sentences'); what.setAttribute('enterkeyhint', 'next');
      var floor = make('input', 'plan-input');
      floor.id = 'plan-floor'; floor.placeholder = 'Floor (optional)';
      floor.autocomplete = 'off'; floor.setAttribute('autocapitalize', 'none'); floor.setAttribute('enterkeyhint', 'done');
      var save = make('button', 'plan-save', 'Save');
      save.type = 'submit';
      form.appendChild(what); form.appendChild(floor); form.appendChild(save);
      what.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); floor.focus(); } });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var w = what.value.trim(), f = floor.value.trim();
        if (!w) { what.focus(); return; }
        remember(blk.cat, w, f);
        setPick(blk.id, { what: w, floor: f });
        if (document.activeElement) document.activeElement.blur();
        view = 'list'; draw();
      });
      body.appendChild(form);
    }
    var actions = make('div', 'plan-actions');
    actions.appendChild(button('plan-btn', 'Back', function () { view = 'list'; draw(); }));
    if (pick && !forgetMode) actions.appendChild(button('plan-btn', 'Clear today’s pick', function () { setPick(blk.id, null); draw(); }));
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
      if (autoShownFor !== key) { autoShownFor = key; if (openToday(t).length) open('planning'); }
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
    // A tap on the display opens the picker, if anything is left to choose today.
    tap: function () { if (openToday(opt.now()).length) open('tap'); },
    tick: tick,
    isOpen: function () { return !el.plan.hidden; }
  };
})();
