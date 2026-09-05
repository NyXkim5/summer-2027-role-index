# Role Index Triage Views, Phase 1, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `index.html` from a 528-row browsing list into a triage tool that remembers who is reading it, what they have already handled, and what is new to them.

**Architecture:** The client moves out of `index.html` into classic browser scripts under `app/`, each attaching one object to a `window.S27` namespace. There is no bundler and no build step. Reader state lives in `localStorage` under a single versioned key. `refresh.py` keeps doing string surgery on the HTML and learns nothing about the UI, which is the decoupling that makes the daily cron safe.

**Tech Stack:** Vanilla ES5-compatible browser JavaScript, no framework. Vitest with the jsdom environment for the client tests. pytest for `refresh.py`. pnpm for package management. GitHub Actions for CI.

**Spec:** `docs/superpowers/specs/2026-09-03-triage-views-design.md`

## Global Constraints

- Vanilla JS only. No bundler, no TypeScript, no build step. The page must keep working when opened directly over `file://`.
- Scripts load as classic `<script src>` tags, never ES modules, because modules fail under `file://`.
- Every module wraps itself in an IIFE and attaches to `window.S27`. No module ever uses `import`, `export`, or `module.exports`.
- `refresh.py` must never write new markup inside a `<tr>`. Status badges are injected by the client at runtime and never reach the committed file.
- All persistent chrome renders outside the tables.
- Storage key is `s27.v1`. Backup key is `s27.v1.bak`. Schema version is `1`.
- The Today score threshold is `3` and lives in one named constant.
- Prose in comments and docs uses no em dashes and no semicolons. Short sentences. Active voice.
- Use `pnpm`, never `npm` or `yarn`.
- Commit messages use imperative present tense and match the repo's existing style, for example "Add live search and field/term/type filters". No Co-Authored-By lines.
- Never leave `console.log` in shipped code.

---

### Task 1: Test harness and `store.js`

The reader state module plus the harness that proves a browser classic script can be tested in Node without a build step.

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `app/test-helpers.js`
- Create: `app/store.js`
- Create: `app/store.test.js`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `window.S27.Store` with `load()`, `save()`, `blank()`, `migrate(data)`, `setStatus(key, s, snap)`, `getStatus(key)`, `markSeen(key)`, `isSeen(key)`, `setProfile(p)`, `getProfile()`, `isDegraded()`, `reset()`, and the constants `KEY` and `BAK`. `load()` returns `{ v, profile, lastVisit, seen, status }`. `getStatus` returns `{ s, at, snap }` or `null`. Also produces `app/test-helpers.js` exporting `loadApp(...filenames)`, which every later test file uses.

- [ ] **Step 1: Create the package manifest and Vitest config**

`package.json`:

```json
{
  "name": "summer-2027-role-index",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "jsdom": "^25.0.1",
    "vitest": "^2.1.8"
  }
}
```

`vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['app/**/*.test.js'],
  },
})
```

Append to `.gitignore`:

```
node_modules/
coverage/
```

Then run `pnpm install`.

- [ ] **Step 2: Write the test loader helper**

The app ships as classic scripts, so the tests must load them the same way the browser does. Running the file text inside the jsdom global context proves the real artifact works, and it keeps the source free of any module syntax.

`app/test-helpers.js`:

```js
import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Loads browser classic scripts into the current jsdom global, in order, and
// hands back the namespace they attach themselves to.
export function loadApp(...files) {
  delete globalThis.S27
  for (const f of files) {
    const path = resolve(HERE, f)
    runInThisContext(readFileSync(path, 'utf8'), { filename: path })
  }
  return globalThis.S27
}

export function clearStorage() {
  globalThis.localStorage.clear()
}
```

- [ ] **Step 3: Write the failing tests**

`app/store.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let Store

beforeEach(() => {
  clearStorage()
  vi.restoreAllMocks()
  Store = loadApp('store.js').Store
})

describe('load', () => {
  it('returns a blank record when storage is empty', () => {
    const d = Store.load()
    expect(d).toEqual({ v: 1, profile: null, lastVisit: null, seen: {}, status: {} })
  })

  it('reads back what a previous session saved', () => {
    Store.setStatus('u:jobs.example/1', 'applied', { co: 'Anduril', title: 'FSE', loc: 'CA', url: 'x' })
    Store.reset()
    expect(Store.getStatus('u:jobs.example/1').s).toBe('applied')
  })
})

describe('corrupt data', () => {
  it('backs the raw string up instead of discarding it, then starts clean', () => {
    globalThis.localStorage.setItem(Store.KEY, '{not json')
    Store.reset()
    const d = Store.load()
    expect(d.status).toEqual({})
    expect(globalThis.localStorage.getItem(Store.BAK)).toBe('{not json')
    expect(Store.isDegraded()).toBe(true)
  })
})

describe('migrate', () => {
  it('keeps a record written by the current schema version', () => {
    const out = Store.migrate({ v: 1, profile: { fields: ['swe'] }, lastVisit: '2026-09-01', seen: { a: '2026-09-01' }, status: {} })
    expect(out.profile).toEqual({ fields: ['swe'] })
    expect(out.seen).toEqual({ a: '2026-09-01' })
  })

  it('drops a record from an unknown schema version rather than trusting it', () => {
    const out = Store.migrate({ v: 99, status: { a: { s: 'applied' } } })
    expect(out.status).toEqual({})
  })
})

describe('degraded storage', () => {
  it('keeps working in memory when the browser refuses to write', () => {
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    Store.setStatus('k', 'saved', { co: 'A', title: 'B', loc: 'C', url: 'd' })
    expect(Store.getStatus('k').s).toBe('saved')
    expect(Store.isDegraded()).toBe(true)
  })
})

describe('setStatus', () => {
  it('removes the entry when passed null so a reader can undo', () => {
    Store.setStatus('k', 'dismissed', { co: 'A', title: 'B', loc: 'C', url: 'd' })
    Store.setStatus('k', null)
    expect(Store.getStatus('k')).toBe(null)
  })
})

describe('seen', () => {
  it('records the first date a row was shown and does not move it later', () => {
    Store.markSeen('k')
    const first = Store.load().seen['k']
    Store.markSeen('k')
    expect(Store.load().seen['k']).toBe(first)
    expect(Store.isSeen('k')).toBe(true)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test`
Expected: every test fails, because `app/store.js` does not exist and `loadApp` throws ENOENT.

- [ ] **Step 5: Write `app/store.js`**

```js
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, 8 tests.

- [ ] **Step 7: Mutation check every assertion**

A test that cannot fail is not a test. For each of the four checks below, make the edit, run `pnpm test`, confirm the named test fails, then revert the edit.

| Edit to `app/store.js` | Test that must fail |
|---|---|
| In the JSON catch block, delete the `setItem(BAK, raw)` line | backs the raw string up |
| In `migrate`, change `data.v !== VERSION` to `false` | drops a record from an unknown schema version |
| In `markSeen`, delete the `if (d.seen[key]) return;` guard | records the first date a row was shown |
| In `setStatus`, change `if (s === null)` to `if (false)` | removes the entry when passed null |

- [ ] **Step 8: Add the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches-ignore: []
  pull_request:

jobs:
  client:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.js .gitignore app/ .github/workflows/ci.yml
git commit -m "Add reader state store and the client test harness"
```

