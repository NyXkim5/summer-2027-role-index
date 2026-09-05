# Role Index: triage views

Date: 2026-09-03
Status: approved for planning

## Context

`index.html` is a hand-verified index of Summer 2027 internship, new grad, and
full-time roles. As of 2026-09-03 it holds 528 rows across 15 sections. A GitHub
Action runs `refresh.py` daily at 16:00 UTC, appends new rows, tags dead reqs
closed, and commits.

The page today is a browsing tool. It offers live search, field/term/type filter
chips, a hide-closed toggle, and URL state. It has no memory of the reader.

## Problem

A student lands on 528 rows, opens tabs, and leaves. Three days later the page
looks identical. Nothing records what they read, saved, or applied to, so every
visit repeats the first visit. The competing GitHub trackers and Simplify share
this failure. They are append-only lists.

The job is not browsing. It is recurring triage. The value is the short list of
roles worth acting on today plus a record of what is already handled.

## Goals

1. A student sees a short, ranked list of roles that are new to them.
2. A student marks a role applied, saved, or dismissed, and that sticks.
3. A student sees their own pipeline and what has gone quiet.
4. The full index stays browsable and keeps its editorial sections.
5. The daily refresh keeps working with no changes to `refresh.py` behavior.

## Non-goals

- Accounts, auth, a database, or a server. See "Approaches".
- Email digests or push. Later, if the client-side product earns it.
- Scraping new job boards. Coverage is a separate piece of work.
- Replacing the curated sections with an algorithmic feed.

## Approaches considered

**A. Static page, client-side memory. Chosen.**
Profile and status live in `localStorage`. Cost stays zero, there are no privacy
obligations, and there is no signup between a student and the list. State is
per-browser, which an export and import JSON button covers.

**B. Backend with accounts.** Real sync and real digests, at the cost of auth, a
database, a bill, and a page that stops working when the bill stops. Wrong trade
for the value added.

**C. Better filters only.** Cheapest and fixes nothing. Filtering is not the
problem. Forgetting the reader is.

Build tooling: vanilla JS, no build step. Confirmed with the owner on 2026-09-03,
overriding the global TypeScript rule, because a build step would break both the
GitHub Pages deploy path and opening the file over `file://`.

## Architecture

`refresh.py` performs string surgery on `index.html`. It appends `<tr>` rows,
inserts a closed tag inside a row, and trims the Deep sweep table by matching
`<tr><td class="co">`. The current client derives every filter fact from row text
at runtime, so neither side knows about the other.

That decoupling is a load-bearing property. The design preserves it:

- The client only reads the DOM. It never asks `refresh.py` for metadata.
- No new markup is written inside `<tr>` elements by `refresh.py`. Status
  badges are injected into rows by the client at runtime, which never reaches
  the committed file, so the two cannot collide.
- All new persistent chrome renders outside the tables.

The client moves out of `index.html` into `app.js` and `app.css`, loaded as
classic script and link tags, not ES modules, so the page still opens over
`file://`.

## Row identity

Status must survive daily regeneration of the page.

The key is the apply URL, normalized: host lowercased, query string dropped,
trailing slash dropped. Trackers append UTM parameters, so the raw href is not
stable. A row with no link falls back to `slug(company) + '|' + slug(title)`.

Keys are computed in the browser. `refresh.py` is not involved.

**Pruning trap.** Deep sweep is capped at 150 rows and trimmed oldest-first. A
row a student saved can be deleted from the page by a later refresh. My list
therefore stores a snapshot of company, title, location, and URL next to the
status. A saved role survives deletion and renders from the snapshot, badged
"no longer listed".

## State

One `localStorage` key, `s27.v1`:

```
{
  v: 1,
  profile:   { fields: ['swe','data'], term: 'sum27', types: ['intern'] },
  lastVisit: '2026-09-03',
  seen:      { <key>: '2026-09-03' },
  status:    { <key>: { s: 'applied'|'saved'|'dismissed', at: '2026-09-03',
                        snap: { co, title, loc, url } } }
}
```

The `v` field lets a schema change migrate rather than wipe. Reads and writes are
wrapped in try/catch because storage access throws outright in some private
browsing modes.

Export and import move the blob between devices as a downloaded JSON file.

## Components

Each module has one job and is testable on its own.

