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

  // Boards append tracking parameters and vary on trailing slash and on the
  // www prefix, so the raw href is not a stable identity. Path case is kept
  // because some boards route case sensitively.
  function normalizeUrl(u) {
    if (!u) return null;
    var a;
    try {
      a = new root.URL(u, 'https://placeholder.invalid');
    } catch (e) {
      return null;
    }
    if (a.host === 'placeholder.invalid') return null;
    var host = a.host.toLowerCase().replace(/^www\./, '');
    var path = a.pathname.replace(/\/+$/, '');
    return host + path;
  }

  function keyFor(url, co, title) {
    var n = normalizeUrl(url);
    return n ? 'u:' + n : 't:' + slug(co) + '|' + slug(title);
  }

  // Date tags read "Sep 1" with no year. Anything that would land in the
  // future belongs to last year, since a board cannot post ahead of today.
  function parseTagDate(text, todayISO) {
    var m = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(String(text || '').trim());
    if (!m) return null;
    var mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi === -1) return null;
    var day = parseInt(m[2], 10);
    var year = parseInt(todayISO.slice(0, 4), 10);
    var iso = pad(year) + '-' + pad2(mi + 1) + '-' + pad2(day);
    if (iso > todayISO) {
      iso = pad(year - 1) + '-' + pad2(mi + 1) + '-' + pad2(day);
    }
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

    return { rows: rows, sections: sections };
  }

  root.S27 = root.S27 || {};
  root.S27.RowIndex = {
    FIELDS: FIELDS, TERMS: TERMS, TYPES: TYPES,
    slug: slug, normalizeUrl: normalizeUrl, keyFor: keyFor,
    parseTagDate: parseTagDate, build: build
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
