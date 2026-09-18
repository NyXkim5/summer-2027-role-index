# Assisted apply

A local-first tool that lets your own Claude Code fill job applications
in your own browser. You store resumes, profile facts, and a queue of
job URLs on your machine. Claude works the queue: it picks a resume,
fills the ATS form in Chrome, and parks each application at the submit
button. You review and click submit yourself. Always.

Supported ATSes: Greenhouse, Lever, Ashby. Anything else is marked
`unsupported` and left for manual application.

## Setup

From the repo root:

```
cp apply/templates/profile.template.json apply/user/profile.json
cp apply/templates/library.template.json apply/user/library.json
python3 apply/serve.py
```

Open http://localhost:8787. The server needs Python 3 and nothing
else. It binds to 127.0.0.1 only, so nothing is exposed to your
network. The copy step is optional. The server falls back to the
templates when `apply/user/` files are absent, and the UI creates them
on first save.

If you hand-edit a copied profile, keeping the `_comments` block on
disk is fine. The UI drops it on save. A raw `PUT /api/profile` that
still includes `_comments` gets a 400, so strip it before scripting
against the API.

## The three tabs

- **Resumes.** Upload resume PDFs. Give each one a short label and a
  set of tags, for example `ml, python, research`. Tags drive resume
  matching, so tag by what the resume emphasizes.
- **Profile.** Factual fields only: contact info, address, school,
  links, work authorization, screener answers, and optional EEO
  answers. Every EEO field accepts the canonical value `decline`, and
  the fieldmaps translate it into each ATS's own wording. The `custom`
  map holds anything else, for example clearance or languages. See the
  comments in `apply/templates/profile.template.json` and the field
  notes below.
- **Queue.** Paste job URLs, one or many. The server dedupes them,
  detects the ATS, and tracks status. You also use this tab to mark
  parked items `submitted` or `skipped` after you review them.

Statuses: `queued` then `parked` then `submitted`, plus terminal
`skipped`, `blocked`, and `unsupported`. The agent writes `parked`,
`blocked`, and `unsupported`, plus `skipped` when the ghost-listing
check fails. Only you mark `submitted`, and only you mark `skipped`
on items you reviewed yourself.

### Profile fields worth knowing

- **Sponsorship is two answers, not one.** Forms phrase it two ways.
  `requires_sponsorship_now` answers current-role questions like "Do
  you require sponsorship for this role?". `requires_sponsorship_future`
  answers the "now or in the future" phrasing. These can differ. An
  F-1 student on CPT often answers No now and Yes in the future. The
  legacy `requires_sponsorship` field remains as a fallback when a
  scoped field is empty.
- **Address carries both shapes.** `address.single_line` for Greenhouse
  style one-line location fields. `address.structured` with street,
  city, state, and zip for Lever and Ashby style split fields.
- **High-frequency screeners have dedicated fields.**
  `willing_to_relocate`, `willing_onsite`, `willing_travel_pct`,
  `start_availability`, `desired_compensation`, and `drivers_license`.
  Fill them once and the agent answers those screeners everywhere.
  Leave `desired_compensation` empty to never volunteer a number.
- **EEO answers are canonical.** Store `decline` once. The fieldmaps
  translate it per ATS: "Decline to self-identify" on Greenhouse, "I
  do not wish to answer" on Lever, "Prefer not to say" on Ashby.

## Working the queue

With the server running and Claude Code connected to Chrome, say:

> Work the apply queue. Read apply/README.md first.

The agent reads your profile, library, queue, and log, then handles
each queued item using the matching playbook in `apply/fieldmaps/`.
For each item it fetches the job description, runs the ghost-listing
check, picks a resume, fills the form in your browser, uploads the
PDF, and parks at the submit button. It then reports the batch:
parked, blocked, unsupported, skipped.

You can scope it too: "work the queue but only the Greenhouse items"
or "apply to the Stripe one first".

### What the agent will do

- Check each listing for staleness before filling. A stale or ghost
  listing is marked `skipped` with a note, and you get told.
