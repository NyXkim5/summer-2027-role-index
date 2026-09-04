;(function (root) {
  'use strict';

  // A single field match clears the bar. Everything below this is noise for
  // the reader who set a profile.
  var THRESHOLD = 3;

  var W_FIELD = 3;
  var W_FRESH = 2;
  var W_VETTED = 1;
  var FRESH_DAYS = 7;

  function daysOld(dateISO, todayISO) {
    if (!dateISO) return null;
    var a = Date.parse(dateISO + 'T00:00:00Z');
    var b = Date.parse(todayISO + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  // Hard excludes are the only rules that remove a row. Everything else ranks.
  // A reader who picks Software still wants to see a forward deployed engineer
  // role, because job titles do not use the words readers use.
  //
  // A row that carries no signal at all for a dimension is never excluded on
  // that dimension. Absence of evidence is not a conflict.
  function score(row, profile, todayISO) {
    var reasons = [];
    if (row.closed) return { score: 0, excluded: 'closed', reasons: reasons };
    if (!profile) return { score: 0, excluded: null, reasons: reasons };

    if (profile.term && row.terms.length && row.terms.indexOf(profile.term) === -1) {
      return { score: 0, excluded: 'term', reasons: reasons };
    }

    var wanted = profile.types || [];
    if (wanted.length && row.types.length) {
      var hit = false;
      for (var i = 0; i < wanted.length; i++) {
        if (row.types.indexOf(wanted[i]) !== -1) { hit = true; break; }
      }
      if (!hit) return { score: 0, excluded: 'type', reasons: reasons };
    }

    var n = 0;
    var fields = profile.fields || [];
    var overlap = [];
    for (var j = 0; j < fields.length; j++) {
      if (row.fields.indexOf(fields[j]) !== -1) overlap.push(fields[j]);
    }
    if (overlap.length) {
      n += W_FIELD * overlap.length;
      reasons.push({ t: 'fields', v: overlap });
    }

    var age = daysOld(row.date, todayISO);
    if (age !== null && age >= 0 && age <= FRESH_DAYS) {
      n += W_FRESH;
      reasons.push({ t: 'fresh', v: age });
    }

    if (!row.deep) {
      n += W_VETTED;
      reasons.push({ t: 'vetted' });
    }

    return { score: n, excluded: null, reasons: reasons };
  }

  root.S27 = root.S27 || {};
  root.S27.Match = {
    THRESHOLD: THRESHOLD, W_FIELD: W_FIELD, W_FRESH: W_FRESH,
    W_VETTED: W_VETTED, FRESH_DAYS: FRESH_DAYS,
    daysOld: daysOld, score: score
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