---

### Task 2: `match.js`

The scoring rules. Pure, no DOM, no copy. This is the most testable piece in the codebase and the one most likely to be tuned later.

**Files:**
- Create: `app/match.js`
- Create: `app/match.test.js`

**Interfaces:**
- Consumes: nothing at runtime. Takes row records shaped like the ones Task 3 produces: `{ key, co, title, loc, url, date, fields, terms, types, closed, deep, info }`, where `date` is an ISO string or `null`.
- Produces: `window.S27.Match` with `score(row, profile, todayISO)` returning `{ score, excluded, reasons }`. `excluded` is one of `'closed'`, `'term'`, `'type'`, or `null`. `reasons` is an array of structured tokens: `{ t: 'fields', v: ['swe'] }`, `{ t: 'fresh', v: 2 }`, `{ t: 'vetted' }`. Also produces the constants `THRESHOLD`, `W_FIELD`, `W_FRESH`, `W_VETTED`, `FRESH_DAYS`, and the helper `daysOld(dateISO, todayISO)`.

- [ ] **Step 1: Write the failing tests**

`app/match.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp } from './test-helpers.js'

let Match
const TODAY = '2026-09-03'

function row(over) {
  return Object.assign({
    key: 'u:x/1', co: 'Anduril', title: 'Flight Software Engineer', loc: 'Costa Mesa',
    url: 'https://x/1', date: null, fields: [], terms: [], types: [],
    closed: false, deep: false, info: false,
  }, over)
}

beforeEach(() => { Match = loadApp('match.js').Match })

describe('hard excludes', () => {
  it('excludes a closed row whatever else matches', () => {
    const r = Match.score(row({ closed: true, fields: ['swe'] }), { fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe('closed')
    expect(r.score).toBe(0)
  })

  it('excludes a row whose term conflicts with the profile', () => {
    const r = Match.score(row({ terms: ['fall26'] }), { term: 'sum27' }, TODAY)
    expect(r.excluded).toBe('term')
  })

  it('does not exclude a row that carries no term signal at all', () => {
    const r = Match.score(row({ terms: [], fields: ['swe'] }), { term: 'sum27', fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe(null)
  })

  it('excludes a new grad row for a reader who wants internships', () => {
    const r = Match.score(row({ types: ['newgrad'] }), { types: ['intern'] }, TODAY)
    expect(r.excluded).toBe('type')
  })

  it('keeps a row that matches any one of several wanted types', () => {
    const r = Match.score(row({ types: ['newgrad'] }), { types: ['intern', 'newgrad'] }, TODAY)
    expect(r.excluded).toBe(null)
  })
})

describe('ranking', () => {
  it('scores three points per overlapping field', () => {
    const r = Match.score(row({ fields: ['swe', 'data'], deep: true }), { fields: ['swe', 'data'] }, TODAY)
    expect(r.score).toBe(6)
  })

  it('does not exclude a row that misses on field, because titles lie', () => {
    const r = Match.score(row({ fields: ['business'], deep: true }), { fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe(null)
    expect(r.score).toBe(0)
  })

  it('adds two points for a posting inside the freshness window', () => {
    const r = Match.score(row({ date: '2026-09-01', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(2)
  })

  it('adds nothing for a posting older than the freshness window', () => {
    const r = Match.score(row({ date: '2026-08-20', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(0)
  })

  it('adds one point for a hand-checked section over the wide net', () => {
    expect(Match.score(row({ deep: false }), { fields: [] }, TODAY).score).toBe(1)
    expect(Match.score(row({ deep: true }), { fields: [] }, TODAY).score).toBe(0)
  })
})

describe('reasons', () => {
  it('names every rule that actually contributed and no others', () => {
    const r = Match.score(row({ fields: ['swe'], date: '2026-09-02', deep: false }), { fields: ['swe'] }, TODAY)
    expect(r.reasons).toEqual([
      { t: 'fields', v: ['swe'] },
      { t: 'fresh', v: 1 },
      { t: 'vetted' },
    ])
    expect(r.score).toBe(6)
  })

  it('returns no reasons for an excluded row', () => {
    const r = Match.score(row({ closed: true, fields: ['swe'] }), { fields: ['swe'] }, TODAY)
    expect(r.reasons).toEqual([])
  })
})

describe('daysOld', () => {
  it('counts whole days back from today', () => {
    expect(Match.daysOld('2026-09-01', TODAY)).toBe(2)
    expect(Match.daysOld('2026-09-03', TODAY)).toBe(0)
  })

  it('returns null for a row with no date rather than guessing zero', () => {
    expect(Match.daysOld(null, TODAY)).toBe(null)
  })
})

describe('threshold', () => {
  it('is set so that a single field match clears it', () => {
    expect(Match.THRESHOLD).toBe(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test app/match.test.js`
Expected: FAIL, `loadApp` throws ENOENT for `match.js`.

- [ ] **Step 3: Write `app/match.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test app/match.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Mutation check the rules**

For each edit, run `pnpm test app/match.test.js`, confirm the named test fails, then revert.

| Edit to `app/match.js` | Test that must fail |
|---|---|
| Delete `&& row.terms.length` from the term check | does not exclude a row that carries no term signal |
| Change `W_FIELD` to `1` | scores three points per overlapping field |
| Change `age <= FRESH_DAYS` to `age <= 90` | adds nothing for a posting older than the freshness window |
| Return the row's own fields instead of `overlap` in the fields reason | names every rule that actually contributed |
| Make `daysOld` return `0` instead of `null` for a missing date | returns null for a row with no date |

- [ ] **Step 6: Commit**

```bash
git add app/match.js app/match.test.js
git commit -m "Add profile scoring rules for the triage views"
```

---

### Task 3: `rowindex.js`

The single DOM walk. It turns every `<tr>` on the page into a record the other modules can use, and it owns the classification tables that currently live inline in `index.html`.

**Files:**
- Create: `app/rowindex.js`
- Create: `app/rowindex.test.js`
- Create: `app/fixtures/page.html`

**Interfaces:**
- Consumes: `document`.
- Produces: `window.S27.RowIndex` with `build(doc, todayISO)` returning `{ rows, sections }`. Each row is `{ tr, key, co, title, loc, url, date, text, fields, terms, types, closed, deep, info, section }`, where `text` is the row's whole text content lowercased and whitespace collapsed. Task 5 consumes `text` for its search filter. Each section is `{ h2, nodes, rows, info, deep }`. Also produces `FIELDS`, `TERMS`, `TYPES` as arrays of `[key, label, regex]`, plus `slug(s)`, `normalizeUrl(u)`, `keyFor(url, co, title)`, and `parseTagDate(text, todayISO)`.

- [ ] **Step 1: Create the fixture page**

A small hand-written page, not a copy of the real 528-row file, so the tests stay readable and fast.

`app/fixtures/page.html`:

```html
<h1>TT chuds lock in</h1>
<p class="sub">Compiled 19 Aug 2026, refreshed <span id="refreshed">3 Sep 2026, 4 roles</span>.</p>

