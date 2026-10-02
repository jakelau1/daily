// The app's saved choices live in a real SQLite database on the phone (one small key/value table for now; the
// feature tables come with the features). A copy is kept in memory so the picker's reads stay instant, and every
// change is written through to the database in order. Outside the app (a browser, for testing) the same calls
// use localStorage, so this file works in both places.
// window.NowStorage is what now/plan.js uses; window.AppStore is for the app's own code (backup and restore).
(function () {
  'use strict';
  var DB = 'getready';
  var C = window.Capacitor;
  var native = !!(C && C.isNativePlatform && C.isNativePlatform());
  var sql = native ? C.registerPlugin('CapacitorSQLite') : null;
  var mem = {}, writes = Promise.resolve(), readyPromise = null, lastProblem = '';

  // Writes run one after another; a failed write is remembered (and shown by the panel) instead of being lost silently.
  function queue(job) {
    writes = writes.then(job).catch(function (e) { lastProblem = String((e && e.message) || e); });
    return writes;
  }
  // "Already exists / already open" after a page reload inside the same app session is normal: carry on.
  function tolerant(promise) { return promise.catch(function (e) { if (!/already/i.test(String((e && e.message) || e))) throw e; }); }

  function init() {
    if (!native) {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k.indexOf('app.kv.') === 0) mem[k.slice(7)] = localStorage.getItem(k);
        }
      } catch (e) { /* no storage: start empty */ }
      return Promise.resolve();
    }
    var o = { database: DB, readonly: false };
    // After a page reload the app process (and its open database connection) is still alive: ask first. With no
    // connection yet, the plugin answers "not open" by refusing, which here just means "go and open it".
    return sql.isDBOpen(o).then(function (r) { return !!(r && r.result); }, function () { return false; })
      .then(function (open) {
        if (open) return null;
        return tolerant(sql.createConnection({ database: DB, version: 1, encrypted: false, mode: 'no-encryption', readonly: false }))
          .then(function () { return tolerant(sql.open(o)); });
      })
      .then(function () {
        return sql.execute({ database: DB, readonly: false,
          statements: 'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL);' });
      })
      .then(function () { return sql.query({ database: DB, readonly: false, statement: 'SELECT key, value FROM kv;', values: [] }); })
      .then(function (r) { (r.values || []).forEach(function (row) { mem[row.key] = row.value; }); });
  }

  function getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }
  function setItem(k, v) {
    mem[k] = String(v);
    if (!native) { try { localStorage.setItem('app.kv.' + k, mem[k]); } catch (e) { /* kept in memory only */ } return; }
    var val = mem[k];
    queue(function () {
      return sql.run({ database: DB, readonly: false, statement: 'INSERT OR REPLACE INTO kv (key, value, updated) VALUES (?, ?, ?);', values: [k, val, Date.now()] });
    });
  }
  function removeItem(k) {
    delete mem[k];
    if (!native) { try { localStorage.removeItem('app.kv.' + k); } catch (e) { /* ignore */ } return; }
    queue(function () { return sql.run({ database: DB, readonly: false, statement: 'DELETE FROM kv WHERE key = ?;', values: [k] }); });
  }
  function all() { var o = {}; Object.keys(mem).forEach(function (k) { o[k] = mem[k]; }); return o; }
  // Replace everything at once (restore from a backup). Resolves when the database has it.
  function replaceAll(obj) {
    mem = {};
    Object.keys(obj).forEach(function (k) { mem[k] = String(obj[k]); });
    if (!native) {
      try {
        Object.keys(localStorage).filter(function (k) { return k.indexOf('app.kv.') === 0; }).forEach(function (k) { localStorage.removeItem(k); });
        Object.keys(mem).forEach(function (k) { localStorage.setItem('app.kv.' + k, mem[k]); });
      } catch (e) { /* ignore */ }
      return Promise.resolve();
    }
    var now = Date.now(), snapshot = all();
    return queue(function () {
      var set = [{ statement: 'DELETE FROM kv;', values: [] }];
      Object.keys(snapshot).forEach(function (k) { set.push({ statement: 'INSERT INTO kv (key, value, updated) VALUES (?, ?, ?);', values: [k, snapshot[k], now] }); });
      return sql.executeSet({ database: DB, readonly: false, set: set, transaction: true });
    });
  }

  window.NowStorage = { getItem: getItem, setItem: setItem, removeItem: removeItem };
  window.AppStore = {
    isNative: native,
    ready: function () { return readyPromise || (readyPromise = init()); },
    all: all, replaceAll: replaceAll,
    flush: function () { return writes; },
    problem: function () { return lastProblem; }
  };
})();
