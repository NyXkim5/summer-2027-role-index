# Open follow-ups from the triage views branch

Recorded 2026-09-04. All were found by review, judged real, and deliberately not
fixed. None blocks the branch. Ordered by what I would do first.

## Product decisions that are yours, not mine

**The no-change-day freshness date.** `refresh.py` returns early when a run adds,
closes and prunes nothing, so the `#verified` date keeps yesterday's value even
though the links were genuinely re-requested. Making it honest means the daily
Action commits a date bump on quiet days. That is a trade between an accurate
freshness claim and commit noise.

**Apply and undo.** The spec says clicking Apply opens the link and marks the row
applied, with an undo. What shipped is a separate Open link plus an Applied
toggle, and the toggle is the undo. Splitting them is arguably better, since a
reader may want to look without claiming they applied.

## Real defects, low frequency

**`t:` key orphaning.** A row keyed by URL flips to a company-and-title key the
moment `refresh.py` appends a second row sharing its normalized URL, because the
collision pass reassigns the whole group including the incumbent. A saved or
dismissed mark on that row is orphaned. Costs one lost badge, a handful of times
over the page's life. Cheapest mitigation is a status lookup that falls back to
the alternate key on a miss.

**The `t:` fallback ignores location and URL.** Two different postings with the
same company and title collapse. 13 groups covering about 30 rows on the current
page (SpaceX twice, Amex NY and Atlanta, Cloudflare, West Monroe, L3Harris) are
kept apart today only by having distinct URLs.

**Read-ok, write-blocked storage shows no banner.** `boot.js` reads the degraded
reason before the first write is attempted, so a browser that reads but refuses
to write tells the reader nothing. Pre-existing, not introduced by this branch.

## Polish

- `history.replaceState` over `file://` is unverified. Chrome has historically
  thrown on a null-origin document. Pre-existing and byte-identical to the code
  that shipped before this branch, but `file://` is load-bearing in the spec.
  Thirty seconds in a real browser settles it.
- "posted N days ago" renders only for rows inside the 7 day window, 6 of 15
  cards today. The spec promises it on every entry. Spec overreach, not a defect.
- "Nothing new matched your profile" can appear while eligible untouched rows
  remain, because the copy does not account for the daily cap.
- The Today section creates an `<h2>`, and `<h2>` is what defines a section in
  `rowindex.js`. Harmless today, a phantom section head for any future caller.
- `hideDismissed` is absent from the URL state, so a reader who turns it off
  cannot share that view.

## Not code

**Five rows in `index.html` are genuine duplicates**, byte-identical in company,
title and URL. Two groups: Kearney at lines 662, 740 and 786, and Arrowstreet at
663 and 741. They correctly share a row key. They should probably be deduped in
the source data.

## Phase 2, per the spec

My list, the 14 day follow-up flag, and export and import were always phase 2 and
are not built. A saved role whose row is later pruned survives correctly in
storage with a full snapshot, but there is no surface that renders it yet.
