;(function (root) {
  'use strict';

  var Match = root.S27.Match;
  var Status = root.S27.Status;
  var doc = root.document;

  var CAP = 15;
  // Below this many genuinely new rows the view backfills, because an almost
  // empty Today reads as a broken page rather than a quiet day.
  var MIN_FRESH = 5;

  var FIELD_LABELS = {};
  (root.S27.RowIndex.FIELDS || []).forEach(function (f) { FIELD_LABELS[f[0]] = f[1]; });

  function pick(rows, profile, store, todayISO) {
    var fresh = [];
    var seen = [];

    rows.forEach(function (r) {
      if (r.info) return;
      if (store.getStatus(r.key)) return;      // already handled
      var m = Match.score(r, profile, todayISO);
      if (m.excluded || m.score < Match.THRESHOLD) return;
      var entry = { row: r, score: m.score, reasons: m.reasons };
      if (store.isSeen(r.key)) seen.push(entry);
      else fresh.push(entry);
    });

    var byScore = function (a, b) { return b.score - a.score; };
    fresh.sort(byScore);
    seen.sort(byScore);

    var out = fresh.slice(0, CAP);
    var backfill = out.length < MIN_FRESH ? seen.slice(0, CAP - out.length) : [];
    return { fresh: out, backfill: backfill };
  }

  function reasonText(reasons) {
    var parts = [];
    reasons.forEach(function (r) {
      if (r.t === 'fields') {
        parts.push(r.v.map(function (k) { return FIELD_LABELS[k] || k; }).join(' and '));
      } else if (r.t === 'fresh') {
        parts.push(r.v === 0 ? 'posted today' : 'posted ' + r.v + (r.v === 1 ? ' day ago' : ' days ago'));
      } else if (r.t === 'vetted') {
        parts.push('hand-checked');
      }
    });
    return parts.join(' · ');
  }

  function card(entry, onChange) {
    var r = entry.row;
    var el = doc.createElement('div');
    el.className = 'tcard';

    var head = doc.createElement('div');
    head.className = 'tcard-head';
    head.innerHTML = '<span class="tcard-co"></span><span class="tcard-title"></span>';
    head.querySelector('.tcard-co').textContent = r.co;
    head.querySelector('.tcard-title').textContent = r.title;
    el.appendChild(head);

    var meta = doc.createElement('div');
    meta.className = 'tcard-meta';
    meta.textContent = [r.loc, reasonText(entry.reasons)].filter(Boolean).join(' · ');
    el.appendChild(meta);

    var actions = doc.createElement('div');
    actions.className = 'tcard-actions';
    if (r.url) {
      var a = doc.createElement('a');
      a.className = 'tcard-apply';
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open';
      actions.appendChild(a);
    }
    actions.appendChild(Status.controlsFor(r, onChange));
    el.appendChild(actions);
    return el;
  }

  // Rebuilds a stored short list from its keys. A key with no row left on the
  // page is dropped, because a later refresh can prune the row away. A key the
  // reader has since acted on is dropped too, so a handled card leaves the
  // list on the next load.
  //
  // The rows are scored again rather than replayed from stored reasons, so the
  // meta line stays true to today's date. listFor only calls this for the
  // profile that picked the list, so nothing here can be an excluded row.
  function restore(rows, keys, profile, store, todayISO) {
    var byKey = {};
    rows.forEach(function (r) { if (!byKey[r.key]) byKey[r.key] = r; });
    var out = [];
    keys.forEach(function (k) {
      var r = byKey[k];
      if (!r || store.getStatus(k)) return;
      var m = Match.score(r, profile, todayISO);
      out.push({ row: r, score: m.score, reasons: m.reasons });
    });
    return out;
  }

  function keysOf(list) {
    return list.map(function (e) { return e.row.key; });
  }

  // The day's list is picked once and then persisted. Picking on every render
  // burned the queue a page load at a time, because rendering marks rows seen
  // and pick() routes seen rows out of the fresh list. Eight reloads emptied a
  // 90 row pool with no overlap and no way back.
  //
  // A stored list belongs to the profile that picked it. Replaying it for an
  // edited profile handed the reader back the same cards, hard excluded and
  // scoring zero, with the match reasons gone from the meta line. A reader
  // edits because the old rules were wrong, so an edit picks again. Same
  // profile and same day still means the same cards.
  function listFor(rows, profile, store, todayISO) {
    var fp = Match.profileKey(profile);
    var stored = store.getPicks(todayISO, fp);
    if (stored) {
      return {
        fresh: restore(rows, stored.fresh, profile, store, todayISO),
        backfill: restore(rows, stored.back, profile, store, todayISO)
      };
    }
    var picked = pick(rows, profile, store, todayISO);
    store.setPicks(todayISO, fp, keysOf(picked.fresh), keysOf(picked.backfill));
    return picked;
  }

  function render(mount, rows, profile, todayISO, onChange) {
    var store = root.S27.Store;
    var picked = listFor(rows, profile, store, todayISO);

    var box = doc.createElement('section');
    box.className = 'today';

    function redraw() {
      box.innerHTML = '';
      var h = doc.createElement('h2');
      h.className = 'today-h';
      h.textContent = picked.fresh.length
        ? picked.fresh.length + (picked.fresh.length === 1 ? ' role' : ' roles') + ' new for you'
        : 'Nothing new for you today';
      box.appendChild(h);

      if (!picked.fresh.length && !picked.backfill.length) {
        var p = doc.createElement('p');
        p.className = 'today-empty';
        p.textContent = 'Nothing new matched your profile. Browse the full index below, or widen your profile.';
        box.appendChild(p);
      }

      picked.fresh.forEach(function (e) { box.appendChild(card(e, handleChange)); });

      if (picked.backfill.length) {
        var h3 = doc.createElement('h3');
        h3.className = 'today-sub';
        h3.textContent = 'Also worth a look';
        box.appendChild(h3);
        picked.backfill.forEach(function (e) { box.appendChild(card(e, handleChange)); });
      }
    }

    function handleChange() {
      redraw();
      if (onChange) onChange();
    }

    redraw();
    mount.appendChild(box);

    // Marking seen after render, not on click, so a row a reader ignored today
    // does not come back tomorrow pretending to be new.
    picked.fresh.forEach(function (e) { store.markSeen(e.row.key); });
    picked.backfill.forEach(function (e) { store.markSeen(e.row.key); });

    return box;
  }

  root.S27 = root.S27 || {};
  root.S27.Today = {
    pick: pick, restore: restore, listFor: listFor, render: render,
    CAP: CAP, MIN_FRESH: MIN_FRESH
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
