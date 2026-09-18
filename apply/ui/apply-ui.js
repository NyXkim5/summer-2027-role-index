;(function (root) {
  'use strict';

  var doc = root.document;

  var SUPPORTED = ['greenhouse', 'lever', 'ashby'];
  // Spec: queued -> parked -> submitted, plus terminal skipped, blocked,
  // unsupported. Only queued and parked still take input from this UI.
  var TERMINAL = ['submitted', 'skipped', 'blocked', 'unsupported'];
  // Parked items are the ones waiting on a human click, so they pin to the top.
  var STATUS_ORDER = ['parked', 'queued', 'blocked', 'unsupported', 'submitted', 'skipped'];

  var PROFILE_FIELDS = [
    ['name', 'Full name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['location', 'Location'],
    ['school', 'School'],
    ['degree', 'Degree'],
    ['major', 'Major'],
    ['grade_level', 'Grade level'],
    ['gpa', 'GPA'],
    ['grad_date', 'Graduation date'],
    ['linkedin', 'LinkedIn URL'],
    ['github', 'GitHub URL'],
    ['portfolio', 'Portfolio URL'],
    ['work_authorization', 'Work authorization'],
    ['requires_sponsorship', 'Requires sponsorship'],
    ['veteran_status', 'Veteran status'],
    ['disability_status', 'Disability status'],
    ['gender', 'Gender'],
    ['race_ethnicity', 'Race / ethnicity']
  ];

  /* --- pure logic, covered by apply-ui.test.js --------------------------- */

  function parseTags(input) {
    var out = [];
    String(input || '').split(',').forEach(function (t) {
      var tag = t.trim().toLowerCase();
      if (tag && out.indexOf(tag) === -1) out.push(tag);
    });
    return out;
  }

  function splitUrls(text) {
    var out = [];
    String(text || '').split(/[\s,]+/).forEach(function (u) {
      var url = u.trim();
      if (/^https?:\/\//i.test(url) && out.indexOf(url) === -1) out.push(url);
    });
    return out;
  }

  function isTerminal(status) {
    return TERMINAL.indexOf(status) !== -1;
  }

  // The three gates the applying agent needs before "work the queue" can do
  // anything useful. Computed from the three GET payloads, no extra API.
  function readiness(profile, library, queue) {
    var p = profile || {};
    var resumes = (library && library.resumes) || [];
    var items = (queue && queue.items) || [];
    function filled(v) { return typeof v === 'string' && v.trim() !== ''; }
    var checks = [
      {
        key: 'profile', tab: 'profile',
        ok: filled(p.name) && filled(p.email) && filled(p.phone) && filled(p.location),
        label: 'Profile has name, email, phone, and location'
      },
      {
        key: 'resumes', tab: 'resumes',
        ok: resumes.some(function (r) { return !!(r.tags && r.tags.length); }),
        label: 'At least one resume with tags'
      },
      {
        key: 'queue', tab: 'queue',
        ok: items.length > 0,
        label: 'At least one job URL queued'
      }
    ];
    return { checks: checks, ready: checks.every(function (c) { return c.ok; }) };
  }

  // One line after a paste. Accepts either a bare array of added items or an
  // object carrying added plus optional rejected entries with reasons.
  function summarizePost(res) {
    var added = Array.isArray(res) ? res : ((res && (res.added || res.items)) || []);
    var rejected = (!Array.isArray(res) && res && res.rejected) || [];
    var byAts = {};
    var unsupported = 0;
    added.forEach(function (it) {
      if (SUPPORTED.indexOf(it.ats) === -1 || it.status === 'unsupported') unsupported++;
      else byAts[it.ats] = (byAts[it.ats] || 0) + 1;
    });
    var parts = [];
    var atsBits = SUPPORTED.filter(function (a) { return byAts[a]; })
      .map(function (a) { return byAts[a] + ' ' + a; });
    if (atsBits.length) parts.push('Added ' + atsBits.join(', ') + '.');
    if (unsupported) parts.push(unsupported + ' queued as unsupported.');
    if (rejected.length) {
      var byReason = {};
      rejected.forEach(function (r) {
        var why = (r && r.reason) || 'rejected';
        byReason[why] = (byReason[why] || 0) + 1;
      });
      var bits = Object.keys(byReason).map(function (w) { return byReason[w] + ' ' + w; });
      parts.push('Rejected ' + rejected.length + ' (' + bits.join(', ') + ').');
    }
    return parts.length ? parts.join(' ') : 'Nothing added.';
  }

  function groupQueue(items) {
    var list = items || [];
    var groups = [];
    STATUS_ORDER.forEach(function (s) {
      var hits = list.filter(function (it) { return it.status === s; });
      if (hits.length) groups.push({ status: s, items: hits });
    });
    // A status this build does not know still deserves a row on screen.
    var rest = list.filter(function (it) { return STATUS_ORDER.indexOf(it.status) === -1; });
    if (rest.length) groups.push({ status: 'other', items: rest });
    return groups;
  }

  // The agent writes structured notes when it parks an item. They may arrive
  // as an object or as a JSON string, and older items may carry none at all.
  function parkedDetails(item) {
    var notes = item && item.notes;
    if (typeof notes === 'string') {
      try { notes = JSON.parse(notes); } catch (e) { notes = null; }
    }
    if (!notes || typeof notes !== 'object') notes = {};
    return {
      // serve.py validates notes.resume_id. Older shapes may carry
      // resume_used or resume, so accept those too.
      resume: notes.resume_id || notes.resume_used || notes.resume || null,
      fieldsPending: notes.fields_pending || [],
      screeners: notes.screeners_unanswered || []
    };
  }

  // Marks the human may set from the UI, mirroring serve.py's state
  // machine: parked takes submitted or skipped, queued takes skipped only.
  function markOptions(status) {
    if (status === 'parked') return [['submitted', 'Submitted'], ['skipped', 'Skipped']];
    if (status === 'queued') return [['skipped', 'Skipped']];
    return [];
  }

  function resumeOptions(resumes, item) {
    return (resumes || []).map(function (r) {
      return { id: r.id, label: r.label, selected: !!item && item.resume_id === r.id };
    });
  }

  function pinnedLabel(resumes, item) {
    if (!item || !item.resume_id) return null;
    var hit = (resumes || []).filter(function (r) { return r.id === item.resume_id; })[0];
    return hit ? hit.label : item.resume_id;
  }

  function pinPayload(resumeId) {
    return { resume_id: resumeId };
  }

  function buildProfile(values, customRows) {
    var out = {};
    PROFILE_FIELDS.forEach(function (f) {
      out[f[0]] = String(values[f[0]] || '').trim();
    });
    var custom = {};
    (customRows || []).forEach(function (row) {
      var k = String(row.key || '').trim();
      if (k) custom[k] = String(row.value || '').trim();
    });
    out.custom = custom;
    return out;
  }

  /* --- fetch layer ------------------------------------------------------- */

  function parseResponse(r) {
    return r.text().then(function (text) {
      var data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = null; }
      }
      if (!r.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + r.status);
      return data;
    });
  }

  function api(method, path, body) {
    var opts = { method: method };
    if (root.FormData && body instanceof root.FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return root.fetch(path, opts).then(parseResponse);
  }

  /* --- rendering --------------------------------------------------------- */

  var state = { profile: null, library: { resumes: [] }, queue: { items: [] } };
  var currentTab = 'resumes';
  var TABS = [['resumes', 'Resumes'], ['profile', 'Profile'], ['queue', 'Queue']];

  function say(text, isError) {
    var el = doc.getElementById('apply-msg');
    el.textContent = text;
    el.classList.toggle('err', !!isError);
    el.classList.remove('hidden');
  }

  function fail(err) {
    say(err && err.message ? err.message : String(err), true);
  }

  function btn(text, onClick) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'sbtn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function note(mount, text) {
    var p = doc.createElement('p');
    p.className = 'note';
    p.textContent = text;
    mount.appendChild(p);
  }

  function loadAll() {
    return Promise.all([
      api('GET', '/api/profile'),
      api('GET', '/api/library'),
      api('GET', '/api/queue')
    ]).then(function (res) {
      state.profile = res[0] || null;
      state.library = res[1] || { resumes: [] };
      state.queue = res[2] || { items: [] };
    });
  }

  function refresh() {
    return loadAll().then(renderAll);
  }

  function selectTab(name) {
    currentTab = name;
    doc.querySelectorAll('#tabs .chip').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.val === name));
    });
    TABS.forEach(function (t) {
      doc.getElementById('panel-' + t[0]).classList.toggle('hidden', t[0] !== name);
    });
  }

  function renderTabs() {
    var mount = doc.getElementById('tabs');
    TABS.forEach(function (t) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.val = t[0];
      b.textContent = t[1];
      b.setAttribute('aria-pressed', String(t[0] === currentTab));
      b.addEventListener('click', function () { selectTab(t[0]); });
      mount.appendChild(b);
    });
  }

  function renderReady() {
    var mount = doc.getElementById('ready');
    mount.textContent = '';
    var r = readiness(state.profile, state.library, state.queue);
    r.checks.forEach(function (c) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'chip rchip';
      b.dataset.val = c.tab;
      b.setAttribute('aria-pressed', String(c.ok));
      b.textContent = (c.ok ? '✓ ' : '→ ') + c.label;
      b.addEventListener('click', function () { selectTab(c.tab); });
      mount.appendChild(b);
    });
    var next = doc.createElement('span');
    next.className = 'rnext';
    next.textContent = r.ready
      ? 'All set. Tell Claude Code: "work the queue".'
      : 'Finish the steps above, then tell Claude Code: "work the queue".';
    mount.appendChild(next);
  }

  /* --- resumes tab ------------------------------------------------------- */

  function paintResume(card, r) {
    card.textContent = '';
    var head = doc.createElement('div');
    head.className = 'card-head';
    var label = doc.createElement('strong');
    label.textContent = r.label;
    head.appendChild(label);
    var file = doc.createElement('span');
    file.className = 'mut';
    file.textContent = r.file || '';
    head.appendChild(file);
    card.appendChild(head);
    var tags = doc.createElement('div');
    tags.className = 'tags';
    (r.tags || []).forEach(function (t) {
      var el = doc.createElement('span');
      el.className = 'tag';
      el.textContent = t;
      tags.appendChild(el);
    });
    card.appendChild(tags);
    var actions = doc.createElement('div');
    actions.className = 'actions';
    actions.appendChild(btn('Edit', function () { paintResumeEdit(card, r); }));
    actions.appendChild(btn('Delete', function () {
      api('DELETE', '/api/resumes/' + r.id).then(refresh).catch(fail);
    }));
    card.appendChild(actions);
  }

  function paintResumeEdit(card, r) {
    card.textContent = '';
    var label = doc.createElement('input');
    label.type = 'text';
    label.value = r.label;
    label.setAttribute('aria-label', 'Label');
    var tags = doc.createElement('input');
    tags.type = 'text';
    tags.value = (r.tags || []).join(', ');
    tags.setAttribute('aria-label', 'Tags');
    card.appendChild(label);
    card.appendChild(tags);
    var actions = doc.createElement('div');
    actions.className = 'actions';
    actions.appendChild(btn('Save', function () {
      api('PUT', '/api/resumes/' + r.id, { label: label.value.trim(), tags: parseTags(tags.value) })
        .then(refresh).catch(fail);
    }));
    actions.appendChild(btn('Cancel', function () { paintResume(card, r); }));
    card.appendChild(actions);
  }

  function renderResumes() {
    var mount = doc.getElementById('resume-cards');
    mount.textContent = '';
    var resumes = (state.library && state.library.resumes) || [];
    if (!resumes.length) return note(mount, 'No resumes yet. Upload one above.');
    resumes.forEach(function (r) {
      var card = doc.createElement('div');
      card.className = 'card';
      paintResume(card, r);
      mount.appendChild(card);
    });
  }

  function uploadResume(e) {
    e.preventDefault();
    var fileInput = doc.getElementById('r-file');
    var file = fileInput.files && fileInput.files[0];
    if (!file) return say('Pick a PDF first.', true);
    var labelInput = doc.getElementById('r-label');
    var tagsInput = doc.getElementById('r-tags');
    var fd = new root.FormData();
    fd.append('file', file);
    fd.append('label', labelInput.value.trim() || file.name.replace(/\.pdf$/i, ''));
    fd.append('tags', parseTags(tagsInput.value).join(', '));
    api('POST', '/api/resumes', fd).then(function (entry) {
      fileInput.value = '';
      labelInput.value = '';
      tagsInput.value = '';
      say('Added ' + ((entry && entry.label) || 'resume') + '.');
      return refresh();
    }).catch(fail);
  }

  /* --- profile tab ------------------------------------------------------- */

  function customRow(k, v) {
    var row = doc.createElement('div');
    row.className = 'crow';
    var key = doc.createElement('input');
    key.type = 'text';
    key.className = 'ckey';
    key.placeholder = 'Field, for example clearance';
    key.value = k;
    var val = doc.createElement('input');
    val.type = 'text';
    val.className = 'cval';
    val.placeholder = 'Value';
    val.value = v;
    row.appendChild(key);
    row.appendChild(val);
    row.appendChild(btn('Remove', function () { row.parentNode.removeChild(row); }));
    return row;
  }

  // Filled once at load. Later refreshes leave the inputs alone so a reader's
  // half-typed edit is never clobbered by a queue update.
  function renderProfileForm() {
    var mount = doc.getElementById('profile-fields');
    PROFILE_FIELDS.forEach(function (f) {
      var row = doc.createElement('label');
      row.className = 'frow';
      var span = doc.createElement('span');
      span.textContent = f[1];
      var input = doc.createElement('input');
      input.type = 'text';
      input.id = 'pf-' + f[0];
      input.value = (state.profile && typeof state.profile[f[0]] === 'string')
        ? state.profile[f[0]] : '';
      row.appendChild(span);
      row.appendChild(input);
      mount.appendChild(row);
    });
    var rows = doc.getElementById('custom-rows');
    var custom = (state.profile && state.profile.custom) || {};
    Object.keys(custom).forEach(function (k) { rows.appendChild(customRow(k, custom[k])); });
    if (!Object.keys(custom).length) rows.appendChild(customRow('', ''));
  }

  function saveProfile() {
    var values = {};
    PROFILE_FIELDS.forEach(function (f) {
      values[f[0]] = doc.getElementById('pf-' + f[0]).value;
    });
    var rows = [];
    doc.querySelectorAll('#custom-rows .crow').forEach(function (row) {
      rows.push({
        key: row.querySelector('.ckey').value,
        value: row.querySelector('.cval').value
      });
    });
    api('PUT', '/api/profile', buildProfile(values, rows)).then(function () {
      say('Profile saved.');
      return refresh();
    }).catch(fail);
  }

  /* --- queue tab --------------------------------------------------------- */

  function queueUrls() {
    var box = doc.getElementById('q-urls');
    var urls = splitUrls(box.value);
    if (!urls.length) return say('Paste at least one http(s) URL.', true);
    api('POST', '/api/queue', { urls: urls }).then(function (res) {
      doc.getElementById('q-summary').textContent = summarizePost(res);
      box.value = '';
      return refresh();
    }).catch(fail);
  }

  function pinControl(item) {
    var sel = doc.createElement('select');
    sel.className = 'pin';
    sel.setAttribute('aria-label', 'Pin a resume');
    var none = doc.createElement('option');
    none.value = '';
    none.textContent = item.resume_id ? 'Change resume' : 'Pin a resume';
    sel.appendChild(none);
    resumeOptions(state.library.resumes, item).forEach(function (o) {
      var opt = doc.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      opt.selected = o.selected;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      if (!sel.value) return;
      api('PUT', '/api/queue/' + item.id, pinPayload(sel.value)).then(refresh).catch(fail);
    });
    return sel;
  }

  // Same control shape as app/status.js: sbtn, dataset.val, aria-pressed.
  function markControls(item) {
    var wrap = doc.createElement('span');
    wrap.className = 'status';
    markOptions(item.status).forEach(function (c) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sbtn s-' + c[0];
      b.dataset.val = c[0];
      b.textContent = c[1];
      b.setAttribute('aria-pressed', String(item.status === c[0]));
      b.addEventListener('click', function () {
        api('PUT', '/api/queue/' + item.id, { status: c[0] }).then(refresh).catch(fail);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function parkedBlock(item) {
    var d = parkedDetails(item);
    var box = doc.createElement('ul');
    box.className = 'plist';
    function li(label, value) {
      var el = doc.createElement('li');
      el.textContent = label + ': ' + value;
      box.appendChild(el);
    }
    var hit = (state.library.resumes || []).filter(function (r) {
      return r.id === d.resume;
    })[0];
    li('Resume used', hit ? hit.label : (d.resume || 'not recorded'));
    li('Fields pending', d.fieldsPending.length ? d.fieldsPending.join(', ') : 'none');
    li('Screeners unanswered', d.screeners.length ? d.screeners.join(', ') : 'none');
    return box;
  }

  function queueCard(item) {
    var card = doc.createElement('div');
    card.className = 'card qitem';
    var head = doc.createElement('div');
    head.className = 'card-head';
    var badge = doc.createElement('span');
    badge.className = 'tag st st-' + item.status;
    badge.textContent = item.status;
    head.appendChild(badge);
    if (item.ats) {
      var ats = doc.createElement('span');
      ats.className = 'tag';
      ats.textContent = item.ats;
      head.appendChild(ats);
    }
    var pinned = pinnedLabel(state.library.resumes, item);
    if (pinned) {
      var pin = doc.createElement('span');
      pin.className = 'tag pin-tag';
      pin.textContent = 'resume: ' + pinned;
      head.appendChild(pin);
    }
    var link = doc.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = item.url;
    head.appendChild(link);
    card.appendChild(head);
    if (item.status === 'parked') card.appendChild(parkedBlock(item));
    if (!isTerminal(item.status)) {
      var actions = doc.createElement('div');
      actions.className = 'actions';
      actions.appendChild(pinControl(item));
      actions.appendChild(markControls(item));
      card.appendChild(actions);
    }
    return card;
  }

  function renderQueue() {
    var mount = doc.getElementById('queue-list');
    mount.textContent = '';
    var items = (state.queue && state.queue.items) || [];
    if (!items.length) return note(mount, 'Nothing queued yet. Paste URLs above.');
    groupQueue(items).forEach(function (g) {
      var h = doc.createElement('h3');
      h.className = 'qgroup';
      h.textContent = g.status + ' (' + g.items.length + ')';
      mount.appendChild(h);
      g.items.forEach(function (it) { mount.appendChild(queueCard(it)); });
    });
  }

  /* --- boot -------------------------------------------------------------- */

  function renderAll() {
    renderReady();
    renderResumes();
    renderQueue();
  }

  function init() {
    renderTabs();
    doc.getElementById('resume-form').addEventListener('submit', uploadResume);
    doc.getElementById('q-add').addEventListener('click', queueUrls);
    doc.getElementById('profile-save').addEventListener('click', saveProfile);
    doc.getElementById('custom-add').addEventListener('click', function () {
      doc.getElementById('custom-rows').appendChild(customRow('', ''));
    });
    loadAll().then(function () {
      renderProfileForm();
      renderAll();
    }).catch(fail);
  }

  root.S27 = root.S27 || {};
  root.S27.Apply = {
    parseTags: parseTags,
    splitUrls: splitUrls,
    isTerminal: isTerminal,
    readiness: readiness,
    summarizePost: summarizePost,
    groupQueue: groupQueue,
    parkedDetails: parkedDetails,
    markOptions: markOptions,
    resumeOptions: resumeOptions,
    pinnedLabel: pinnedLabel,
    pinPayload: pinPayload,
    buildProfile: buildProfile,
    PROFILE_FIELDS: PROFILE_FIELDS,
    STATUS_ORDER: STATUS_ORDER
  };

  // The test runner loads this file into a bare document, so only mount the
  // page when the apply UI markup is actually present.
  if (doc && doc.getElementById('apply-root')) init();
})(typeof globalThis !== 'undefined' ? globalThis : window);
