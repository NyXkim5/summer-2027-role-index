# Greenhouse fieldmap

Playbook for the applying agent driving Chrome on a Greenhouse job form.
Current as of late 2026. Follow the shared rules in `apply/README.md`:
resume matching and pinning, re-run safety, single writer, the parking
procedure, the park-proof check, and the log record schema. State
changes go through the HTTP API only.

Greenhouse renders React controlled inputs. A plain DOM write to
`element.value` gets dropped on the next render. Fill with `form_input`
or real keystrokes so React receives input events.

Per-widget verify rule: after filling any widget, re-read its value and
confirm it took before moving to the next one. If it did not take,
retry once with keystrokes, then add the field to `fields_pending`.

## 1. URL patterns and job-id extraction

| Pattern | Example | Job id |
|---|---|---|
| `job-boards.greenhouse.io/<company>/jobs/<id>` | `job-boards.greenhouse.io/acme/jobs/4567890123` | numeric path segment after `/jobs/` |
| `boards.greenhouse.io/<company>/jobs/<id>` | `boards.greenhouse.io/acme/jobs/4567890123` | same |
| Embedded board on a company site | `acme.com/careers?gh_jid=4567890123` | `gh_jid` query param |

Log key: copy the `key` field serve.py stored on the queue item. Its
format is `greenhouse:<board-slug>:<job-id>`, for example
`greenhouse:acme:4567890123`. For embedded boards, prefer opening the
direct `job-boards.greenhouse.io` URL. The embed lives in an iframe
(`#grnhse_iframe`) and is harder to drive.

## 2. Field table

| profile.json key | ATS label text (variants) | Widget | Fill method |
|---|---|---|---|
| `name` (before last space) | First Name | text input | form_input |
| `name` (after last space) | Last Name | text input | form_input |
| `email` | Email | text input | form_input |
| `phone` | Phone | text input | form_input |
| `location` | Location (City), City, Current Location | typeahead | keystroke, then click the matching suggestion |
| `school` | School, University | searchable select (react-select) | keystroke at least 3 chars, then click the option |
| `degree` | Degree | searchable select | keystroke, then click the option |
| `major` | Discipline, Major, Field of Study | searchable select | keystroke, then click the option |
| `grad_date` | End Date, Expected Graduation Date | month and year selects, or a screener text input | click-dropdown per part, form_input if text |
| `linkedin` | LinkedIn Profile, LinkedIn URL | text input | form_input |
| `github` | GitHub, Website, Other Website | text input | form_input |
| `portfolio` | Portfolio, Website | text input | form_input |
| `work_authorization` | Are you legally authorized to work in the United States? | radio or select | click-dropdown |
| `requires_sponsorship` | Will you now or in the future require sponsorship for employment visa status? | radio or select | click-dropdown |
| `gender` | Gender | select in the EEO block | click-dropdown |
| `race_ethnicity` | Are you Hispanic/Latino?, Race, Ethnicity | selects in the EEO block | click-dropdown |
| `veteran_status` | Veteran Status | select in the EEO block | click-dropdown |
| `disability_status` | Disability Status (form CC-305) | radio group | click-dropdown |

EEO handling: the block is titled Voluntary Self-Identification. Every
question has a decline option, usually "Decline To Self Identify" or
"I don't wish to answer". If the profile value is `decline`, pick that
option. If the profile value is empty, leave the question untouched and
list it in `fields_pending`.

## 3. Resume upload

The Resume/CV widget offers Attach, Dropbox, Google Drive, and Enter
manually. Always use Attach. It triggers an `input[type=file]`. Upload
the PDF at `apply/user/files/<file>` from the matched library entry.

Verify: the filename renders next to the widget when the upload
finishes. Some boards parse the resume and overwrite fields you already
filled. Upload first when possible. Either way, re-verify every field in
the table after the upload completes.

Cover letter widget: leave it empty.

## 4. Screener handling

Answer a screener only when the answer exists in the profile. Work
authorization and sponsorship come from their profile keys. Other
factual screeners may match a key in `profile.custom` by label. Anything
else stays empty and goes into `screeners_unanswered`. Free-text boxes
and essays always stay empty, no exceptions. A required unanswered
screener does not stop the run. Fill everything else, then park with it
listed.

## 5. Park signal

Stop at the button with the exact text `Submit application`. Older
boards on `boards.greenhouse.io` show `Submit Application`. Treat any
button whose text starts with Submit as the stop line. Never click it.
When the button is in view and every widget above it is filled or
recorded as pending, run the park-proof check from `apply/README.md`,
then PUT the park notes and write the log line.

## 6. Known failure modes

- Controlled-input drops. React discards plain DOM writes. Symptom: the
  field looks filled, then blanks on the next interaction. The verify
  rule catches this. Refill with keystrokes.
- Iframe embeds. Company career pages embed the form in
  `#grnhse_iframe`. Open the direct job-boards URL instead.
- Async select options. School and degree options load after you type.
  Type at least 3 characters and wait for the list before clicking.
- Resume parsing overwrites fields. Re-verify all fields after upload.
- hCaptcha. Some boards show a CAPTCHA near submit. Mark the item
  `blocked` with a note and stop. Never attempt to solve it.
- Login wall. Rare on Greenhouse, but some boards require an account.
  Mark `blocked` and stop.
- Demographic questions duplicated. A board can show both the US EEO
  block and a custom demographic survey. Fill the EEO block from the
  profile. Leave the custom survey empty and list it as pending.
