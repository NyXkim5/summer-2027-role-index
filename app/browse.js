(function () {
  // Everything is derived from the row text at runtime. The daily refresh
  // script knows nothing about this UI, so rows it appends are filterable
  // automatically with no coordination between the two.
  var FIELDS = [
    ['swe',      'Software',        /software engineer|\bswe\b|programmer|developer|full.?stack|backend|front.?end|firmware|embedded|infrastructure|devops|\bsre\b|security engineer|platform engineer/i],
    ['data',     'Data / AI / ML',  /data scien|data engineer|data analy|machine learning|\bml\b|\bai\b|analytics|artificial intelligence|research scientist|applied scien|quantitative research/i],
    ['product',  'Product / Design',/product manage|product market|product owner|product analyst|product develop|product design|\bapm\b|program manage|\bux\b|designer|design engineer/i],
    ['business', 'Business / Ops',  /business|operations|\bops\b|strateg|growth|\bgtm\b|go.to.market|partnership|marketing|sales|supply chain|procurement|sourcing|consult|deployment strategist|revenue|customer|community|people |talent|recruit/i],
    ['finance',  'Finance',         /financ|accounting|\baudit\b|\btax\b|treasury|investment bank|capital markets|wealth|actuar|fp&a|valuation/i],
    ['quant',    'Quant / Math',    /quant|trading|trader|statistic|mathemat|risk analy/i],
    ['hardware', 'Hardware / EE',   /electrical|hardware|\basic\b|\bfpga\b|silicon|avionics|\brf\b|power electronics|\bpcb\b|circuit/i],
    ['mecheng',  'Mech / Aero',     /mechanical|aerospace|\baero\b|propulsion|thermal|manufactur|materials|robotic|mechatronic|\bcad\b|design engineer|test engineer|vehicle|powertrain|\bhvac\b/i],
    ['civil',    'Civil / Struct',  /civil|structural|geotechnical|construction|transportation engineer|survey|water resources|environmental engineer|bridge|highway|site (engineer|design)/i],
    ['chem',     'Chemical / Bio',  /chemical engineer|process engineer|biomed|bioengineer|biotech|pharma|formulation|\bchem\b/i],
    ['nuclear',  'Energy / Nuclear',/nuclear|reactor|energy|grid|utility|power systems|renewable|solar|battery|electrochem/i],
    ['policy',   'Policy / Legal',  /policy|legal|counsel|compliance|regulat|trust & safety|trust and safety|privacy/i]
  ];
  var TERMS = [
    ['sum27', 'Summer 2027', /summer 2027|summer, 2027|2027 summer|summer27/i],
    ['spr27', 'Spring 2027', /spring 2027|winter 2027|jan(uary)? 2027/i],
    ['fall26', 'Fall 2026',  /fall 2026|autumn 2026/i]
  ];
  var TYPES = [
    ['intern',  'Internship', /intern|co-?op|summer analyst|student worker|residency|resident\b|apprentice/i],
    ['newgrad', 'New grad',   /new ?grad|new graduate|new college grad|graduate (program|analyst|engineer|scientist|associate|developer|manager)|full time analyst|entry.?level|early career|associate\b|leadership development|rotational|pathways|\bi\b$/i]
  ];

  // Sections that are reference material, not job rows. Search still reaches
  // them, but field and term chips must not silently hide them.
  var INFO = /Recruiting events|no-whiteboard|Trackers &amp; tooling|Trackers & tooling|Build something|Getting seen/i;
  // Wide-net rows are filterable but unvetted, so they are excluded from the
  // "N of M" denominator to keep it a count of hand-checked roles.
  var NOCOUNT = /Deep sweep/i;

  var sections = [];
  document.querySelectorAll('h2').forEach(function (h2) {
    var nodes = [], n = h2.nextElementSibling;
    while (n && n.tagName !== 'H2') { nodes.push(n); n = n.nextElementSibling; }
    var rows = [];
    nodes.forEach(function (el) {
      el.querySelectorAll && el.querySelectorAll('tr').forEach(function (tr) {
        if (tr.querySelector('td')) rows.push(tr);
      });
    });
    if (!rows.length) return;
    var info = INFO.test(h2.textContent);
    var nocount = NOCOUNT.test(h2.textContent);
    rows.forEach(function (tr) {
      var text = tr.textContent.replace(/\s+/g, ' ');
      var fields = [];
      FIELDS.forEach(function (f) { if (f[2].test(text)) fields.push(f[0]); });
      var terms = [];
      TERMS.forEach(function (t) { if (t[2].test(text)) terms.push(t[0]); });
      var types = [];
      TYPES.forEach(function (t) { if (t[2].test(text)) types.push(t[0]); });
      tr._f = { text: text.toLowerCase(), fields: fields, terms: terms, types: types,
                closed: !!tr.querySelector('.cl'), info: info, nocount: nocount };
    });
    sections.push({ h2: h2, nodes: nodes, rows: rows, info: info, nocount: nocount });
  });

  var state = { q: '', field: null, term: null, type: null, hideClosed: false };

  function matches(tr) {
    var f = tr._f;
    if (state.q && f.text.indexOf(state.q) === -1) return false;
    if (state.hideClosed && f.closed) return false;
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
      s.rows.forEach(function (tr) {
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
      s.rows.forEach(function (tr) {
        if (!tr._f.nocount && tr._f[key].indexOf(val) !== -1) n++;
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
    state = { q: '', field: null, term: null, type: null, hideClosed: false };
    input.value = '';
    bar.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
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
})();