- Fill factual fields from your profile and verify each one took.
- Upload the resume it matched, or the one you pinned.
- Answer screeners whose answers exist in your profile, including
  work authorization, both sponsorship scopes, relocation, onsite,
  travel, start date, compensation, and driver's license.
- Pick the right decline option per ATS on EEO questions when you set
  `decline`.
- Ask you one question when resume matching is ambiguous.

### What the agent will not do

- It never clicks submit. Every application parks for your review.
- It never writes essays or free-text answers. Those boxes stay empty
  and get listed for you.
- It never guesses. Unknown screeners are left blank and reported.
- It stops at CAPTCHAs and login walls. The item is marked `blocked`
  with a note, and solving is on you.
- It never touches non-supported ATSes beyond marking them
  `unsupported`.

## Rules for the applying agent

The fieldmaps reference these rules. They bind every run.

### Ghost-listing check

Run this on every item before picking a resume or filling anything.
It is a cheap sanity screen that keeps dead reqs from wasting parked
slots and your review time. From the posting page, check:

1. The posted date is within about 30 days.
2. A real requisition id is visible (job id in the URL or on the page).
3. The company has other live postings on the same board.

A listing that fails the check is stale or a ghost. Mark it `skipped`
via `PUT /api/queue/<id>` with a note saying which check failed, write
the log line with `event: "skipped"`, and tell the user in the batch
report. Do not fill it. If the signals are mixed, for example an old
post date but an active board, ask the user instead of deciding.

### Resume matching

Score each resume in the library by tag-token overlap with the job
title and body keywords. A unique top score wins. Record the winner on
the queue item as `resume_id` via `PUT /api/queue/<id>`. On a tie or
zero overlap, ask the user one question and PUT the answer back as
`resume_id`. Never guess.

### Pinning

A queue item with `resume_id` already set is pinned. The pinned resume
always wins. Do not re-score.

### Re-run safety

Before driving Chrome on an item, PUT `attempts` incremented by 1 and
`last_attempt` set to now onto the item. An item with status `queued`
and `attempts > 0` means a previous run touched it. Inspect the open
tab and `log.jsonl` first, then resume the existing form or reopen it
deliberately. Never blind-fill a page you have not inspected.

### Single writer

The applying agent updates state only through the HTTP API on
localhost:8787. It never edits files under `apply/user/` directly.
There are two exceptions. It reads resume PDFs from
`apply/user/files/` to upload them. It appends log lines to
`apply/user/log.jsonl`, which serve.py only ever reads.

### Parking procedure

Parking an item requires structured notes PUT onto the queue item:

```json
{
  "resume_id": "which resume was uploaded",
  "fields_pending": ["fields the agent could not fill"],
  "screeners_unanswered": ["screener questions left blank"],
  "free_text": "one line naming any essay boxes left empty on purpose"
}
```

Plus exactly one line appended to `apply/user/log.jsonl`:

```json
{
  "ts": "ISO 8601 timestamp",
  "key": "the queue item key, for example greenhouse:acme:4567890123",
  "item_id": "queue item id",
  "url": "the application URL",
  "event": "parked | blocked | unsupported | skipped | submitted",
  "resume_id": "resume used, null if none",
  "fields_filled": ["profile keys that were filled and verified"],
  "fields_pending": ["fields left unfilled"],
  "note": "one line of human-readable context"
}
```

The `key` is the `key` field serve.py stored on the queue item. Copy
it verbatim. It is what dedupes across runs.

### Park-proof

Before writing `parked`, the agent re-reads the page and confirms:

1. Every field in the fieldmap table is filled or listed in
   `fields_pending`.
2. The resume filename appears in the upload widget.

A park that fails this check is written as `blocked` with a note
instead. A false `parked` is worse than a `blocked`, because you would
review and submit an incomplete application.

## Privacy model

Everything personal lives under `apply/user/`, and `apply/user/` is
gitignored. Your profile, resumes, queue, and history never enter git.
The repo ships only templates, playbooks, and code. You can push,
pull, and share this repo freely. Check `git status` after a session
if you want to confirm: nothing under `apply/user/` should ever
appear.
