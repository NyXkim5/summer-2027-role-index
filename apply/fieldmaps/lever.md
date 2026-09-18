# Lever fieldmap

Playbook for the applying agent driving Chrome on a Lever job form.
Current as of late 2026. Follow the shared rules in `apply/README.md`:
resume matching and pinning, re-run safety, single writer, the parking
procedure, the park-proof check, and the log record schema. State
changes go through the HTTP API only.

Lever forms are mostly plain HTML inputs, so `form_input` works on
them. The location field is the exception. It is a scripted typeahead
and needs keystrokes.

Per-widget verify rule: after filling any widget, re-read its value and
confirm it took before moving to the next one. If it did not take,
retry once with keystrokes, then add the field to `fields_pending`.

## 1. URL patterns and job-id extraction

| Pattern | Example | Job id |
|---|---|---|
| `jobs.lever.co/<company>/<uuid>` | `jobs.lever.co/acme/5c7d0b8e-...` | UUID path segment |
| `jobs.lever.co/<company>/<uuid>/apply` | same with `/apply` | same |
| EU tenant `jobs.eu.lever.co/<company>/<uuid>` | | same |

The posting page and the form are separate. Append `/apply` to reach
the form. Log key: copy the `key` field serve.py stored on the queue
item. Its format is `lever:<uuid>`.

## 2. Field table

| profile.json key | ATS label text (variants) | Widget | Fill method |
|---|---|---|---|
| `name` | Full name | text input | form_input |
| `email` | Email | text input | form_input |
| `phone` | Phone | text input | form_input |
| `location` | Current location | scripted typeahead | keystroke, then click the matching suggestion |
| `custom` (only if a matching key exists) | Current company | text input | form_input |
| `linkedin` | LinkedIn URL (under Links) | text input | form_input |
| `github` | GitHub URL (under Links) | text input | form_input |
| `portfolio` | Portfolio URL, Other website (under Links) | text input | form_input |
| `work_authorization` | Are you legally authorized to work in the United States? | posting-specific card, radio or select | click-dropdown |
| `requires_sponsorship` | Will you now or in the future require sponsorship? | posting-specific card, radio or select | click-dropdown |
| `gender` | Gender | select in the EEO block | click-dropdown |
| `race_ethnicity` | Race, Ethnicity | select in the EEO block | click-dropdown |
| `veteran_status` | Veteran status | select in the EEO block | click-dropdown |
| `disability_status` | Disability status | select in the EEO block | click-dropdown |

Lever has no standard education section. School, degree, major, and
graduation date only appear as posting-specific cards. When they do,
fill them from the profile keys and verify like any other widget.

EEO handling: the block is titled U.S. Equal Employment Opportunity
information and every select includes "Decline to self-identify". If
the profile value is `decline`, pick that option. If the profile value
is empty, leave the question untouched and list it in `fields_pending`.

The "Additional information" box at the bottom is free text. Leave it
empty.

## 3. Resume upload

Upload the resume FIRST on Lever. The `ATTACH RESUME/CV` control feeds
a parser that autofills name, email, phone, and links, overwriting
anything already typed. Order of operations:

1. Click `ATTACH RESUME/CV`, upload `apply/user/files/<file>` from the
   matched library entry.
2. Wait for the filename to render as `Success` next to the control.
3. Then fill and verify every field in the table, correcting whatever
   the parser guessed wrong.

## 4. Screener handling

Lever screeners are per-posting cards between the profile section and
the EEO block. Answer a card only when the answer exists in the
profile. Work authorization and sponsorship come from their profile
keys. Other factual cards may match a key in `profile.custom` by label.
Anything else stays empty and goes into `screeners_unanswered`.
Free-text boxes and essays always stay empty, no exceptions. A required
unanswered card does not stop the run. Fill everything else, then park
with it listed.

## 5. Park signal

Stop at the button with the exact text `Submit application`. Never
click it. When the button is in view and every widget above it is
filled or recorded as pending, run the park-proof check from
`apply/README.md`, then PUT the park notes and write the log line.

## 6. Known failure modes

- hCaptcha above submit. Many Lever postings render an hCaptcha widget
  directly above the submit button. If it is a passive checkbox that
  has not been triggered, still park normally and note its presence.
  If a challenge appears or the checkbox demands interaction, mark the
  item `blocked` with a note and stop. Never attempt to solve it.
- Parser overwrite. Filling fields before the resume upload wastes the
  work. Upload first, then fill.
- Location suggestion required. Typing a city without clicking a
  suggestion can leave the underlying value empty. The verify rule
  catches this. Click the suggestion.
- Posting page vs form. `/apply` missing from the URL means you are on
  the description page. The apply button there scrolls or navigates to
  the form.
- EU tenant. `jobs.eu.lever.co` behaves identically. Keep the log key
  as `lever:<uuid>`.
- Login wall. Rare, but internal or referral postings can require
  login. Mark `blocked` and stop.
