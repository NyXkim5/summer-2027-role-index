;(function (root) {
  'use strict';

  var RI = root.S27.RowIndex;
  var FIELDS = RI.FIELDS, TERMS = RI.TERMS, TYPES = RI.TYPES;
  var today = new Date().toISOString().slice(0, 10);
  var index = RI.build(document, today);
  var sections = index.sections;

  // browse.js filters on the same records the triage views score, so a row can
  // never be classified one way here and another way there. Hanging the
  // record itself off the row lets matches() reach S27.Status without a
  // second index.
  index.rows.forEach(function (r) {
    r.tr._row = r;
    r.tr._f = {
      text: r.text, fields: r.fields, terms: r.terms, types: r.types,
      closed: r.closed, info: r.info, nocount: r.deep
    };
    if (r.info) return;
    var badge = root.S27.Status.badgeFor(r);
    if (badge) r.tr.querySelectorAll('td')[1].appendChild(badge);
  });

  var state = { q: '', field: null, term: null, type: null, hideClosed: false, hideDismissed: true };

  function matches(tr) {
    var f = tr._f;
    if (state.q && f.text.indexOf(state.q) === -1) return false;
    if (state.hideClosed && f.closed) return false;
    if (state.hideDismissed && !f.info && root.S27.Status.current(tr._row) === 'dismissed') return false;
    if (f.info) return true;           // reference rows only respond to search
    if (state.field && f.fields.indexOf(state.field) === -1) return false;
    if (state.term && f.terms.indexOf(state.term) === -1) return false;
    if (state.type && f.types.indexOf(state.type) === -1) return false;
    return true;
  }

  var countEl, noResEl;
  function apply() {
    var shown = 0, total = 0, anyVisible = 0;
    sections.forEach(function (s) {
      var vis = 0;
      s.rows.forEach(function (r) {
        var tr = r.tr;
        var counts = !tr._f.info && !tr._f.nocount;
        if (counts) total++;
        var ok = matches(tr);
        tr.classList.toggle('hidden', !ok);
        if (ok) { vis++; anyVisible++; if (counts) shown++; }
      });
      var empty = vis === 0;
      s.h2.classList.toggle('hidden', empty);
      s.nodes.forEach(function (el) { el.classList.toggle('hidden', empty); });
    });
    countEl.textContent = shown + ' of ' + total;
    noResEl.classList.toggle('hidden', anyVisible > 0);
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.field) p.set('field', state.field);
    if (state.term) p.set('term', state.term);
    if (state.type) p.set('type', state.type);
    if (state.hideClosed) p.set('open', '1');
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname);
  }

  function countFor(key, val) {
    var n = 0;
    sections.forEach(function (s) {
      if (s.info) return;
      s.rows.forEach(function (r) {
        if (!r.deep && r[key].indexOf(val) !== -1) n++;
      });
    });
    return n;
  }

  function group(label, items, key, stateKey) {
    var wrap = document.createElement('div');
    wrap.className = 'fgroup';
    var lab = document.createElement('span');
    lab.className = 'flabel'; lab.textContent = label;
    wrap.appendChild(lab);
    items.forEach(function (it) {
      var n = countFor(key, it[0]);
      if (!n) return;
      var b = document.createElement('button');
      b.className = 'chip'; b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.dataset.val = it[0]; b.dataset.key = stateKey;
      b.innerHTML = it[1] + '<span class="n">' + n + '</span>';
      b.addEventListener('click', function () {
        state[stateKey] = state[stateKey] === it[0] ? null : it[0];
        wrap.querySelectorAll('.chip').forEach(function (c) {
          c.setAttribute('aria-pressed', String(c.dataset.val === state[stateKey]));
        });
        apply();
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  var bar = document.createElement('div');
  bar.className = 'filters';
  bar.innerHTML =
    '<div class="fsearch">' +
      '<input type="search" id="q" placeholder="Search company, role, or city. Try palantir, product, remote, austin" aria-label="Search roles">' +
      '<span class="fcount" id="fcount"></span>' +
      '<button class="fclear" type="button" id="fclear">Reset</button>' +
    '</div>';
  bar.appendChild(group('Field', FIELDS, 'fields', 'field'));
  bar.appendChild(group('Term', TERMS, 'terms', 'term'));
  bar.appendChild(group('Type', TYPES, 'types', 'type'));

  var openWrap = document.createElement('div');
  openWrap.className = 'fgroup';
  openWrap.innerHTML = '<span class="flabel">Status</span>';
  var openBtn = document.createElement('button');
  openBtn.className = 'chip'; openBtn.type = 'button';
  openBtn.setAttribute('aria-pressed', 'false');
  openBtn.textContent = 'Hide closed';
  openBtn.addEventListener('click', function () {
    state.hideClosed = !state.hideClosed;
    openBtn.setAttribute('aria-pressed', String(state.hideClosed));
    apply();
  });
  openWrap.appendChild(openBtn);

  var dismissBtn = root.document.createElement('button');
  dismissBtn.className = 'chip'; dismissBtn.type = 'button';
  dismissBtn.setAttribute('aria-pressed', 'true');
  dismissBtn.textContent = 'Hide dismissed';
  dismissBtn.addEventListener('click', function () {
    state.hideDismissed = !state.hideDismissed;
    dismissBtn.setAttribute('aria-pressed', String(state.hideDismissed));
    apply();
  });
  openWrap.appendChild(dismissBtn);

  bar.appendChild(openWrap);

  var sub = document.querySelector('.sub');
  sub.parentNode.insertBefore(bar, sub.nextSibling);

  noResEl = document.createElement('p');
  noResEl.className = 'noresult hidden';
  noResEl.textContent = 'Nothing matches those filters. Try clearing one.';
  bar.parentNode.insertBefore(noResEl, bar.nextSibling);

  countEl = document.getElementById('fcount');
  var input = document.getElementById('q');
  var t;
  input.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(function () { state.q = input.value.trim().toLowerCase(); apply(); }, 120);
  });
  document.getElementById('fclear').addEventListener('click', function () {
    state = { q: '', field: null, term: null, type: null, hideClosed: false, hideDismissed: true };
    input.value = '';
    bar.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
    // Hide dismissed defaults on, unlike every other chip, so Reset restores
    // that default instead of folding it into the generic all-off sweep.
    dismissBtn.setAttribute('aria-pressed', 'true');
    apply();
  });

  // Restore filters from the URL so a filtered view can be shared as a link.
  var init = new URLSearchParams(location.hash.slice(1));
  if (init.get('q')) { state.q = init.get('q').toLowerCase(); input.value = init.get('q'); }
  ['field', 'term', 'type'].forEach(function (k) {
    if (init.get(k)) {
      state[k] = init.get(k);
      var c = bar.querySelector('.chip[data-key="' + k + '"][data-val="' + init.get(k) + '"]');
      if (c) c.setAttribute('aria-pressed', 'true');
    }
  });
  if (init.get('open')) { state.hideClosed = true; openBtn.setAttribute('aria-pressed', 'true'); }
  apply();
})(typeof globalThis !== 'undefined' ? globalThis : window);