<h2>Defense &amp; national security <span class="n">primes and startups</span></h2>
<div class="wrap"><table>
<tr><th>Company</th><th>Role</th><th>Location</th><th>Apply</th></tr>
<tr><td class="co">Anduril</td><td>Flight Software Engineer, Early Career <span class="tag new">Sep 1</span></td><td class="loc">Costa Mesa, CA</td><td><a href="https://job-boards.greenhouse.io/andurilindustries/jobs/500?utm_source=x&amp;gh_src=y">Apply</a></td></tr>
<tr><td class="co">Palantir</td><td>Forward Deployed Software Engineer, New Grad <span class="tag cl">closed 2 Sep</span></td><td class="loc">New York, NY</td><td><a href="https://jobs.lever.co/palantir/abc/">Apply</a></td></tr>
</table></div>

<h2>Deep sweep <span class="n">wide net, unvetted</span></h2>
<div class="wrap"><table>
<tr><th>Company</th><th>Role</th><th>Location</th><th>Apply</th></tr>
<tr><td class="co">Citi</td><td>Markets Summer Analyst, Summer 2027 <span class="tag new">Aug 30</span></td><td class="loc">New York, NY</td><td><a href="https://WWW.Citi.example/Job/77/">Apply</a></td></tr>
</table></div>

<h2>Trackers &amp; tooling <span class="n">reference</span></h2>
<div class="wrap"><table>
<tr><th>Name</th><th>What</th><th>Where</th><th>Link</th></tr>
<tr><td class="co">SimplifyJobs</td><td>Summer 2027 tracker</td><td class="loc">GitHub</td><td><a href="https://github.com/SimplifyJobs/Summer2027-Internships">Open</a></td></tr>
</table></div>
```

- [ ] **Step 2: Write the failing tests**

`app/rowindex.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadApp } from './test-helpers.js'

let RowIndex
let doc
const TODAY = '2026-09-03'

beforeEach(() => {
  RowIndex = loadApp('rowindex.js').RowIndex
  document.body.innerHTML = readFileSync(resolve('app/fixtures/page.html'), 'utf8')
  doc = document
})

describe('normalizeUrl', () => {
  it('drops tracking parameters so a key survives a rewritten link', () => {
    expect(RowIndex.normalizeUrl('https://x.example/jobs/1?utm_source=a&gh_src=b'))
      .toBe('x.example/jobs/1')
  })

  it('drops a trailing slash and the www prefix and lowercases the host', () => {
    expect(RowIndex.normalizeUrl('https://WWW.Citi.example/Job/77/')).toBe('citi.example/Job/77')
  })

  it('keeps path case, because some boards route case sensitively', () => {
    expect(RowIndex.normalizeUrl('https://x.example/Job/AbC')).toBe('x.example/Job/AbC')
  })
})

describe('keyFor', () => {
  it('prefers the apply link', () => {
    expect(RowIndex.keyFor('https://x.example/1/', 'A', 'B')).toBe('u:x.example/1')
  })

  it('falls back to company and title when a row has no link', () => {
    expect(RowIndex.keyFor(null, 'Grant Thornton (US)', 'Tax Intern, Summer 2027'))
      .toBe('t:grant-thornton-us|tax-intern-summer-2027')
  })
})

describe('parseTagDate', () => {
  it('reads a month and day tag as this year', () => {
    expect(RowIndex.parseTagDate('Sep 1', TODAY)).toBe('2026-09-01')
  })

  it('rolls back a year when the tag would otherwise land in the future', () => {
    expect(RowIndex.parseTagDate('Dec 20', TODAY)).toBe('2025-12-20')
  })

  it('returns null for text that is not a date tag', () => {
    expect(RowIndex.parseTagDate('8 regional reqs', TODAY)).toBe(null)
  })
})

