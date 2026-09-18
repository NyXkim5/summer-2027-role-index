# Auto-Apply Subsystem — Design

Date: 2026-09-18. Status: approved in chat, building.

## What it is

A shareable, local-first assisted-apply tool bolted onto the role index.
Each user clones the repo, runs a localhost setup UI to store their own
resumes, profile facts, and a queue of job URLs. Their Claude Code (with
the Chrome extension) then works the queue: picks the right resume by
tags, fills the real ATS form in their browser, and parks each
application at the submit button for human review. The human always
clicks submit.

## Hard rules

- No personal data in git. Everything under `apply/user/` is gitignored.
- Claude fills factual fields only. Free-text and essay boxes stay empty.
- Claude never clicks submit. It parks the form and reports.
- CAPTCHA or login wall: stop, mark the queue item `blocked`, tell the user.
- Supported ATSes v1: Greenhouse, Lever, Ashby. Anything else is marked
  `unsupported` and left for manual application.
- `serve.py` binds to 127.0.0.1 only. Python stdlib only, no dependencies.
- All writes go inside `apply/user/`. Reject path traversal in uploads.

## Layout

```
apply/
  serve.py                # localhost:8787 server (stdlib only)
  test_serve.py           # pytest, co-located
  ui/                     # static setup UI, vanilla JS (matches app/ idiom)
    index.html            # three tabs: Resumes | Profile | Queue
    apply-ui.js           # tab logic, fetch calls, rendering
    apply-ui.test.js      # vitest for pure logic (tag parse, dedupe, render data)
    apply.css
  fieldmaps/              # per-ATS playbooks for the applying agent
    greenhouse.md
    lever.md
    ashby.md
  templates/
    profile.template.json
    library.template.json
  README.md               # setup + usage guide for someone who cloned the repo
  user/                   # GITIGNORED, written by the UI / the agent
    profile.json
    library.json
    files/                # uploaded resume PDFs
    queue.json
    log.jsonl             # append-only application history
```

## API contract (serve.py)

All JSON. Errors return `{"error": "message"}` with 4xx/5xx.

- `GET /` and `GET /ui/*` — serve the static UI.
- `GET /api/profile` — returns profile.json, or the template if absent.
- `PUT /api/profile` — replace profile.json with validated body.
- `GET /api/library` — returns library.json (`{"resumes": [...]}`).
- `POST /api/resumes` — multipart: `file` (PDF), `label`, `tags` (comma
  string). Saves PDF to `user/files/<safe-name>.pdf`, appends entry
  `{id, label, file, tags: [...], added}`. Returns the entry.
- `PUT /api/resumes/<id>` — update label/tags.
- `DELETE /api/resumes/<id>` — remove entry and its file.
- `GET /api/queue` — returns queue.json (`{"items": [...]}`).
- `POST /api/queue` — body `{"urls": ["...", ...]}`. Dedupes against
  existing, detects ATS from the URL host/path, appends
  `{id, url, ats, status: "queued", added}`. Returns added items.
- `PUT /api/queue/<id>` — update status/notes (used by the agent too).
- `DELETE /api/queue/<id>` — remove an item.
- `GET /api/log` — returns log.jsonl parsed to a JSON array.

Queue item statuses: `queued → parked → submitted`, plus terminal
`skipped`, `blocked`, `unsupported`. The agent writes `parked`,
`blocked`, `unsupported`; the human marks `submitted` or `skipped` in
the UI.

## Profile schema (template)

Factual fields only: name, email, phone, location, school, degree,
major, grade_level, gpa, grad_date, linkedin, github, portfolio,
work_authorization, requires_sponsorship, veteran_status,
disability_status, gender, race_ethnicity (all EEO fields optional,
"decline" allowed), plus `custom` — a free key/value map for anything
else (clearance, languages).

## Apply flow (agent-side, no code)

User says "work the queue." The agent:
1. Reads profile, library, queue, log. Skips already-applied URLs.
2. Per queued item: fetch the JD, pick the resume whose tags best match
   the posting. Ambiguity → ask the user, never guess.
3. Reads the matching `fieldmaps/<ats>.md`, drives Chrome: fills factual
   fields, uploads the PDF, answers stored screeners, leaves free text
   empty.
4. Parks at submit, sets status `parked`, appends to log.jsonl.
5. Reports the batch: parked / blocked / unsupported.

## Testing

- `test_serve.py` (pytest): every endpoint, dedupe, ATS detection,
  upload path-safety, writes-only-inside-user/, template fallback.
- `apply-ui.test.js` (vitest): tag parsing, URL dedupe/ATS detect (if
  client-side), status rendering data. Same helper pattern as app/.
- Field maps are proven by one live end-to-end run per ATS, not unit
  tests.

## Non-goals (v1)

Workday/iCIMS support, auto-submit, hosted multi-user service, cover
letter generation, index-site "→ Queue" button, scheduling.
