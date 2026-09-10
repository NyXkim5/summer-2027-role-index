# Company discovery, a Found today view, and a daily email digest

Date: 2026-09-10

## The problem

`refresh.py` sweeps 149 boards listed in `sources.json` and can only ever find
jobs at companies already on that list. Nothing in the pipeline adds a company.
When a new employer starts hiring, the index stays silent until someone edits
`sources.json` by hand.

Three probes on 2026-09-10 show the size of the gap:

| Company | Where it actually is | In sources.json |
|---|---|---|
| Saronic | Ashby | yes |
| Hermeus | Lever | no |
| Apptronik | Greenhouse, 83 postings | no |
| Chaos Industries | Greenhouse, 141 postings | no |

The `lever` list holds two entries, `palantir` and `zoox`, so the whole Lever
population is unswept. Hermeus sits in it.

Two further gaps came out of the same review:

- Rows carry `<span class="tag new">4 Sep</span>`, which is the date the employer
  posted the job. Nothing records the date this index first saw it, so "what
  showed up today" cannot be answered from the page.
- The only notification path is GitHub's Watch → Releases. That needs a GitHub
  account and reaches nobody who just wants the list in their inbox.

## What gets built

Three parts, in dependency order. Part A feeds Part B, Part B feeds Part C.

### Part A. `discover.py`, a company discovery stage

Runs before `refresh.py` in the daily job.

**Candidate companies** come from two places already fetched by the pipeline,
plus GitHub:

1. Company names returned by `linkedin_guest()` that resolve to no known board
   token. This is the path that would have caught Hermeus.
2. Company names parsed from the four community tracker READMEs in `TRACKERS`,
   plus a small curated set of `awesome-*` defense, space, and AI company lists.

**Resolution.** For each candidate, generate slug variants (lowercased,
despaced, hyphenated, with and without a trailing `inc`/`technologies`/`labs`)
and probe them against four ATS APIs:

| ATS | Probe | Confirmed when |
|---|---|---|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/<slug>/jobs` | 200 and `jobs` non-empty |
| Lever | `GET api.lever.co/v0/postings/<slug>?mode=json` | 200 and list non-empty |
| Ashby | `POST jobs.ashbyhq.com/api/non-user-graphql` | `data.jobBoard` non-null and postings non-empty |

Workday is deliberately excluded from automatic discovery. A Workday source
needs four coordinates, host, tenant, site, and display name, and only the
tenant resembles the company name. There is no way to guess
`globalhr.wd5.myworkdayjobs.com / globalhr / rec_rtx_ext_gateway` from the
string "RTX". Workday candidates are instead logged to `discovered.json` with a
`needs_manual` flag so they surface as a short list to add by hand, rather than
being silently dropped.

A board is only confirmed when it returns **real postings**. An HTTP 200 alone
proves nothing: Ashby's GraphQL endpoint answers 200 with a null `jobBoard` for
every slug that does not exist, which is how `hermeus`, `castelion`, and
`firestorm-labs` all look like hits until the body is parsed.

**Confirmed boards are written into `sources.json` automatically** and named in
`CHANGELOG.md` and in the day's email.

**Slug collision is the failure mode this design takes seriously.** A short
generic slug can resolve to the wrong employer. `applied` already means Applied
Intuition in this repo and could as easily have been someone else. Two
mitigations:

- Every auto-add records evidence: ATS, slug, posting count, and one sample
  title. A wrong grab is visible in the changelog rather than silent.
- Candidates shorter than four characters are never auto-added.

**`discovered.json` is a negative cache.** Every candidate that failed
resolution is recorded with the date it was tried. Without it, discovery
re-probes the same few hundred dead names every morning: hundreds of candidates
times four ATSs times several slug variants is thousands of requests a day
against third-party APIs, for nothing. Failed candidates are retried after 30
days, since a company may adopt an ATS later.

**Caps.** At most 200 candidates resolved per run and at most 15 boards added
per run. A discovery bug cannot flood `sources.json` in a single night.

### Part B. A "Found today" view

`refresh.py` stamps `data-found="YYYY-MM-DD"` on each `<tr>` at the moment it is
appended. This is the date the index found the row, distinct from the posting
date already shown in the `tag new` span. Existing rows carry no stamp, which
correctly reads as "not found today".

A tab strip drives a new `app/found.js` that filters rows on that attribute.
When the day is quiet the view falls back to the last seven days, labelled as
such, because an empty view reads as a broken page rather than a slow day. This
mirrors the `MIN_FRESH` backfill already in `app/today.js`.

The view is read-only over the DOM the refresh script writes. It stays ignorant
of `refresh.py` and `refresh.py` stays ignorant of it, which is the existing
contract described in the README.

### Part C. The daily digest and a public mailing list

**Content.** `refresh.py` emits `digest.json`: roles added today grouped by
section, companies that entered the index for the first time called out
separately, closures as a one-line footer. `digest.py` renders it to HTML and
sends.

**Transport: Resend.** Verified on 2026-09-10:

- `POST /broadcasts` creates, `POST /broadcasts/{id}/send` sends. The docs state
  a broadcast can only be sent if it was created via the API, which is this case.
- Free tier is 3,000 emails/month, 100/day, 1,000 contacts.

EmailOctopus was rejected despite the best free tier (2,500 subscribers, 10,000
emails/month) because its v2 API exposes only `GET` for campaigns. There is no
create and no send, so a daily automated broadcast cannot be built on it.

Buttondown was not chosen because its documentation did not confirm programmatic
sending to a full list. It remains the fallback if Resend disappoints.

**Gmail SMTP is dropped.** It was adequate for a single inbox. For a public list
it caps near 500/day, handles no unsubscribes, and risks getting a personal
account flagged for bulk sending. One transport for everyone is simpler and
safer. The sender is a verified `jaykim.studio` subdomain, which earns real
deliverability instead of mail arriving from a personal Gmail address.

**Known ceiling.** A daily send consumes quota thirty times faster than the
weekly cadence these free tiers are priced for. On Resend's free tier the two
limits agree: 100 emails/day and 3,000/month both cap the list at roughly **100
subscribers**. This is documented here so growing past it is a decision rather
than a surprise outage.

**Subscribing, and why it needs a server.** The page is static on GitHub Pages,
so it cannot process a confirmation click, and Resend Audiences provides
unsubscribe but not double opt-in.

A Cloudflare Worker sits in front of Resend:

- `POST /subscribe` validates the address, creates the Resend contact with
  `unsubscribed: true`, and mails a confirmation link.
- `GET /confirm?t=<token>` verifies the token and flips `unsubscribed` to false.

The token is `base64url(email) . base64url(expiry) . base64url(HMAC-SHA256(email|expiry, secret))`.
**The token is the state**, so the Worker needs no database and no KV namespace.
Expiry is seven days, so a link that leaks does not stay live forever.

Double opt-in is required, not optional. A public input on a static page will be
bot-stuffed, and it will be used to sign other people up. Confirm-first answers
both.

**Anti-abuse on the Worker:** a honeypot field, syntax validation, CORS locked
to the Pages origin, and Cloudflare's native rate limiting keyed on
`CF-Connecting-IP`.

**Unsubscribe** uses Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}` merge tag. Every
send includes it. This is a hard requirement, not a nicety.

