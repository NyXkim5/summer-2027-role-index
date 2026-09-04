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

    var index = S.RowIndex.shared(doc, today);

    var view = doc.createElement('div');
    view.className = 'triage-view';
    mount.appendChild(view);
    render(view, index, today);
  }

  // Resolved at call time, not at start(), because browse.js runs at parse
  // time and boot.js waits for DOMContentLoaded. Whichever wins, the click
  // happens long after both have run.
  function refreshBrowse() {
    if (S.Browse && S.Browse.refresh) S.Browse.refresh();
  }

  function render(view, index, today) {
    view.innerHTML = '';
    var profile = S.Store.getProfile();
    if (!profile) {
      S.Onboard.render(view, function () { render(view, index, today); });
      return;
    }
    if (S.Onboard.isComplete(profile)) {
      S.Today.render(view, index.rows, profile, today, refreshBrowse);
    }
    view.appendChild(editButton(view, index, today));
  }

  // The spec calls the profile strip editable later. Without this a reader who
  // picked the wrong field, or skipped, could never reach it again.
  function editButton(view, index, today) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'ob-edit';
    b.textContent = 'Edit profile';
    b.addEventListener('click', function () {
      view.innerHTML = '';
      S.Onboard.render(view, function () {
        render(view, index, today);
        refreshBrowse();
      });
    });
    return b;
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
