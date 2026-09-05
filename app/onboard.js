;(function (root) {
  'use strict';

  var Store = root.S27.Store;
  var RI = root.S27.RowIndex;
  var doc = root.document;

  var draft = null;
  var cb = null;

  function isComplete(p) {
    return !!(p && p.fields && p.fields.length);
  }

  function blankDraft() {
    return { fields: [], term: null, types: [] };
  }

  function toggleMulti(list, val) {
    var i = list.indexOf(val);
    if (i === -1) list.push(val);
    else list.splice(i, 1);
  }

  function selected(groupName, val) {
    var v = draft[groupName];
    return Array.isArray(v) ? v.indexOf(val) !== -1 : v === val;
  }

  function group(label, table, groupName, multi) {
    var wrap = doc.createElement('div');
    wrap.className = 'ob-group';
    wrap.dataset.group = groupName;
    var lab = doc.createElement('span');
    lab.className = 'flabel';
    lab.textContent = label;
    wrap.appendChild(lab);

    table.forEach(function (it) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.val = it[0];
      b.textContent = it[1];
      b.setAttribute('aria-pressed', String(selected(groupName, it[0])));
      b.addEventListener('click', function () {
        if (multi) toggleMulti(draft[groupName], it[0]);
        else draft[groupName] = draft[groupName] === it[0] ? null : it[0];
        wrap.querySelectorAll('button').forEach(function (o) {
          o.setAttribute('aria-pressed', String(selected(groupName, o.dataset.val)));
        });
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function save() {
    Store.setProfile({ fields: draft.fields, term: draft.term, types: draft.types });
    if (cb) cb(Store.getProfile());
  }

  function skip() {
    Store.setProfile({ fields: [], term: null, types: [], skipped: true });
    if (cb) cb(Store.getProfile());
  }

  function render(mount, onSave) {
    cb = onSave;
    var saved = Store.getProfile();
    draft = saved
      ? { fields: (saved.fields || []).slice(), term: saved.term || null, types: (saved.types || []).slice() }
      : blankDraft();

    var box = doc.createElement('div');
    box.className = 'onboard';
    box.innerHTML = '<p class="ob-lead">Tell the page who you are and it will show you what is worth opening today.</p>';
    box.appendChild(group('I study', RI.FIELDS, 'fields', true));
    box.appendChild(group('I want', RI.TERMS, 'term', false));
    box.appendChild(group('Level', RI.TYPES, 'types', true));

    var actions = doc.createElement('div');
    actions.className = 'ob-actions';
    var saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ob-save';
    saveBtn.textContent = 'Show me my list';
    saveBtn.addEventListener('click', save);
    var skipBtn = doc.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'ob-skip';
    skipBtn.textContent = 'Just show everything';
    skipBtn.addEventListener('click', skip);
    actions.appendChild(saveBtn);
    actions.appendChild(skipBtn);
    box.appendChild(actions);

    mount.appendChild(box);
    return box;
  }

  root.S27 = root.S27 || {};
  root.S27.Onboard = { isComplete: isComplete, render: render, save: save, skip: skip };
})(typeof globalThis !== 'undefined' ? globalThis : window);
