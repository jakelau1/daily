// "Back up or restore data": a screen inside the picker panel (which closes itself after 2 idle minutes).
// Backup = one JSON file of everything saved on this phone (picks, saved choices, travel times), saved wherever the owner
// chooses with Android's own "Save to…" picker (the FileSaver plugin in app/android). Restore = pick such a file; nothing changes until the owner confirms.
// The file never includes the schedule itself: that is bundled into the app when it is built.
(function () {
  'use strict';
  var C = window.Capacitor, FORMAT = 'get-ready', VERSION = 1;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(cls, text, onTap) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onTap); return b; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
  function count(n) { return n + ' saved item' + (n === 1 ? '' : 's'); }

  // The backup text for what is saved now. Exposed so the app can be tested without the share sheet.
  function makeBackup() {
    return JSON.stringify({ app: FORMAT, schemaVersion: VERSION, exportedAtMillis: Date.now(), kv: window.AppStore.all() }, null, 1);
  }
  // Checks a backup file's text and returns { ok: true, kv, when } or { ok: false, why }. Never throws.
  function readBackup(text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return { ok: false, why: 'That file is not a Get Ready backup (it is not readable as JSON).' }; }
    if (!j || j.app !== FORMAT || !j.kv || typeof j.kv !== 'object' || Array.isArray(j.kv)) return { ok: false, why: 'That file is not a Get Ready backup.' };
    if (!Number.isInteger(j.schemaVersion) || j.schemaVersion > VERSION) return { ok: false, why: 'That backup comes from a newer version of the app, so this one will not read it.' };
    var keys = Object.keys(j.kv);
    for (var i = 0; i < keys.length; i++) if (typeof j.kv[keys[i]] !== 'string') return { ok: false, why: 'That backup is damaged (an item is not text), so nothing was changed.' };
    return { ok: true, kv: j.kv, when: j.exportedAtMillis };
  }

  function doExport(msg) {
    var name = 'GetReady-backup-' + stamp(new Date()) + '.json', text = makeBackup();
    msg.textContent = '';
    if (window.AppStore.isNative) {
      C.registerPlugin('FileSaver').save({ name: name, text: text }).then(function () { msg.textContent = 'Backup saved.'; }, function (e) {
        var why = String((e && e.message) || e);
        msg.textContent = /cancel/i.test(why) ? '' : 'The backup could not be saved: ' + why;
      });
    } else {
      var a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
      msg.textContent = '';
    }
  }

  function render(body) {
    body.appendChild(el('p', 'plan-note', 'Everything picked or typed on this screen is saved on this phone only, in a database inside the app. It does not sync anywhere. A backup file keeps a copy, or moves it to another phone.'));
    body.appendChild(el('p', 'plan-note', 'Saved on this phone now: ' + count(Object.keys(window.AppStore.all()).length) + '.'));
    var msg = el('p', 'plan-msg'), confirmBox = el('div', 'plan-actions');
    var file = el('input', 'data-file'); file.type = 'file'; file.accept = 'application/json,.json'; file.setAttribute('aria-label', 'Choose a backup file');
    var actions = el('div', 'plan-actions');
    actions.appendChild(button('plan-btn', 'Back up to a file', function () { doExport(msg); }));
    actions.appendChild(button('plan-btn', 'Restore from a file', function () { confirmBox.textContent = ''; msg.textContent = ''; file.value = ''; file.click(); }));
    body.appendChild(actions); body.appendChild(file); body.appendChild(msg); body.appendChild(confirmBox);
    var problem = window.AppStore.problem();
    if (problem) msg.textContent = 'Something could not be saved to the database: ' + problem;

    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onerror = function () { msg.textContent = 'That file could not be read.'; };
      reader.onload = function () {
        var r = readBackup(String(reader.result));
        confirmBox.textContent = '';
        if (!r.ok) { msg.textContent = r.why; return; }
        msg.textContent = '';
        var n = Object.keys(r.kv).length;
        confirmBox.appendChild(el('p', 'data-sum', 'This backup has ' + count(n) + (r.when ? ', made ' + new Date(r.when).toLocaleString('en-GB') : '') + '. Restoring replaces what is on this phone now.'));
        confirmBox.appendChild(button('plan-btn', 'Replace what is on this phone', function () {
          msg.textContent = 'Restoring…';
          window.AppStore.replaceAll(r.kv).then(function () { location.reload(); }, function (e) { msg.textContent = 'The restore failed: ' + ((e && e.message) || e); });
        }));
        confirmBox.appendChild(button('plan-btn', 'Cancel', function () { confirmBox.textContent = ''; }));
      };
      reader.readAsText(f);
    });
  }

  window.AppData = { makeBackup: makeBackup, readBackup: readBackup };
  window.NowPlan.addExtra({ label: 'Back up or restore data', render: render });
})();
