# Summer 2027 Role Index

A hand-verified index of Summer 2027 internships, new grad roles, and early-career
business positions. 372 listings across 11 sections. Every link was re-requested on
31 Aug 2026.

**[View the index →](https://nyxkim5.github.io/summer-2027-role-index/)**

## Why this exists

The community trackers index five categories: software engineering, product, data
science, quant, and hardware. That is it. Every business operations, strategy, GTM,
policy, partnerships, and consulting role is invisible to them, because those roles
post as **Associate**, **Analyst**, or **Coordinator** and never say "intern".

This index covers those too. They came from reading company job boards directly.

## Sections

| Section | Rows | What it covers |
|---|---|---|
| Big-name programs | 56 | What is actually open at Apple, Amazon, Google, Microsoft, Meta, Citi, Disney and the primes |
| Defense & national security | 38 | Product, analyst, BD, and design at Palantir, Anduril, Booz Allen, CACI, Leidos, the primes |
| Frontier tech, energy & space | 29 | SpaceX, Zipline, Base Power, Kairos, Rocket Lab, Shield AI, Applied Intuition |
| AI research & residencies | 14 | Roles with no LeetCode round |
| Product management | 39 | PM internships and new grad APM |
| Business, strategy & operations | 76 | The section the trackers do not have |
| Analyst, strategy & quant | 38 | Banking, consulting, and quant summer analyst programs |
| Engineering at product companies | 18 | Notion, Figma, Replit, Sentry, Databricks, Epic, Stryker |
| Full-time & new grad | 46 | Apply now, start after graduation |
| No-whiteboard companies | 13 | Documented take-home or pairing processes |
| Trackers & tooling | 5 | Where the raw data comes from |

## How it was built

Direct API sweeps, not scraping:

- 99 Greenhouse, Lever, and Ashby boards, filtered on `first_published` / `publishedAt`
- 23 Workday tenants via the `wday/cxs` job search endpoint
- The Amazon jobs API
- Apple, Microsoft, Google, and Meta driven in a browser, since all four block scripted requests
- Cross-read against the SimplifyJobs Summer 2027 and New-Grad trackers

Roles that close are marked `closed` rather than deleted, so you can see what moved.

## Search and filters

The page has a sticky filter bar with a live search box and chip filters for
**field** (Software, Data/AI/ML, Product/Design, Business/Ops, Finance, Quant,
Hardware/EE, Mech/Aero, Policy/Legal), **term** (Summer 2027, Spring 2027,
Fall 2026), **type** (internship vs new grad), and a **hide closed** toggle.
Filters stack, each chip shows how many rows it matches, and the live count
reads "126 of 462".

Two things worth knowing:

- **Field is inferred from the role title**, not declared by the employer. There is
  no major field in any of these job feeds. A "Business Analyst, Data Platform"
  can land under both Business and Data, which is usually what you want, but it
  is a heuristic rather than ground truth.
- **Filter state lives in the URL**, so a filtered view is a shareable link. Send
  someone `#field=finance&type=intern` and they land on exactly that view.

The UI derives every filter from row text at load time, so it knows nothing about
the refresh script and the refresh script knows nothing about it. Rows added by
tomorrow's automated run are filterable with no coordination between the two.

## Automatic daily refresh

A GitHub Action runs [`refresh.py`](refresh.py) every day at 16:00 UTC (9am Pacific)
and commits any change. GitHub Pages redeploys on its own, so the live page stays
current without anyone touching it.

Each run:

1. Sweeps all 124 boards in [`sources.json`](sources.json) concurrently, plus LinkedIn's public job endpoint and four community trackers
2. Appends genuinely new early-career postings to the matching section, date-tagged
3. Tags roles that fell off their board as `closed` rather than deleting them
4. Rewrites the refreshed-on stamp and role count, and logs the diff to [CHANGELOG.md](CHANGELOG.md)

Safeguards, because an automated editor loose in a curated file is a bad idea:

- **Append and tag only.** It never rewrites or deletes a curated row, so hand-written
  notes, bold callouts, and section prose survive every run.
- **Absence has to be provable.** A role is only marked closed if its board was fully
  enumerated on that run. Workday is search-only and Oracle, Apple, and Amazon are not
  swept, so rows from those are never auto-closed. That is 182 of the current rows.
- **It refuses to edit** if more than 40% of boards failed, so a network blip cannot
  mass-close the page.
- **New rows are capped** at 40 per run for curated sections, 60 for the wide net.
- **The wide net self-trims.** LinkedIn returns a rotating slice, so that section
  would otherwise grow every day forever. It is held at 150 rows, oldest dropped
  first. Only auto-generated rows are ever trimmed; curated rows are never removed.

Run it yourself with `python3 refresh.py --dry-run` to see the diff without writing,
or trigger the Action manually from the Actions tab.

## Going deeper than the mainstream trackers

The big repos all read the same five categories from the same ATS boards. Three
extra sources are wired in here, chosen because they were actually testable:

**LinkedIn's logged-out job search.** The `jobs-guest` endpoint is what LinkedIn
serves a signed-out visitor, so no account, cookie, or credential is involved.
It reaches a population no "software engineering internship" tracker indexes:
rotational programs, leadership development programs, graduate analyst schemes,
and investment banking summer analyst classes. On a single 7-day pull, 191 postings
came back and 161 were from companies that appear nowhere else in this index.

**Four community trackers** beyond SimplifyJobs: vanshb03, sndsh404, ApplyGuy, and
RiverStream85 (quant-specific). vanshb03 alone carried ~220 companies this index
did not have.

**Recruiting events and career fairs**, as curated links rather than a scraped feed.

Everything from the first two lands in its own **Deep sweep** section, tagged with
where it came from, and never mixes into the hand-checked sections above it.
Staffing agencies, job aggregators, and agency-side recruiting roles are filtered out.

### What is deliberately not automated

- **Company recruiting-event pages.** Checked Jane Street, Citadel, Optiver, IMC,
  SIG, Two Sigma, HRT, DRW, Jump, Palantir, and Anduril. Every one renders its event
  dates in JavaScript, so a static fetch returns an empty shell. A scraper here would
  break constantly, so the events section links to the pages instead.
- **Handshake.** Where most schools actually post their fairs and employer info
  sessions, but it needs your own .edu login. Not automatable from a public repo.
- **LinkedIn recruiter feed posts.** The "DM me for a referral" posts. These require
  an authenticated session and scraping them is against LinkedIn's terms, so this
  repo does not touch them. Only the public job endpoint is used.

## Get notified when listings change

The daily job cuts a **GitHub Release** whenever the index actually changes. The
release note carries the new total, what was added, what closed, and a per-section
breakdown. Two ways to receive it:

- **Email.** Click **Watch → Custom → Releases** at the top of this repo. GitHub
  emails you on each release. Unsubscribe any time from the same menu.
- **Feed reader.** Subscribe to
  [`releases.atom`](https://github.com/NyXkim5/summer-2027-role-index/releases.atom).
  No account needed.

Starring the repo does **not** subscribe you, and that is deliberate. This repo does
not collect, store, or email anyone's address. GitHub's terms prohibit harvesting
user emails from the API for unsolicited mail, and a star is not consent to be
contacted, so notifications are opt-in through GitHub's own Watch setting. If you
want a real mailing list later, that needs a proper subscribe-and-confirm flow, not
a scraped stargazer list.

Releases only fire on days something changed, so a quiet week means a quiet inbox.

## Contributing

Found a dead link or a role that belongs here? Open an issue. Pull requests welcome.

## License

MIT for the code. The listings are public job postings and belong to the companies
that posted them. Always apply on the company's own site.
