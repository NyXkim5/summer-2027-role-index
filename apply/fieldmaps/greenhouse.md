# Greenhouse fieldmap

Playbook for the applying agent driving Chrome on a Greenhouse job form.
Current as of late 2026. Follow the shared rules in `apply/README.md`:
the ghost-listing check, resume matching and pinning, re-run safety,
single writer, the parking procedure, the park-proof check, and the log
record schema. State changes go through the HTTP API only.

Greenhouse is the most filler-friendly of the three ATSes. Forms are
server-rendered HTML with stable field ids. Custom questions come in
exactly 5 types: short answer, long answer, single select, multi
select, file.

Greenhouse renders React controlled inputs. A plain DOM write to
`element.value` gets dropped on the next render. Fill with `form_input`
or real keystrokes so React receives input events.

Per-widget verify rule: after filling any widget, re-read its value and
confirm it took before moving to the next one. If it did not take,
retry once with keystrokes, then add the field to `fields_pending`.

### Pre-render question schema

The public job board API exposes the application question schema as
JSON before the form renders:

```
https://boards-api.greenhouse.io/v1/boards/<company>/jobs/<id>?questions=true
```

Fetch it first. It tells you every question, its type, whether it is
required, and its options, before you touch the page. Use it to plan
which profile keys you will need, to spot required free-text questions
early, and to read the posting date for the ghost-listing check.

### Combobox rule (applies to every dropdown here)

Greenhouse dropdowns are W3C combobox custom components, not native
selects. Options do not exist in the DOM until the control is opened.
Synthetic untrusted clicks are often ignored. Typing filters the
option list, and text that matches no option leaves the list empty
while the typed text strands in the field looking filled with nothing
selected. Rule: open the control, wait for options to render, pick by
meaning, then re-read the committed value to confirm the selection
registered.

Greenhouse specifics: the widgets are react-select. Option elements
get ids like `react-select-<id>-option-<n>`. There is a hidden
`input[required][aria-hidden=true]` inside `.select-shell` that must
receive the value, with input, change, and blur events dispatched, or
server validation fails even though the control looks selected.
Verify a dropdown by reading that hidden input, not the visible text.

## 1. URL patterns and job-id extraction

| Pattern | Example | Job id |
|---|---|---|
| `job-boards.greenhouse.io/<company>/jobs/<id>` | `job-boards.greenhouse.io/acme/jobs/4567890123` | numeric path segment after `/jobs/` |
| `boards.greenhouse.io/<company>/jobs/<id>` | `boards.greenhouse.io/acme/jobs/4567890123` | same |
| Embedded board on a company site | `acme.com/careers?gh_jid=4567890123` | `gh_jid` query param |

Both hosts are live and behave the same. Log key: copy the `key` field
serve.py stored on the queue item. Its format is
`greenhouse:<board-slug>:<job-id>`, for example
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
| `location` or `address.single_line` | Location (City), City, Current Location | typeahead | keystroke, then click the matching suggestion |
| `school` | School, University | searchable select (react-select) | keystroke at least 3 chars, then click the option |
| `degree` | Degree | searchable select | keystroke, then click the option |
| `major` | Discipline, Major, Field of Study | searchable select | keystroke, then click the option |
| `grad_date` | End Date, Expected Graduation Date | month and year selects, or a screener text input | click-dropdown per part, form_input if text |
| `linkedin` | LinkedIn Profile, LinkedIn URL | text input | form_input |
| `github` | GitHub, Website, Other Website | text input | form_input |
| `portfolio` | Portfolio, Website | text input | form_input |
| `work_authorization` | Are you legally authorized to work in the United States? | radio or select | click-dropdown |
| `requires_sponsorship_future` | Will you now or in the future require sponsorship for employment visa status? | radio or select | click-dropdown |
| `requires_sponsorship_now` | Do you require sponsorship to work in this role? Do you currently require sponsorship? | radio or select | click-dropdown |
| `gender` | Gender | select in the EEO block | click-dropdown |
| `race_ethnicity` | Are you Hispanic/Latino?, Race, Ethnicity | selects in the EEO block | click-dropdown |
| `veteran_status` | Veteran Status | select in the EEO block | click-dropdown |
| `disability_status` | Disability Status (form CC-305) | radio group | click-dropdown |

Address: Greenhouse usually wants one single-line location. Use
`address.single_line`, falling back to `location`. Structured
street/city/state/zip fields are rare here.

