// Unlocks the encrypted schedule in now/index.html and hands it to now.js (window.NowApp.start).
// Uses StatiCrypt's own library (vendor/staticrypt.js, made by tools/build-now.mjs) with its documented
// replaceHtmlCallback, so the decrypted text is read as data and never written into the page as HTML.
// "Remember on this device" keeps a salted hash of the password in this browser with no expiry, so the
// daily reload unlocks by itself. To forget it on a device, open the page with #staticrypt_logout on the end.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var lock = $('lock'), pw = $('pw'), remember = $('remember'), btn = $('unlock'), msg = $('lock-msg'), loading = $('loading');

  function fail(text) {
    loading.hidden = true;
    lock.hidden = false;
    msg.textContent = text;
  }

  if (!window.crypto || !window.crypto.subtle || !window.staticryptInitiator) {
    fail('This browser can’t unlock the page (it needs a secure https:// address).');
    return;
  }

  var config = JSON.parse($('staticrypt-config').textContent);
  var staticrypt = window.staticryptInitiator.init(config, {
    // Named for this site, because every page on jakelau1.github.io shares one browser storage area.
    rememberExpirationKey: 'daily.now.remember-expires',
    rememberPassphraseKey: 'daily.now.remember',
    replaceHtmlCallback: function (text) {
      loading.hidden = true;
      lock.hidden = true;
      window.NowApp.start(JSON.parse(text));
    },
    clearLocalStorageCallback: null
  });

  staticrypt.handleDecryptOnLoad().then(function (r) {
    if (!r.isSuccessful) { fail(''); pw.focus(); }
  }, function (e) {
    fail('Something went wrong while unlocking: ' + e.message);
  });

  lock.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true;
    msg.textContent = 'Unlocking…';
    staticrypt.handleDecryptionOfPage(pw.value, remember.checked).then(function (r) {
      btn.disabled = false;
      if (!r.isSuccessful) { msg.textContent = 'That password didn’t work. Try again.'; pw.select(); }
      else pw.value = '';
    }, function (e) {
      btn.disabled = false;
      msg.textContent = 'Something went wrong while unlocking: ' + e.message;
    });
  });
})();
