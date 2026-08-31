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

## Automatic daily refresh

A GitHub Action runs [`refresh.py`](refresh.py) every day at 16:00 UTC (9am Pacific)
and commits any change. GitHub Pages redeploys on its own, so the live page stays
current without anyone touching it.

Each run:

1. Sweeps all 124 boards in [`sources.json`](sources.json) concurrently
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
- **New rows are capped** at 40 per run.

Run it yourself with `python3 refresh.py --dry-run` to see the diff without writing,
or trigger the Action manually from the Actions tab.

## Contributing

Found a dead link or a role that belongs here? Open an issue. Pull requests welcome.

## License

MIT for the code. The listings are public job postings and belong to the companies
that posted them. Always apply on the company's own site.
