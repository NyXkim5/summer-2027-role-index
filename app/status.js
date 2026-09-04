;(function (root) {
  'use strict';

  var Store = root.S27.Store;

  var CONTROLS = [
    ['applied', 'Applied'],
    ['saved', 'Save'],
    ['dismissed', 'Not for me']
  ];

  // A row can be pruned out of the page by a later refresh, so the snapshot
  // travels with the status. My list renders from this when the row is gone.
  function snapshot(row) {
    return { co: row.co, title: row.title, loc: row.loc, url: row.url };
  }

  function set(row, value) {
    Store.setStatus(row.key, value, value === null ? undefined : snapshot(row));
  }

  function current(row) {
    var s = Store.getStatus(row.key);
    return s ? s.s : null;
  }

  function controlsFor(row, onChange) {
    var wrap = root.document.createElement('span');
    wrap.className = 'status';

    function paint() {
      var now = current(row);
      wrap.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.val === now));
      });
    }

    CONTROLS.forEach(function (c) {
      var b = root.document.createElement('button');
      b.type = 'button';
      b.className = 'sbtn s-' + c[0];
      b.dataset.val = c[0];
      b.textContent = c[1];
      b.addEventListener('click', function () {
        var next = current(row) === c[0] ? null : c[0];
        set(row, next);
        paint();
        onChange(next);
      });
      wrap.appendChild(b);
    });

    paint();
    return wrap;
  }

  function badgeFor(row) {
    var now = current(row);
    if (!now) return null;
    var el = root.document.createElement('span');
    el.className = 'tag st st-' + now;
    el.textContent = now;
    return el;
  }

  root.S27 = root.S27 || {};
  root.S27.Status = {
    snapshot: snapshot, set: set, current: current,
    controlsFor: controlsFor, badgeFor: badgeFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