**Placement.** The subscribe form sits in the header, beneath the refreshed-on
stamp.

## Data flow

```
16:00 UTC, GitHub Actions
  discover.py   candidates -> probe -> sources.json, discovered.json
  refresh.py    sweep sources.json -> index.html (data-found stamps),
                stats.json, digest.json, CHANGELOG.md
  commit + push -> GitHub Pages redeploys
  digest.py     digest.json -> HTML -> Resend create + send broadcast

Any time, reader in browser
  index.html header form -> Worker POST /subscribe -> Resend contact (unsubscribed)
                                                   -> confirmation email
  reader clicks link      -> Worker GET /confirm    -> Resend contact (subscribed)
```

## Error handling

The existing safeguards stay and the new stages inherit their spirit: this
pipeline edits a curated file unattended, so every new failure mode has to fail
closed.

- Discovery failing for any reason must not stop the refresh. It is additive.
  `sources.json` is written only on success and the refresh runs regardless.
- The existing "refuse to edit if under 60% of boards answered" check still
  guards the sweep. Newly discovered boards count toward the denominator only
  after their first successful run, so adding fifteen dead boards cannot trip it.
- If the send fails, the commit still stands. The index is the source of truth
  and the email is a view of it. A failed send is logged and retried the next
  day, never resent as a duplicate.
- If `digest.json` is empty the email still goes out with a one-line quiet-day
  note, because Jay asked for a mail every morning.

## Testing

No test in this plan reaches the network. Probes run against saved fixtures.

**pytest**
- slug variant generation
- ATS response parsing, including the Ashby 200-with-null-jobBoard case that
  motivated the "confirm on postings, not status code" rule
- negative cache write, read, and 30-day retry
- caps hold at 200 candidates and 15 adds
- `digest.json` construction from a known refresh result
- HTML render includes the unsubscribe tag

**vitest**
- `found.js` filters on `data-found`
- quiet-day fallback to seven days, and its label
- rows with no stamp never appear in the view
- Worker token sign and verify, including a tampered signature and an expired token

Every assertion gets mutation-checked: break the implementation on purpose and
confirm the test goes red. A test that passes for the wrong reason is the
recurring defect in this repo's history.

## What Jay has to do

Not automatable, needs his accounts:

1. Create a Resend account, verify a `jaykim.studio` sending subdomain via DNS,
   create an Audience.
2. Add repo secrets `RESEND_API_KEY` and `RESEND_AUDIENCE_ID`.
3. Create a Cloudflare account and set Worker secrets `RESEND_API_KEY`,
   `RESEND_AUDIENCE_ID`, `HMAC_SECRET`.

Steps go in the README as they are wired.

## Out of scope

- Authenticated LinkedIn scraping. The public guest endpoint only, unchanged.
- Handshake, which needs a `.edu` login.
- Company recruiting-event pages, still JavaScript-rendered and still linked
  rather than scraped.
- Per-subscriber filtering. Everyone gets the same digest. The existing
  profile matching in `app/match.js` stays a browser-side feature.
- Migrating the existing GitHub Releases notification. It keeps working.

## Open question

Whether the digest counts as commercial email under CAN-SPAM, which would
require a physical postal address in the footer. The index is free and sells
nothing. The build includes honest sender identity and working unsubscribe
either way. Flagging it rather than deciding it.
