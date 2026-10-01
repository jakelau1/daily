// Section menu for the top bar: the inline section links are hidden on narrow screens, so this lists every section.
(function () {
  var btn = document.getElementById('menu-btn'), panel = document.getElementById('menu-panel');
  if (!btn || !panel) return;
  function set(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open);
    btn.textContent = open ? 'Close' : 'Menu';
  }
  btn.addEventListener('click', function () { set(panel.hidden); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { set(false); btn.focus(); } });
  document.addEventListener('click', function (e) { if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) set(false); });
})();
