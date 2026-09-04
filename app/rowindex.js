;(function (root) {
  'use strict';

  // Every fact about a row is derived from its own text at runtime, so rows
  // that refresh.py appends are classified with no coordination between the
  // Python and this file.
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

  var INFO = /Recruiting events|no-whiteboard|Trackers &amp; tooling|Trackers & tooling|Build something|Getting seen/i;
  var DEEP = /Deep sweep/i;

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Campaign parameters a board or a tracker bolts on. They vary per visit and
  // never identify a role, so they are stripped. Everything else in the query
  // is kept, because some boards carry the job id there and nowhere else.
  // Greenhouse under a company domain is the common case, with ?gh_jid=.
  var TRACKING = { gh_src: 1, ref: 1, source: 1, trk: 1, src: 1 };

  function isTracking(name) {
    var n = String(name).toLowerCase();
    return n.indexOf('utm_') === 0 || TRACKING[n] === 1;
  }

  // Boards vary on trailing slash and on the www prefix, so the raw href is
  // not a stable identity. Path case is kept because some boards route case
  // sensitively. Surviving query parameters are sorted, so two links that
  // carry the same pair in a different order produce the same key.
  function normalizeUrl(u) {
    if (!u) return null;
    var a;
    try {
      a = new root.URL(u, 'https://placeholder.invalid');
    } catch (e) {
      return null;
    }
    if (a.host === 'placeholder.invalid') return null;
    if (a.protocol !== 'http:' && a.protocol !== 'https:') return null;
    var host = a.host.toLowerCase().replace(/^www\./, '');
    var path = a.pathname.replace(/\/+$/, '');
    var kept = [];
    a.searchParams.forEach(function (v, k) {
      if (!isTracking(k)) kept.push([k, v]);
    });
    kept.sort(function (x, y) {
      if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
      if (x[1] === y[1]) return 0;
      return x[1] < y[1] ? -1 : 1;
    });
    var query = kept.map(function (p) { return p[0] + '=' + p[1]; }).join('&');
    return host + path + (query ? '?' + query : '');
  }

  function titleKey(co, title) {
    return 't:' + slug(co) + '|' + slug(title);
  }

  function keyFor(url, co, title) {
    var n = normalizeUrl(url);
    return n ? 'u:' + n : titleKey(co, title);
  }

  // Date tags read "Sep 1" with no year. Anything that would land in the
  // future belongs to last year, since a board cannot post ahead of today.
  function realDate(year, month, day) {
    var dt = new Date(Date.UTC(year, month - 1, day));
    return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
  }

  function parseTagDate(text, todayISO) {
    var m = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(String(text || '').trim());
    if (!m) return null;
    var mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi === -1) return null;
    var day = parseInt(m[2], 10);
    var year = parseInt(todayISO.slice(0, 4), 10);
    var iso = pad(year) + '-' + pad2(mi + 1) + '-' + pad2(day);
    if (iso > todayISO) {
      year = year - 1;
      iso = pad(year) + '-' + pad2(mi + 1) + '-' + pad2(day);
    }
    if (!realDate(year, mi + 1, day)) return null;
    return iso;
  }

  function pad(n) { return String(n); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function classify(table, text) {
    var out = [];
    for (var i = 0; i < table.length; i++) {
      if (table[i][2].test(text)) out.push(table[i][0]);
    }
    return out;
  }

  function build(doc, todayISO) {
    var sections = [];
    var rows = [];
    var heads = doc.querySelectorAll('h2');

    for (var h = 0; h < heads.length; h++) {
      var h2 = heads[h];
      var nodes = [];
      var n = h2.nextElementSibling;
      while (n && n.tagName !== 'H2') { nodes.push(n); n = n.nextElementSibling; }

      var info = INFO.test(h2.textContent);
      var deep = DEEP.test(h2.textContent);
      var secRows = [];

      for (var i = 0; i < nodes.length; i++) {
        var trs = nodes[i].querySelectorAll ? nodes[i].querySelectorAll('tr') : [];
        for (var j = 0; j < trs.length; j++) {
          var tr = trs[j];
          var coCell = tr.querySelector('td.co');
          if (!coCell) continue;          // header rows carry th, not td.co
          var cells = tr.querySelectorAll('td');
          var locCell = tr.querySelector('td.loc');
          var link = tr.querySelector('a');
          var title = cells.length > 1 ? cells[1].textContent.trim() : '';
          var tagEl = tr.querySelector('.tag.new');
          var text = tr.textContent.replace(/\s+/g, ' ');
          var url = link ? link.getAttribute('href') : null;

          var rec = {
            tr: tr,
            key: keyFor(url, coCell.textContent.trim(), title),
            co: coCell.textContent.trim(),
            title: title,
            loc: locCell ? locCell.textContent.trim() : '',
            url: url,
            date: tagEl ? parseTagDate(tagEl.textContent, todayISO) : null,
            text: text.toLowerCase(),
            fields: classify(FIELDS, text),
            terms: classify(TERMS, text),
            types: classify(TYPES, text),
            closed: !!tr.querySelector('.cl'),
            deep: deep,
            info: info,
            section: h2
          };
          secRows.push(rec);
          rows.push(rec);
        }
      }

      if (!secRows.length) continue;
      sections.push({ h2: h2, nodes: nodes, rows: secRows, info: info, deep: deep });
    }

    resolveCollisions(rows);
    return { rows: rows, sections: sections };
  }

  // Many rows point at one careers page rather than at a job. Zipline lists 67
  // roles that all link to zipline.com/open-roles, and no amount of query
  // handling separates them, because there is no query. For those rows the URL
  // is not an identity, so the whole group falls back to company and title.
  //
  // This runs over the finished index rather than inside keyFor, because a
  // collision is a fact about the page and not about one row. keyFor stays a
  // pure function of the arguments it is given.
  function resolveCollisions(rows) {
    var byKey = Object.create(null);
    var i;
    for (i = 0; i < rows.length; i++) {
      if (!byKey[rows[i].key]) byKey[rows[i].key] = [];
      byKey[rows[i].key].push(rows[i]);
    }
    for (var k in byKey) {
      var group = byKey[k];
      if (group.length < 2) continue;
      for (i = 0; i < group.length; i++) {
        group[i].key = titleKey(group[i].co, group[i].title);
      }
    }
  }

  root.S27 = root.S27 || {};
  root.S27.RowIndex = {
    FIELDS: FIELDS, TERMS: TERMS, TYPES: TYPES,
    slug: slug, normalizeUrl: normalizeUrl, keyFor: keyFor,
    parseTagDate: parseTagDate, build: build
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
