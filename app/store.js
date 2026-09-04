;(function (root) {
  'use strict';

  var KEY = 's27.v1';
  var BAK = 's27.v1.bak';
  var VERSION = 1;

  // Storage access throws outright in some private browsing modes, so every
  // call site has to tolerate failure. When it does we keep the session in
  // memory and the UI tells the reader their marks will not persist.
  var memory = null;
  var degraded = false;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function blank() {
    return { v: VERSION, profile: null, lastVisit: null, seen: {}, status: {} };
  }

  function migrate(data) {
    var out = blank();
    if (!data || typeof data !== 'object' || data.v !== VERSION) return out;
    out.profile = data.profile || null;
    out.lastVisit = data.lastVisit || null;
    out.seen = data.seen && typeof data.seen === 'object' ? data.seen : {};
    out.status = data.status && typeof data.status === 'object' ? data.status : {};
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
      memory = migrate(JSON.parse(raw));
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
    isDegraded: isDegraded, reset: reset
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