Sponsorship is two questions, not one. "Now or in the future" wording
maps to `requires_sponsorship_future`. Current-role wording maps to
`requires_sponsorship_now`. Read the question scope before picking the
key. If only the legacy `requires_sponsorship` is set, use it for
either phrasing.

EEO handling: the block is titled Voluntary Self-Identification. Every
question has a decline option. Store the canonical value `decline` in
the profile and translate it here:

| Canonical profile value | Greenhouse option text |
|---|---|
| `decline` | Decline to self-identify |

Older boards may word it "Decline To Self Identify" or "I don't wish
to answer". Pick the option whose meaning is declining, whatever the
exact casing. If the profile value is empty, leave the question
untouched and list it in `fields_pending`.

## 3. Resume upload

The Resume/CV widget offers Attach, Dropbox, Google Drive, and Enter
manually. Always use Attach. It is a standard `input#resume` file
input and takes the file directly, the most reliable upload of the
three ATSes. Upload the PDF at `apply/user/files/<file>` from the
matched library entry.

Verify: the filename renders next to the widget when the upload
finishes. Some boards parse the resume and overwrite fields you already
filled. Upload first when possible. Either way, re-verify every field in
the table after the upload completes.

Cover letter widget: leave it empty.

## 4. Screener handling

Answer a screener only when the answer exists in the profile. Work
authorization and sponsorship come from their profile keys. These
high-frequency screeners map to dedicated profile keys:

| profile.json key | Common phrasings |
|---|---|
| `willing_to_relocate` | Are you willing to relocate? |
| `willing_onsite` | Are you able to work onsite? This role requires X days in office, can you commit? |
| `willing_travel_pct` | Are you willing to travel N% of the time? |
| `start_availability` | When can you start? What is your earliest start date? |
| `desired_compensation` | What are your salary expectations? Desired compensation? |
| `drivers_license` | Do you have a valid driver's license? |

Other factual screeners may match a key in `profile.custom` by label.
Anything else stays empty and goes into `screeners_unanswered`.
Free-text boxes and essays always stay empty, no exceptions. A required
unanswered screener does not stop the run. Fill everything else, then
park with it listed.

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
- Hidden required input unset. The visible react-select shows a value
  but the hidden `input[required][aria-hidden=true]` in `.select-shell`
  never received it, so the server rejects the submit. Verify dropdowns
  by reading the hidden input.
- Stranded combobox text. Typed text matched no option, the list went
  empty, and the field looks filled with nothing selected. The combobox
  rule catches this. Re-read the committed value.
- Iframe embeds. Company career pages embed the form in
  `#grnhse_iframe`. Open the direct job-boards URL instead.
- Async select options. School and degree options load after you type.
  Type at least 3 characters and wait for the list before clicking.
- Resume parsing overwrites fields. Re-verify all fields after upload.
- CAPTCHA. Appears as a reCAPTCHA iframe near submit. Detect it by an
  iframe whose src contains `recaptcha` (some boards use hCaptcha,
  same check with `hcaptcha`). Mark the item `blocked` with a note and
  stop. Never attempt to solve it.
- Login wall. Rare on Greenhouse, but some boards require an account.
  Mark `blocked` and stop.
- Demographic questions duplicated. A board can show both the US EEO
  block and a custom demographic survey. Fill the EEO block from the
  profile. Leave the custom survey empty and list it as pending.

## Live-run lessons (2026-09-18, Anduril 4802146007)

- The Country combobox silently dropped a `form_input` write. The verify
  rule caught it. Fix: open the flyout and click the country option.
- Education selects behaved exactly as the tables above say: type 3+
  chars, wait, click the option, confirm the X-to-clear icon renders.
  The X icon next to a select's value is the committed-selection signal.
- A dropdown option list can render below the fold. Typing filters it,
  then Enter commits the highlighted option. Verify after.
- "How did you hear" had no job-board option on this board; `Other`
  plus the specify box worked.
- Question scope matters more than the fieldmap can encode: this board
  asked a compound screener (experience AND able to start full time in
  2026). Answer the compound fact truthfully even when it hurts, and
  put a fit flag in the park notes.

## Sources

- openapplier.com, "Greenhouse, Lever, Ashby: a form-filler's view"
  (blog/greenhouse-lever-ashby-fillers-view)
- veloapply.com autofill-failure analysis
- github.com/AkbarDevop/ai-job-agent answer bank, built over 228
  submitted applications
