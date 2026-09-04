;(function (root) {
  'use strict';

  var S = root.S27;
  var doc = root.document;

  function start() {
    var mount = doc.getElementById('triage');
    if (!mount) return;

    // Touch storage before asking whether it worked. isDegraded only knows
    // after a real read has been attempted.
    S.Store.load();
    if (S.Store.isDegraded()) banner(mount);

    var today = new Date().toISOString().slice(0, 10);
    // Recorded before anything can return early, so the first visit is
    // recorded too. Today's stored day list reads this field.
    S.Store.setLastVisit(today);

    var index = S.RowIndex.build(doc, today);
    var profile = S.Store.getProfile();

    if (!profile) {
      S.Onboard.render(mount, function (p) {
        mount.innerHTML = '';
        if (S.Onboard.isComplete(p)) S.Today.render(mount, index.rows, p, today);
      });
      return;
    }
    if (S.Onboard.isComplete(profile)) S.Today.render(mount, index.rows, profile, today);
  }

  function banner(mount) {
    var p = doc.createElement('p');
    p.className = 'degraded';
    p.textContent = 'This browser is blocking local storage, so what you mark here will not be remembered.';
    mount.appendChild(p);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : window);