| Module | Responsibility | Depends on |
|---|---|---|
| `store.js` | Load, save, migrate, export, import. No DOM. | nothing |
| `rowindex.js` | One DOM walk producing a row record per `<tr>`. | DOM |
| `match.js` | Pure. Profile plus row to score and reasons. | nothing |
| `views.js` | Render Today, Browse, My list. | store, rowindex, match |
| `onboard.js` | The profile strip. | store |

A row record is
`{ key, co, title, loc, url, date, fields, terms, types, section, closed, info }`.

`rowindex.js` is a refactor of the existing `tr._f` pass in `index.html`, not a
rewrite. The `FIELDS`, `TERMS`, and `TYPES` regex tables move across unchanged.

## Scoring

Hard excludes, applied first:

- the row is tagged closed
- the row's term conflicts with the profile term
- the row's type conflicts with the profile type

Everything else ranks and never excludes, because a student who picks Software
still wants to see a forward deployed engineer role:

| Signal | Weight |
|---|---|
| Field overlap with profile | +3 each |
| Posted within 7 days | +2 |
| Hand-verified section rather than Deep sweep | +1 |

The "why it matched" line is generated from the same rule evaluation that
produces the score, so the explanation cannot drift from the ranking.

## Views

**Onboarding** is an inline strip on first visit, not a modal or a wizard. Three
rows of chips: field of study, target term, internship or new grad. It writes
`profile` and collapses. It is skippable and editable later. The profile holds
multiple fields, while the Browse chips stay single-select as they are today.
Today scores against every field in the profile. It reuses the
existing chip components, so the profile is a saved filter with a friendlier
face.

**Today** is the default view after onboarding. It shows unseen rows scoring 3
or higher, which means at least one field overlap, ranked, capped at 15. The
threshold is a named constant, because it needs real usage before it is settled. Each entry shows company, role, location,
posted N days ago, the match reason, and three controls: Apply, Save, Not for me.
Apply opens the link and marks the row applied, with an undo.

If fewer than five rows are genuinely new, the view backfills with high-scoring
untouched rows under a separate heading. The page never labels an old row as new.

`seen` is written on render, not on click, so a row does not resurface tomorrow
just because it was ignored today. Browse still shows everything.

**Browse** is the current page. Same tables, same sections, same chips. It gains
status badges and hides dismissed rows by default.

**My list** groups applied and saved rows, shows days since applied, and flags
anything applied more than 14 days ago with no recorded change.

**Freshness line.** The subhead currently hardcodes "every link below was
re-requested on 31 Aug". Three refreshes have run since. `refresh.py` will
generate that sentence from `stats.json` so a freshness claim cannot go stale.
The claim gets wrapped in `<span id="verified">`, and `refresh.py` rewrites it
the same way it already rewrites `#refreshed`. This is the one server-side
change in the spec.

## Error handling

| Condition | Behavior |
|---|---|
| `localStorage` throws | Run in memory, show a one-line banner that status will not persist |
| Stored JSON fails to parse | Copy the raw string to `s27.v1.bak`, reset, tell the user |
| Row in My list is gone from the page | Render from `snap`, badge "no longer listed" |
| JavaScript disabled or failed | Plain tables still render and still link out |

## Testing

The repo has no tests today.

- `match.js` and `store.js` are pure. Vitest unit tests, node environment.
- `rowindex.js` runs against a small fixture page, not the real 528-row file.
- `refresh.py` gets pytest coverage over saved board payloads for Greenhouse,
  Ashby, and Lever, plus the section routing and the early-career and senior
  regexes. This matters more than the client tests, because `refresh.py` is the
  component that can silently corrupt the published page.
- CI runs `refresh.py --dry-run` against the real `index.html` as a smoke test.

Every assertion gets a mutation check. An assertion that cannot be made to fail
is not a test.

## Phasing

**Phase 1** carries the value on its own: extract `app.js` and `app.css`, build
`store`, `rowindex`, `match`, the profile strip, row status, and the Today view.
Plus the generated freshness line.

**Phase 2**: My list, the 14-day follow-up flag, export and import.

**Phase 3**: card layout for Today, closing-soon signals, and coverage work on
the Workday primes.

## Risks

1. **Markup collision.** New chrome could break `refresh.py`'s string matching.
   Mitigated by keeping all new markup outside the tables and by the dry-run
   smoke test in CI.
2. **Row key churn.** A board that rewrites its URLs orphans saved status. The
   snapshot in My list limits the damage to a lost badge, not a lost role.
3. **Threshold tuning.** A Today view that shows nothing is worse than one that
   shows too much. The backfill rule covers the empty case, and the threshold
   stays a single named constant so it is cheap to change.
