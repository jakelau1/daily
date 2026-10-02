// Starts the app's Now page: opens the database, loads the schedule that was bundled when the app was built
// (data.json, made by tools/build-app.mjs from the private schedule), then hands it to the display code.
(function () {
  'use strict';
  var loading = document.getElementById('loading');
  function fail(text) { loading.textContent = text; loading.hidden = false; }
  window.NowNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  window.AppStore.ready()
    .then(function () { return fetch('data.json', { cache: 'no-store' }); })
    .then(function (r) { if (!r.ok) throw new Error('the schedule file answered ' + r.status); return r.json(); })
    .then(function (data) { loading.hidden = true; window.NowApp.start(data); })
    .catch(function (e) { fail('The app could not start: ' + ((e && e.message) || e)); });
})();
