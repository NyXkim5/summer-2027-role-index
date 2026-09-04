;(function (root) {
  'use strict';

  var KEY = 's27.v1';
  var BAK = 's27.v1.bak';
  var VERSION = 2;
  // Every version this build knows how to read. A record from anything else
  // is backed up and discarded rather than half trusted.
  var READABLE = [1, 2];

  // Storage access throws outright in some private browsing modes, so every
  // call site has to tolerate failure. When it does we keep the session in
  // memory and the UI tells the reader their marks will not persist.
  var memory = null;
  var degraded = false;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function blank() {
    return { v: VERSION, profile: null, lastVisit: null, seen: {}, status: {}, picks: null };
  }

  function readable(data) {
    return !!data && typeof data === 'object' && READABLE.indexOf(data.v) !== -1;
  }

  // Version 2 added picks. A version 1 record carries everything else, so it
  // is read forward rather than thrown away.
  function migrate(data) {
    var out = blank();
    if (!readable(data)) return out;
    out.profile = data.profile || null;
    out.lastVisit = data.lastVisit || null;
    out.seen = data.seen && typeof data.seen === 'object' ? data.seen : {};
    out.status = data.status && typeof data.status === 'object' ? data.status : {};
    out.picks = data.picks && typeof data.picks === 'object' ? data.picks : null;
    return out;
  }

  function load() {
    if (memory) return memory;
    var raw = null;
    try {
      raw = root.localStorage.getItem(KEY);
    } catch (e) {
      degraded = true;
    }
    if (!raw) {
      memory = blank();
      return memory;
    }
    try {
      var parsed = JSON.parse(raw);
      if (!readable(parsed)) {
        // Never discard a reader's history without a copy. migrate() is
        // about to drop this record because its schema version does not
        // match, so back the raw string up first, the same as the corrupt
        // JSON path below.
        try { root.localStorage.setItem(BAK, raw); } catch (e2) {}
        degraded = true;
      }
      memory = migrate(parsed);
    } catch (e) {
      // Never discard a reader's history without a copy. Keep the bad string
      // so it can be recovered by hand, then start clean.
      try { root.localStorage.setItem(BAK, raw); } catch (e2) {}
      degraded = true;
      memory = blank();
    }
    return memory;
  }

  function save() {
    if (!memory) return false;
    try {
      root.localStorage.setItem(KEY, JSON.stringify(memory));
      return true;
    } catch (e) {
      degraded = true;
      return false;
    }
  }

  function setStatus(key, s, snap) {
    var d = load();
    if (s === null) delete d.status[key];
    else d.status[key] = { s: s, at: today(), snap: snap };
    save();
  }

  function getStatus(key) {
    return load().status[key] || null;
  }

  function markSeen(key) {
    var d = load();
    if (d.seen[key]) return;
    d.seen[key] = today();
    save();
  }

  function isSeen(key) {
    return !!load().seen[key];
  }

  function setProfile(p) {
    load().profile = p;
    save();
  }

  function getProfile() {
    return load().profile;
  }

  function setLastVisit(dateISO) {
    load().lastVisit = dateISO;
    save();
  }

  function getLastVisit() {
    return load().lastVisit;
  }

  // The short list a reader was shown on a given day. Today renders the stored
  // set again on a reload instead of picking a new one, because picking again
  // burns through the queue a page load at a time.
  function setPicks(dateISO, freshKeys, backKeys) {
    var d = load();
    d.picks = { date: dateISO, fresh: freshKeys, back: backKeys };
    save();
  }

  function getPicks(dateISO) {
    var p = load().picks;
    if (!p || p.date !== dateISO) return null;
    if (!Array.isArray(p.fresh) || !Array.isArray(p.back)) return null;
    return { fresh: p.fresh, back: p.back };
  }

  function isDegraded() {
    return degraded;
  }

  // Drops the in-memory copy so the next load re-reads storage. Tests use this
  // to simulate a fresh page load.
  function reset() {
    memory = null;
    degraded = false;
  }

  root.S27 = root.S27 || {};
  root.S27.Store = {
    KEY: KEY, BAK: BAK, VERSION: VERSION,
    blank: blank, migrate: migrate, load: load, save: save,
    setStatus: setStatus, getStatus: getStatus,
    markSeen: markSeen, isSeen: isSeen,
    setProfile: setProfile, getProfile: getProfile,
    setLastVisit: setLastVisit, getLastVisit: getLastVisit,
    setPicks: setPicks, getPicks: getPicks,
    isDegraded: isDegraded, reset: reset
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