describe('build', () => {
  it('indexes every data row and skips header rows', () => {
    const { rows } = RowIndex.build(doc, TODAY)
    expect(rows.map((r) => r.co)).toEqual(['Anduril', 'Palantir', 'Citi', 'SimplifyJobs'])
  })

  it('reads company, title, location, and posting date off the row', () => {
    const r = RowIndex.build(doc, TODAY).rows[0]
    expect(r.co).toBe('Anduril')
    expect(r.title).toContain('Flight Software Engineer')
    expect(r.loc).toBe('Costa Mesa, CA')
    expect(r.date).toBe('2026-09-01')
  })

  it('flags a row carrying a closed tag', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[0].closed).toBe(false)
    expect(rows[1].closed).toBe(true)
  })

  it('flags wide-net rows so scoring can prefer the hand-checked sections', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[1].deep).toBe(false)
    expect(rows[2].deep).toBe(true)
  })

  it('flags reference rows so filters never hide them as if they were roles', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[3].info).toBe(true)
    expect(rows[0].info).toBe(false)
  })

  it('classifies fields, terms, and types from the row text', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[0].fields).toContain('swe')
    expect(rows[2].terms).toContain('sum27')
    expect(rows[1].types).toContain('newgrad')
  })

  it('groups rows under their section heading', () => {
    const { sections } = RowIndex.build(doc, TODAY)
    expect(sections.length).toBe(3)
    expect(sections[0].rows.length).toBe(2)
    expect(sections[1].deep).toBe(true)
    expect(sections[2].info).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test app/rowindex.test.js`
Expected: FAIL, `loadApp` throws ENOENT for `rowindex.js`.

- [ ] **Step 4: Write `app/rowindex.js`**

The three regex tables are moved verbatim from the inline script in `index.html`. Do not retype them and do not adjust them in this task.

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test app/rowindex.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 6: Mutation check the parsing rules**

| Edit to `app/rowindex.js` | Test that must fail |
|---|---|
| Drop the `a.search` handling by returning `host + a.pathname + a.search` | drops tracking parameters |
| Delete `.replace(/^www\./, '')` | drops a trailing slash and the www prefix |
| Lowercase the path in `normalizeUrl` | keeps path case |
| Delete the `if (iso > todayISO)` rollback | rolls back a year |
| Change `tr.querySelector('td.co')` to `tr.querySelector('td')` | indexes every data row and skips header rows |

- [ ] **Step 7: Commit**

```bash
git add app/rowindex.js app/rowindex.test.js app/fixtures/page.html
git commit -m "Add the row index that classifies every table row from its own text"
```

---

### Task 4: Extract the inline client out of `index.html`

A pure move with no behavior change. Doing it on its own means the next task's rewiring is reviewable in isolation.

**Files:**
- Create: `app/app.css`
- Create: `app/browse.js`
- Modify: `index.html:1-51` (the `<style>` block) and `index.html:884-1102` (the `<script>` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `app/browse.js` holding the existing filter IIFE unchanged, and `app/app.css` holding the existing stylesheet unchanged.

- [ ] **Step 1: Move the stylesheet**

Cut everything between `<style>` and `</style>` in `index.html` into a new file `app/app.css`. Replace the whole `<style>` element with:

```html
<link rel="stylesheet" href="app/app.css">
```

- [ ] **Step 2: Move the script**

Cut everything between `<script>` and `</script>` at the bottom of `index.html` into a new file `app/browse.js`, byte for byte. Replace the whole `<script>` element with:

```html
<script src="app/store.js"></script>
<script src="app/rowindex.js"></script>
<script src="app/match.js"></script>
<script src="app/browse.js"></script>
```

Load order matters. `browse.js` is last because later tasks make it depend on the three above it.

- [ ] **Step 3: Verify nothing changed**

Open `index.html` in a browser directly from disk, then check all five:

1. The filter bar renders under the subhead with Field, Term, Type, and Status groups.
2. Typing `palantir` in the search box narrows the page and the count reads `N of M`.
3. Clicking a Field chip filters, and clicking it again clears it.
4. `Hide closed` removes rows carrying a closed tag.
5. The URL hash updates as filters change, and reloading that URL restores them.

Then confirm the browser console is empty of errors.

- [ ] **Step 4: Confirm the refresh script still matches the page**

The extraction must not disturb the markup `refresh.py` performs surgery on.

Run: `python3 refresh.py --dry-run --no-deep`
Expected: it completes and reports a row count. It must not raise, and it must not report zero rows.

- [ ] **Step 5: Commit**

```bash
git add index.html app/app.css app/browse.js
git commit -m "Move the inline stylesheet and filter script into app/"
```

---

### Task 5: Rewire `browse.js` onto `rowindex`

Delete the duplicated classification pass. One source of truth for what a row is.

**Files:**
- Modify: `app/browse.js`

**Interfaces:**
- Consumes: `S27.RowIndex.build(document, todayISO)`, and `S27.RowIndex.FIELDS`, `TERMS`, `TYPES`.
- Produces: no new public surface. `browse.js` keeps its own `apply()` behavior.

- [ ] **Step 1: Replace the local tables and the DOM walk**

Delete the `FIELDS`, `TERMS`, `TYPES`, `INFO`, and `NOCOUNT` declarations from `app/browse.js`, and delete the `document.querySelectorAll('h2').forEach(...)` block that builds `sections` and sets `tr._f`. Replace all of it with:

```js
  var RI = root.S27.RowIndex;
  var FIELDS = RI.FIELDS, TERMS = RI.TERMS, TYPES = RI.TYPES;
  var today = new Date().toISOString().slice(0, 10);
  var index = RI.build(document, today);
  var sections = index.sections;

  // browse.js filters on the same records the triage views score, so a row can
  // never be classified one way here and another way there.
  index.rows.forEach(function (r) {
    r.tr._f = {
      text: r.text, fields: r.fields, terms: r.terms, types: r.types,
      closed: r.closed, info: r.info, nocount: r.deep
    };
  });
```

Change the IIFE's parameter list so `root` is available. The wrapper becomes:

```js
;(function (root) {
  'use strict';
  ...
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 2: Fix the two places that read the old section shape**

`countFor` and `apply` iterate `s.rows`, which used to hold `<tr>` elements and now holds records. Change both loops to read `tr._f` off `r.tr`:

```js
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
```

and in `apply`, replace `s.rows.forEach(function (tr) {` with:

```js
      s.rows.forEach(function (r) {
        var tr = r.tr;
```

- [ ] **Step 3: Verify behavior is unchanged**

Open `index.html` from disk and re-run all five checks from Task 4 Step 3. The chip counts in particular must show the same numbers as before this task. Note two counts before the change and compare them after.

- [ ] **Step 4: Commit**

```bash
git add app/browse.js
git commit -m "Build the browse filters from the shared row index"
```

---

### Task 6: Row status

The feature that makes the second visit different from the first.

**Files:**
- Create: `app/status.js`
- Create: `app/status.test.js`
- Modify: `app/app.css`
- Modify: `index.html` (add `<script src="app/status.js"></script>` immediately before the `app/browse.js` tag)

**Interfaces:**
- Consumes: `S27.Store`, row records from `S27.RowIndex`.
- Produces: `window.S27.Status` with `controlsFor(row, onChange)` returning an `HTMLElement`, `badgeFor(row)` returning an `HTMLElement` or `null`, `set(row, value)` where value is `'applied'`, `'saved'`, `'dismissed'`, or `null`, and `snapshot(row)` returning `{ co, title, loc, url }`.

- [ ] **Step 1: Write the failing tests**

`app/status.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
function row(over) {
  return Object.assign({
    key: 'u:x/1', co: 'Anduril', title: 'Flight Software Engineer',
    loc: 'Costa Mesa, CA', url: 'https://x/1',
  }, over)
}

beforeEach(() => {
  clearStorage()
  document.body.innerHTML = ''
  S27 = loadApp('store.js', 'status.js')
})

describe('snapshot', () => {
  it('captures enough to render the row after the page drops it', () => {
    expect(S27.Status.snapshot(row())).toEqual({
      co: 'Anduril', title: 'Flight Software Engineer',
      loc: 'Costa Mesa, CA', url: 'https://x/1',
    })
  })
})

describe('set', () => {
  it('stores the snapshot alongside the status so a pruned row survives', () => {
    S27.Status.set(row(), 'saved')
    expect(S27.Store.getStatus('u:x/1').snap.co).toBe('Anduril')
  })

  it('clears the status when passed null', () => {
    S27.Status.set(row(), 'applied')
    S27.Status.set(row(), null)
    expect(S27.Store.getStatus('u:x/1')).toBe(null)
  })
})

describe('controlsFor', () => {
  it('offers apply, save, and dismiss', () => {
    const el = S27.Status.controlsFor(row(), () => {})
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['Applied', 'Save', 'Not for me'])
  })

  it('marks the row applied when the reader clicks Applied', () => {
    const el = S27.Status.controlsFor(row(), () => {})
    document.body.appendChild(el)
    el.querySelector('button').click()
    expect(S27.Store.getStatus('u:x/1').s).toBe('applied')
  })

  it('toggles a status off when the same control is clicked twice', () => {
    const el = S27.Status.controlsFor(row(), () => {})
    document.body.appendChild(el)
    el.querySelector('button').click()
    el.querySelector('button').click()
    expect(S27.Store.getStatus('u:x/1')).toBe(null)
  })

  it('tells the caller the status changed so the view can re-render', () => {
    let seen = null
    const el = S27.Status.controlsFor(row(), (v) => { seen = v })
    document.body.appendChild(el)
    el.querySelectorAll('button')[1].click()
    expect(seen).toBe('saved')
  })

  it('shows the current status as pressed when the row already has one', () => {
    S27.Status.set(row(), 'saved')
    const el = S27.Status.controlsFor(row(), () => {})
    expect(el.querySelectorAll('button')[1].getAttribute('aria-pressed')).toBe('true')
  })
})

describe('badgeFor', () => {
  it('returns nothing for an untouched row', () => {
    expect(S27.Status.badgeFor(row())).toBe(null)
  })

  it('names the status for a row that has one', () => {
    S27.Status.set(row(), 'applied')
    expect(S27.Status.badgeFor(row()).textContent).toBe('applied')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test app/status.test.js`
Expected: FAIL, ENOENT for `status.js`.

- [ ] **Step 3: Write `app/status.js`**

```js
;(function (root) {
  'use strict';

  var Store = root.S27.Store;

  var CONTROLS = [
    ['applied', 'Applied'],
    ['saved', 'Save'],
    ['dismissed', 'Not for me']
  ];

  // A row can be pruned out of the page by a later refresh, so the snapshot
  // travels with the status. My list renders from this when the row is gone.
  function snapshot(row) {
    return { co: row.co, title: row.title, loc: row.loc, url: row.url };
  }

  function set(row, value) {
    Store.setStatus(row.key, value, value === null ? undefined : snapshot(row));
  }

  function current(row) {
    var s = Store.getStatus(row.key);
    return s ? s.s : null;
  }

  function controlsFor(row, onChange) {
    var wrap = root.document.createElement('span');
    wrap.className = 'status';

    function paint() {
      var now = current(row);
      wrap.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.val === now));
      });
    }

    CONTROLS.forEach(function (c) {
      var b = root.document.createElement('button');
      b.type = 'button';
      b.className = 'sbtn s-' + c[0];
      b.dataset.val = c[0];
      b.textContent = c[1];
      b.addEventListener('click', function () {
        var next = current(row) === c[0] ? null : c[0];
        set(row, next);
        paint();
        onChange(next);
      });
      wrap.appendChild(b);
    });

    paint();
    return wrap;
  }

  function badgeFor(row) {
    var now = current(row);
    if (!now) return null;
    var el = root.document.createElement('span');
    el.className = 'tag st st-' + now;
    el.textContent = now;
    return el;
  }

  root.S27.Status = {
    snapshot: snapshot, set: set, current: current,
    controlsFor: controlsFor, badgeFor: badgeFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test app/status.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Mutation check**

| Edit to `app/status.js` | Test that must fail |
|---|---|
| Pass `undefined` instead of `snapshot(row)` in `set` | stores the snapshot alongside the status |
| Change the toggle to always `set(row, c[0])` | toggles a status off |
| Delete the `onChange(next)` call | tells the caller the status changed |
| Return an element instead of `null` in `badgeFor` when there is no status | returns nothing for an untouched row |

- [ ] **Step 6: Wire status into Browse**

In `app/browse.js`, replace the record loop added in Task 5 with this one. It
now also hangs the record off the row so `matches` can reach it, and paints a
status badge.

```js
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
```

Add `dismissed` to the filter state and to `matches`:

```js
  var state = { q: '', field: null, term: null, type: null, hideClosed: false, hideDismissed: true };
```

```js
    if (state.hideDismissed && !f.info && root.S27.Status.current(tr._row) === 'dismissed') return false;
```

Set `tr._row = r` in the same loop that sets `tr._f` so `matches` can reach the record.

Add a chip next to `Hide closed`:

```js
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
```

- [ ] **Step 7: Add the styles**

Append to `app/app.css`:

```css
.status{display:inline-flex;gap:.3rem;margin-left:.5rem;vertical-align:middle}
.sbtn{font:inherit;font-size:.7rem;padding:.15rem .45rem;border:1px solid var(--line);border-radius:5px;background:var(--card);color:var(--mut);cursor:pointer}
.sbtn:hover{color:var(--fg)}
.sbtn[aria-pressed="true"]{background:var(--acc);border-color:var(--acc);color:#fff}
.tag.st{margin-left:.4rem;text-transform:uppercase;letter-spacing:.04em;font-size:.62rem}
.tag.st-applied{background:rgba(34,139,84,.18)}
.tag.st-saved{background:rgba(50,110,200,.18)}
.tag.st-dismissed{background:rgba(127,127,127,.18)}
```

- [ ] **Step 8: Verify in a browser**

Open `index.html` from disk. Confirm all four:

1. Marking a row applied shows an `applied` badge on that row.
2. Reloading the page keeps the badge.
3. Marking a row `Not for me` hides it while `Hide dismissed` is pressed, and shows it again when that chip is released.
4. `python3 refresh.py --dry-run --no-deep` still completes without error, because badges are injected at runtime and never reach the file.

- [ ] **Step 9: Commit**

```bash
git add app/status.js app/status.test.js app/browse.js app/app.css index.html
git commit -m "Add applied, saved, and dismissed status to every row"
```

---

### Task 7: The profile strip

Twenty seconds of input that collapses 528 rows to a readable set.

**Files:**
- Create: `app/onboard.js`
- Create: `app/onboard.test.js`
- Modify: `app/app.css`
- Modify: `index.html` (add `<script src="app/onboard.js"></script>` immediately before the `app/browse.js` tag)

**Interfaces:**
- Consumes: `S27.Store.getProfile()` and `setProfile(p)`, `S27.RowIndex.FIELDS`, `TERMS`, `TYPES`.
- Produces: `window.S27.Onboard` with `render(mount, onSave)` returning the `HTMLElement` it mounted, and `isComplete(profile)` returning a boolean. A profile is `{ fields: string[], term: string|null, types: string[] }`.

- [ ] **Step 1: Write the failing tests**

`app/onboard.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
let mount

beforeEach(() => {
  clearStorage()
  document.body.innerHTML = '<div id="m"></div>'
  mount = document.getElementById('m')
  S27 = loadApp('store.js', 'rowindex.js', 'onboard.js')
})

describe('isComplete', () => {
  it('needs at least one field before it will call a profile usable', () => {
    expect(S27.Onboard.isComplete({ fields: [], term: 'sum27', types: ['intern'] })).toBe(false)
    expect(S27.Onboard.isComplete({ fields: ['swe'], term: null, types: [] })).toBe(true)
  })

  it('treats a missing profile as incomplete', () => {
    expect(S27.Onboard.isComplete(null)).toBe(false)
  })
})

describe('render', () => {
  it('offers a chip for every field, term, and type the index knows', () => {
    S27.Onboard.render(mount, () => {})
    expect(mount.querySelectorAll('[data-group="fields"] button').length).toBe(12)
    expect(mount.querySelectorAll('[data-group="term"] button').length).toBe(3)
    expect(mount.querySelectorAll('[data-group="types"] button').length).toBe(2)
  })

  it('lets a reader pick several fields but only one term', () => {
    S27.Onboard.render(mount, () => {})
    const fields = mount.querySelectorAll('[data-group="fields"] button')
    fields[0].click()
    fields[1].click()
    const terms = mount.querySelectorAll('[data-group="term"] button')
    terms[0].click()
    terms[1].click()
    S27.Onboard.save()
    const p = S27.Store.getProfile()
    expect(p.fields.length).toBe(2)
    expect(p.term).toBe('spr27')
  })

  it('saves the profile and reports it to the caller', () => {
    let got = null
    S27.Onboard.render(mount, (p) => { got = p })
    mount.querySelector('[data-group="fields"] button').click()
    mount.querySelector('.ob-save').click()
    expect(got.fields).toEqual(['swe'])
    expect(S27.Store.getProfile().fields).toEqual(['swe'])
  })

  it('pre-selects the chips from a profile saved on an earlier visit', () => {
    S27.Store.setProfile({ fields: ['quant'], term: 'sum27', types: ['intern'] })
    S27.Onboard.render(mount, () => {})
    const pressed = [...mount.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.dataset.val)
    expect(pressed).toContain('quant')
    expect(pressed).toContain('sum27')
    expect(pressed).toContain('intern')
  })

  it('records a skip so the strip does not reappear on every visit', () => {
    S27.Onboard.render(mount, () => {})
    mount.querySelector('.ob-skip').click()
    expect(S27.Store.getProfile()).toEqual({ fields: [], term: null, types: [], skipped: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test app/onboard.test.js`
Expected: FAIL, ENOENT for `onboard.js`.

- [ ] **Step 3: Write `app/onboard.js`**

```js
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

  function selected(groupName, val) {
    var v = draft[groupName];
    return Array.isArray(v) ? v.indexOf(val) !== -1 : v === val;
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

  root.S27.Onboard = { isComplete: isComplete, render: render, save: save, skip: skip };
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test app/onboard.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation check**

| Edit to `app/onboard.js` | Test that must fail |
|---|---|
| Change `isComplete` to return `true` whenever `p` is truthy | needs at least one field |
| Make the term group multi-select by passing `true` | lets a reader pick several fields but only one term |
| Delete the `if (cb) cb(...)` line in `save` | saves the profile and reports it to the caller |
| Have `render` always start from `blankDraft()` | pre-selects the chips from a profile saved on an earlier visit |
| Drop `skipped: true` from `skip` | records a skip |

- [ ] **Step 6: Add the styles**

Append to `app/app.css`:

```css
.onboard{border:1px solid var(--line);border-radius:9px;background:var(--card);padding:.9rem 1rem;margin:1rem 0}
.ob-lead{margin:0 0 .7rem;font-size:.92rem}
.ob-group{display:flex;flex-wrap:wrap;gap:.35rem;align-items:flex-start;margin-bottom:.5rem}
.ob-actions{display:flex;gap:.5rem;margin-top:.8rem}
.ob-save{font:inherit;font-size:.85rem;padding:.45rem .9rem;border:0;border-radius:7px;background:var(--acc);color:#fff;cursor:pointer}
.ob-skip{font:inherit;font-size:.85rem;padding:.45rem .9rem;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--mut);cursor:pointer}
```

- [ ] **Step 7: Commit**

```bash
git add app/onboard.js app/onboard.test.js app/app.css
git commit -m "Add the profile strip that seeds the triage view"
```

---

### Task 8: The Today view

**Files:**
- Create: `app/today.js`
- Create: `app/today.test.js`
- Modify: `app/app.css`
- Modify: `index.html` (add the script tags and the mount point)

**Interfaces:**
- Consumes: `S27.Store`, `S27.Match`, `S27.RowIndex`, `S27.Status`, `S27.Onboard`.
- Produces: `window.S27.Today` with `pick(rows, profile, store, todayISO)` returning `{ fresh, backfill }`, and `render(mount, rows, profile, todayISO)` returning the mounted `HTMLElement`. `pick` is pure apart from the store reads and is the piece under test.

- [ ] **Step 1: Write the failing tests**

`app/today.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
const TODAY = '2026-09-03'
const PROFILE = { fields: ['swe'], term: 'sum27', types: ['intern'] }

function row(over) {
  return Object.assign({
    key: 'k' + Math.random(), co: 'Co', title: 'Software Engineer Intern',
    loc: 'CA', url: 'https://x/' + Math.random(), date: '2026-09-02',
    fields: ['swe'], terms: ['sum27'], types: ['intern'],
    closed: false, deep: false, info: false,
  }, over)
}

beforeEach(() => {
  clearStorage()
  document.body.innerHTML = '<div id="m"></div>'
  S27 = loadApp('store.js', 'rowindex.js', 'match.js', 'status.js', 'today.js')
})

describe('pick', () => {
  it('ranks the strongest match first', () => {
    const weak = row({ key: 'weak', fields: [], date: null })
    const strong = row({ key: 'strong', fields: ['swe'] })
    const { fresh } = S27.Today.pick([weak, strong], PROFILE, S27.Store, TODAY)
    expect(fresh[0].row.key).toBe('strong')
  })

  it('drops rows below the threshold', () => {
    const { fresh } = S27.Today.pick([row({ key: 'weak', fields: [], date: null })], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).not.toContain('weak')
  })

  it('drops excluded rows even when they score well elsewhere', () => {
    const closed = row({ key: 'closed', closed: true })
    const wrongTerm = row({ key: 'wrongterm', terms: ['fall26'] })
    const { fresh } = S27.Today.pick([closed, wrongTerm], PROFILE, S27.Store, TODAY)
    expect(fresh).toEqual([])
  })

  it('never shows a row the reader has already handled', () => {
    const a = row({ key: 'a' })
    const b = row({ key: 'b' })
    S27.Status.set(b, 'dismissed')
    const { fresh } = S27.Today.pick([a, b], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).toEqual(['a'])
  })

  it('never shows a row that a previous visit already displayed', () => {
    const a = row({ key: 'a' })
    S27.Store.markSeen('a')
    const { fresh } = S27.Today.pick([a, row({ key: 'b' })], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).toEqual(['b'])
  })

  it('caps the list so the view stays readable', () => {
    const many = []
    for (let i = 0; i < 40; i++) many.push(row({ key: 'k' + i }))
    const { fresh } = S27.Today.pick(many, PROFILE, S27.Store, TODAY)
    expect(fresh.length).toBe(15)
  })

  it('backfills with seen rows when too little is new, and keeps them separate', () => {
    const a = row({ key: 'a' })
    const b = row({ key: 'b' })
    S27.Store.markSeen('b')
    const { fresh, backfill } = S27.Today.pick([a, b], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).toEqual(['a'])
    expect(backfill.map((f) => f.row.key)).toEqual(['b'])
  })

  it('does not backfill once enough rows are genuinely new', () => {
    const rows = []
    for (let i = 0; i < 6; i++) rows.push(row({ key: 'n' + i }))
    const seen = row({ key: 'seen' })
    S27.Store.markSeen('seen')
    const { backfill } = S27.Today.pick(rows.concat([seen]), PROFILE, S27.Store, TODAY)
    expect(backfill).toEqual([])
  })

  it('skips reference rows, which are not roles', () => {
    const { fresh } = S27.Today.pick([row({ key: 'i', info: true })], PROFILE, S27.Store, TODAY)
    expect(fresh).toEqual([])
  })
})

describe('render', () => {
  it('marks every row it displayed as seen so it does not repeat tomorrow', () => {
    const a = row({ key: 'a' })
    S27.Today.render(document.getElementById('m'), [a], PROFILE, TODAY)
    expect(S27.Store.isSeen('a')).toBe(true)
  })

  it('says so plainly when there is nothing new rather than rendering an empty box', () => {
    const el = S27.Today.render(document.getElementById('m'), [], PROFILE, TODAY)
    expect(el.textContent).toContain('Nothing new')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test app/today.test.js`
Expected: FAIL, ENOENT for `today.js`.

- [ ] **Step 3: Write `app/today.js`**

```js
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

  function render(mount, rows, profile, todayISO) {
    var store = root.S27.Store;
    var picked = pick(rows, profile, store, todayISO);

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

      picked.fresh.forEach(function (e) { box.appendChild(card(e, redraw)); });

      if (picked.backfill.length) {
        var h3 = doc.createElement('h3');
        h3.className = 'today-sub';
        h3.textContent = 'Also worth a look';
        box.appendChild(h3);
        picked.backfill.forEach(function (e) { box.appendChild(card(e, redraw)); });
      }
    }

    redraw();
    mount.appendChild(box);

    // Marking seen after render, not on click, so a row a reader ignored today
    // does not come back tomorrow pretending to be new.
    picked.fresh.forEach(function (e) { store.markSeen(e.row.key); });
    picked.backfill.forEach(function (e) { store.markSeen(e.row.key); });

    return box;
  }

  root.S27.Today = { pick: pick, render: render, CAP: CAP, MIN_FRESH: MIN_FRESH };
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test app/today.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation check**

| Edit to `app/today.js` | Test that must fail |
|---|---|
| Delete the `if (store.getStatus(r.key)) return;` guard | never shows a row the reader has already handled |
| Change `m.score < Match.THRESHOLD` to `false` | drops rows below the threshold |
| Change `CAP` to `100` | caps the list so the view stays readable |
| Always compute `backfill` regardless of `out.length` | does not backfill once enough rows are genuinely new |
| Move the `markSeen` loop above `pick` | never shows a row that a previous visit already displayed |

- [ ] **Step 6: Wire it into the page**

In `index.html`, add a mount point immediately after the `<p class="sub">` line:

```html
<div id="triage"></div>
```

Tasks 6 and 7 already added the `status.js` and `onboard.js` tags. Add only the
remaining two, immediately before `app/browse.js`:

```html
<script src="app/today.js"></script>
<script src="app/boot.js"></script>
```

The full list must now read store, rowindex, match, status, onboard, today,
boot, browse. The order is load bearing. `today.js` reads `RowIndex.FIELDS` at
load time, and `browse.js` stays last because it walks the DOM immediately while
`boot.js` waits for `DOMContentLoaded`. Verify the order before moving on.

Create `app/boot.js`:

```js
;(function (root) {
  'use strict';

  var S = root.S27;
  var doc = root.document;

  function start() {
    var mount = doc.getElementById('triage');
    if (!mount) return;

    // Touch storage before asking whether it worked. isDegraded only knows
    // after a real read has been attempted.
    S.Store.load();
    if (S.Store.isDegraded()) banner(mount);

    var today = new Date().toISOString().slice(0, 10);
    var index = S.RowIndex.build(doc, today);
    var profile = S.Store.getProfile();

    if (!profile) {
      S.Onboard.render(mount, function (p) {
        mount.innerHTML = '';
        if (S.Onboard.isComplete(p)) S.Today.render(mount, index.rows, p, today);
      });
      return;
    }
    if (S.Onboard.isComplete(profile)) S.Today.render(mount, index.rows, profile, today);
    S.Store.setLastVisit(today);
  }

  function banner(mount) {
    var p = doc.createElement('p');
    p.className = 'degraded';
    p.textContent = 'This browser is blocking local storage, so what you mark here will not be remembered.';
    mount.appendChild(p);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 7: Add the styles**

Append to `app/app.css`:

```css
.today{margin:1.2rem 0 1.6rem}
.today-h{font-size:1.05rem;margin:0 0 .7rem;border:0;padding:0}
.today-sub{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:1.2rem 0 .6rem}
.today-empty{color:var(--mut);font-size:.9rem}
.tcard{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:.7rem .85rem;margin-bottom:.5rem}
.tcard-co{font-weight:600;margin-right:.5rem}
.tcard-title{font-size:.95rem}
.tcard-meta{color:var(--mut);font-size:.8rem;margin-top:.25rem}
.tcard-actions{display:flex;align-items:center;gap:.5rem;margin-top:.55rem}
.tcard-apply{font-size:.8rem;padding:.3rem .7rem;border-radius:6px;background:var(--acc);color:#fff;text-decoration:none}
.degraded{font-size:.85rem;color:var(--mut);border:1px dashed var(--line);border-radius:7px;padding:.5rem .7rem}
```

- [ ] **Step 8: Verify the whole journey in a browser**

Open `index.html` from disk with a cleared `localStorage` and walk it:

1. The profile strip appears above the filters. Pick Software, Summer 2027, Internship, then click "Show me my list".
2. A Today section renders with at most 15 cards, each showing a match reason and Open, Applied, Save, Not for me.
3. Reload. The profile strip is gone and Today reports nothing new, because every card was marked seen.
4. Clear `localStorage`, reload, click "Just show everything". No Today section renders and the full index is browsable.
5. `python3 refresh.py --dry-run --no-deep` still completes without error.

- [ ] **Step 9: Commit**

```bash
git add app/today.js app/today.test.js app/boot.js app/app.css index.html
git commit -m "Add the Today view and boot the triage flow"
```

---

### Task 9: Generate the freshness line

The subhead currently hardcodes "Every link below was re-requested on 31 Aug". Three refreshes have run since. A page whose whole claim is that it is hand-verified cannot carry a stale verification date.

**Files:**
- Modify: `index.html:55` (the `<p class="sub">` line)
- Modify: `refresh.py:577-589`
- Create: `test_refresh.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `refresh.py` gains `verified_line(today)` returning the date text, and rewrites `<span id="verified">` the same way it already rewrites `<span id="refreshed">`.

- [ ] **Step 1: Wrap the claim in a span**

In `index.html`, replace the tail of the subhead so the verification sentence sits in its own span:

```html
Every link below was re-requested on <span id="verified">3 Sep 2026</span> and dead reqs are marked closed rather than deleted.
```

- [ ] **Step 2: Write the failing test**

`test_refresh.py`:

```python
import datetime

import refresh


def test_verified_line_names_the_run_date():
    day = datetime.date(2026, 9, 3)
    assert refresh.verified_line(day) == "3 Sep 2026"


def test_rewrite_replaces_the_span_contents():
    html = '<p>checked on <span id="verified">31 Aug 2026</span> and so on</p>'
    out = refresh.rewrite_verified(html, datetime.date(2026, 9, 3))
    assert '<span id="verified">3 Sep 2026</span>' in out
    assert "31 Aug 2026" not in out


def test_rewrite_leaves_a_page_without_the_span_untouched():
    html = "<p>no span here</p>"
    assert refresh.rewrite_verified(html, datetime.date(2026, 9, 3)) == html


def test_the_real_page_carries_the_span():
    with open("index.html", encoding="utf-8") as fh:
        assert '<span id="verified">' in fh.read()
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python3 -m pytest test_refresh.py -v`
Expected: FAIL with `AttributeError: module 'refresh' has no attribute 'verified_line'`.

- [ ] **Step 4: Add the functions to `refresh.py`**

Add near the other helpers, above `main`:

```python
def verified_line(today):
    """The date the links in the page were last re-requested."""
    return f"{today:%-d %b %Y}"


def rewrite_verified(html, today):
    """Keep the verification date in the subhead honest.

    The sentence around it is fixed copy. Only the date moves, so the page
    cannot claim a check it did not run.
    """
    return re.sub(
        r'<span id="verified">.*?</span>',
        f'<span id="verified">{verified_line(today)}</span>',
        html, count=1,
    )
```

Then call it in `main`, immediately after the existing `refreshed` rewrite at line 589:

```python
    html = rewrite_verified(html, today)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python3 -m pytest test_refresh.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 6: Mutation check**

| Edit to `refresh.py` | Test that must fail |
|---|---|
| Change `count=1` to `count=0` and the pattern to something that never matches | rewrite replaces the span contents |
| Change `%-d %b %Y` to `%Y-%m-%d` | verified line names the run date |
| Make `rewrite_verified` append the span when it is missing | leaves a page without the span untouched |

- [ ] **Step 7: Verify against the real page**

Run: `python3 refresh.py --dry-run --no-deep`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add index.html refresh.py test_refresh.py
git commit -m "Generate the verification date in the subhead"
```

---

### Task 10: Regression tests for `refresh.py`

`refresh.py` is the component that can silently corrupt the published page, and it has no test coverage at all. This task covers the two parts most likely to break quietly: the early-career filters and the section routing.

**Files:**
- Modify: `test_refresh.py`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `refresh.EARLY`, `refresh.SENIOR`, `refresh.JUNK`, `refresh.US`, `refresh.route(company, title)`, `refresh.norm_key(company, title)`, `refresh.board_token(url)`.
- Produces: no new source. Coverage only.

These tests lock in what the code does today, not what it ideally would do.
Every expected value below was read off the real module on 2026-09-03, so they
should pass on the first run. A failure here means behavior has already drifted,
which is itself the finding.

For reference, the values these assert against:

| Call | Returns |
|---|---|
| `route('Anduril', '2027 Early Career Flight Software Engineer')` | `'<h2>Defense &amp; national security'` |
| `route('Some Unknown LLC', 'Coordinator, 2027')` | `'<h2>Full-time &amp; new grad'`, which is `FALLBACK` |
| `board_token('https://job-boards.greenhouse.io/andurilindustries/jobs/500')` | `'andurilindustries'` |
| `board_token('https://jobs.lever.co/palantir/abc')` | `'palantir'` |
| `board_token('https://citi.wd5.myworkdayjobs.com/en-US/2/job/x')` | `None`, because Workday is search only |
| `norm_key('Anduril', 'Flight Software Engineer')` | `'anduril|flightsoftwareengineer'` |

- [ ] **Step 1: Write the tests**

Append to `test_refresh.py`:

```python
import pytest


@pytest.mark.parametrize("title", [
    "Software Engineer Intern, Summer 2027",
    "2027 Summer Analyst Program",
    "New Grad Software Engineer",
    "Early Career Flight Software Engineer",
])
def test_early_matches_the_shapes_early_career_postings_actually_use(title):
    assert refresh.EARLY.search(title)


@pytest.mark.parametrize("title", [
    "Senior Software Engineer",
    "Staff Machine Learning Engineer",
    "Principal Product Manager",
])
def test_senior_titles_are_rejected_even_when_early_also_matches(title):
    assert refresh.SENIOR.search(title)


@pytest.mark.parametrize("title", [
    "Warehouse Associate",
    "Delivery Driver",
])
def test_junk_catches_shift_work_that_is_early_career_but_not_the_point(title):
    assert refresh.JUNK.search(title)


def test_us_matcher_accepts_a_domestic_location():
    assert refresh.US.search("Costa Mesa, California, United States")


def test_us_matcher_rejects_a_foreign_location():
    assert not refresh.US.search("Daresbury, England, United Kingdom")


def test_routing_sends_a_defense_prime_to_the_defense_section():
    assert "Defense" in refresh.route("Anduril", "2027 Early Career Flight Software Engineer")


def test_routing_falls_back_rather_than_dropping_an_unrecognised_row():
    assert refresh.route("Some Unknown LLC", "Coordinator, 2027") == refresh.FALLBACK


def test_norm_key_ignores_case_and_punctuation_so_a_retitled_row_is_not_duplicated():
    assert refresh.norm_key("Anduril", "Flight Software Engineer") == \
           refresh.norm_key("anduril", "Flight  Software  Engineer!")


def test_board_token_reads_a_greenhouse_url():
    assert refresh.board_token("https://job-boards.greenhouse.io/andurilindustries/jobs/500") == "andurilindustries"


def test_board_token_reads_a_lever_url():
    assert refresh.board_token("https://jobs.lever.co/palantir/abc") == "palantir"


def test_board_token_returns_none_for_a_board_we_cannot_enumerate():
    assert refresh.board_token("https://citi.wd5.myworkdayjobs.com/en-US/2/job/x") is None
```

- [ ] **Step 2: Run the tests**

Run: `python3 -m pytest test_refresh.py -v`
Expected: PASS, 21 tests, which is the 4 from Task 9 plus 17 parametrized cases here. If one fails, `refresh.py` has drifted from the table
above. Report which, and change the test to match the code. Do not change
`refresh.py` in this task.

- [ ] **Step 3: Mutation check the routing tests**

| Edit to `refresh.py` | Test that must fail |
|---|---|
| Return `FALLBACK` unconditionally from `route` | routing sends a defense prime to the defense section |
| Delete the `lever.co` branch from `board_token` | board token reads a lever url |
| Strip the lowercasing from `norm_key` | norm key ignores case and punctuation |

The `board_token` mutation must fail the lever test and not the Greenhouse one. If both fail, the tests are coupled and need splitting.

- [ ] **Step 4: Add Python to CI**

Add a second job to `.github/workflows/ci.yml`:

```yaml
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install pytest
      - run: python3 -m pytest test_refresh.py -v
      - name: Dry run against the real page
        run: python3 refresh.py --dry-run --no-deep
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm test && python3 -m pytest test_refresh.py -v`
Expected: both green. Check the exit code directly with `echo $?` rather than reading piped output, because a piped tail hides a failure.

- [ ] **Step 6: Commit**

```bash
git add test_refresh.py .github/workflows/ci.yml
git commit -m "Add regression tests for the refresh routing and filters"
```

---

## Done when

- `pnpm test` and `python3 -m pytest test_refresh.py` both pass, and every assertion has been mutation checked.
- Opening `index.html` from disk with cleared storage shows the profile strip, then a Today list, and a reload shows neither.
- Marking a row applied survives a reload.
- `python3 refresh.py --dry-run` completes without error against the real page.
- The subhead's verification date is generated, not hardcoded.
