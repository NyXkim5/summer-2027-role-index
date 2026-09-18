# Ashby fieldmap

Playbook for the applying agent driving Chrome on an Ashby job form.
Current as of late 2026. Follow the shared rules in `apply/README.md`:
the ghost-listing check, resume matching and pinning, re-run safety,
single writer, the parking procedure, the park-proof check, and the log
record schema. State changes go through the HTTP API only.

Ashby is the strictest of the three ATSes, with one upside: its
client-side validators are accurate. If the form passes every client
check, it almost always submits. That makes the park-proof check
especially trustworthy here.

Ashby renders React controlled inputs. A plain DOM write to
`element.value` gets dropped on the next render. Fill with `form_input`
or real keystrokes so React receives input events. Ashby also validates
on blur, so expect inline error text after leaving a field.

Per-widget verify rule: after filling any widget, re-read its value and
confirm it took before moving to the next one. If it did not take,
retry once with keystrokes, then add the field to `fields_pending`.

### Rich-text long answers

Long-answer fields use a custom rich-text editor, not a textarea. It
rejects plain DOM paste. It needs `beforeinput` events with the
correct `inputType`, so real keystrokes via the computer tool are the
safe path if one ever has to be filled. In practice this rarely
matters: long-answer boxes are free text, and free text always stays
empty and gets listed in `fields_pending`.

### Dropdown timing

Multi-select dropdowns animate open and debounce option clicks. Wait
50 to 150 ms between opening the control and clicking an option, or
the click lands on stale DOM and nothing selects. Then verify.

### Combobox rule (applies to every dropdown here)

Ashby dropdowns are W3C combobox custom components, not native
selects. Options do not exist in the DOM until the control is opened.
Synthetic untrusted clicks are often ignored. Typing filters the
option list, and text that matches no option leaves the list empty
while the typed text strands in the field looking filled with nothing
selected. Rule: open the control, wait for options to render, pick by
meaning, then re-read the committed value to confirm the selection
registered.

## 1. URL patterns and job-id extraction

| Pattern | Example | Job id |
|---|---|---|
| `jobs.ashbyhq.com/<org>/<uuid>` | `jobs.ashbyhq.com/acme/1b2c3d4e-...` | UUID path segment |
| `jobs.ashbyhq.com/<org>/<uuid>/application` | same with `/application` | same |
| Embedded board on a company site | `acme.com/careers/...` with an Ashby iframe | UUID from the iframe src |

The Overview and Application views are tabs on the same page. Click the
`Application` tab or append `/application` to reach the form. Log key:
copy the `key` field serve.py stored on the queue item. Its format is
`ashby:<org>:<job-segment>`, where the job segment is the UUID or slug
from the URL path.

## 2. Field table

| profile.json key | ATS label text (variants) | Widget | Fill method |
|---|---|---|---|
| `name` | Name, Full name | text input | form_input |
| `email` | Email | text input | form_input |
| `phone` | Phone, Phone number | text input | form_input |
| `location` | Location, Current location | typeahead listbox | keystroke, then click the matching option |
| `address.structured` | Street address, City, State, Zip / Postal code | separate text inputs | form_input per part |
| `school` | School, University | searchable listbox | keystroke, then click the option |
| `degree` | Degree | listbox | click-dropdown |
| `major` | Major, Field of study | listbox or text input | click-dropdown, form_input if text |
| `grad_date` | Expected graduation date, End date | month and year pickers or text input | click-dropdown per part, form_input if text |
| `linkedin` | LinkedIn Profile, LinkedIn URL | text input | form_input |
| `github` | GitHub, GitHub URL | text input | form_input |
| `portfolio` | Website, Portfolio | text input | form_input |
| `work_authorization` | Are you authorized to work in the United States? | Yes/No button pair or radio | click-dropdown |
| `requires_sponsorship_future` | Will you now or in the future require sponsorship? | Yes/No button pair or radio | click-dropdown |
| `requires_sponsorship_now` | Do you require sponsorship for this role? Do you currently require sponsorship? | Yes/No button pair or radio | click-dropdown |
| `gender` | Gender | listbox in the EEO section | click-dropdown |
| `race_ethnicity` | Race, Ethnicity | listbox in the EEO section | click-dropdown |
| `veteran_status` | Veteran status | listbox in the EEO section | click-dropdown |
| `disability_status` | Disability status | listbox or radio in the EEO section | click-dropdown |

Address: Ashby often wants structured street, city, state, and zip.
Fill those parts from `address.structured`. A single location field
takes `location` or `address.single_line`.

Sponsorship is two questions, not one. "Now or in the future" wording
maps to `requires_sponsorship_future`. Current-role wording maps to
`requires_sponsorship_now`. Read the question scope before picking the
key. If only the legacy `requires_sponsorship` is set, use it for
either phrasing.

Yes/No screeners often render as a pair of toggle buttons, not a
select. Click the button and verify it shows the selected state.

EEO handling: the section is voluntary self-identification and every
question has a decline option. Store the canonical value `decline` in
the profile and translate it here:

| Canonical profile value | Ashby option text |
|---|---|
| `decline` | Prefer not to say |

Some orgs word it "Decline to self identify". Pick the option whose
meaning is declining. If the profile value is empty, leave the
question untouched and list it in `fields_pending`.

### Multi-step navigation

Some Ashby applications split the form into steps with a `Next` button
per step. Rules:

- Finish and verify every widget on the current step before clicking
  `Next`. Unfilled required fields block the step change and show
  inline errors.
- Click `Next` only when its text is exactly `Next` or `Continue`.
  Never click any button whose text contains `Submit`.
- Later steps can hold required fields that were invisible earlier.
  The field table applies per step as fields appear.
- Track filled fields across steps. The park-proof check covers the
  whole form, and earlier steps may be collapsed at the end. Reopen or
  scroll to them if the final view allows review.

## 3. Resume upload

The Resume field shows an `Upload File` button feeding an
`input[type=file]`. Upload the PDF at `apply/user/files/<file>` from
the matched library entry. The widget shows a visible progress bar.
The completed progress bar is the done signal, not the network. Do not
proceed on a finished request while the bar is still moving.

Many orgs enable Autofill from resume, which parses the upload and
fills name, email, links, and education. Upload first, wait for the
progress bar to complete and the autofill pass to settle, then fill
and verify every field in the table, correcting whatever the parser
guessed wrong.

## 4. Screener handling

Answer a screener only when the answer exists in the profile. Work
authorization and sponsorship come from their profile keys. These
high-frequency screeners map to dedicated profile keys:

| profile.json key | Common phrasings |
|---|---|
| `willing_to_relocate` | Are you willing to relocate? |
| `willing_onsite` | Are you able to work onsite? Can you commit to X days in office? |
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

Stop at the button with the exact text `Submit Application`. Never
click it. On multi-step forms it appears only on the final step. When
the button is in view and every widget above it is filled or recorded
as pending, run the park-proof check from `apply/README.md`, then PUT
the park notes and write the log line. Because Ashby client validation
is accurate, a form with no inline errors at park time is very likely
to submit cleanly for the human.

## 6. Known failure modes

- Controlled-input drops. React discards plain DOM writes. Symptom:
  the field looks filled, then blanks on the next interaction. The
  verify rule catches this. Refill with keystrokes.
- Stale-DOM dropdown clicks. Clicking an option while the open
  animation or debounce is still running selects nothing. Wait 50 to
  150 ms after opening, click, then verify.
- Stranded combobox text. Typed text matched no option, the list went
  empty, and the field looks filled with nothing selected. The combobox
  rule catches this. Re-read the committed value.
- Rich-text paste rejected. Long-answer editors ignore plain paste and
  need `beforeinput` events with the correct `inputType`. Use real
  keystrokes if a long answer must ever be touched. Normally it never
  is, free text stays empty.
- Blur validation noise. Error text appears while you are still
  working. Only treat errors as real after the field is verified.
- Toggle buttons misread. A Yes/No button pair can look unselected in
  a text dump. Verify by re-reading the pressed state, not the label.
- Upload trusted too early. The XHR finishing does not mean the widget
  is done. Wait for the progress bar to complete.
- Autofill overwrite. The resume parser can overwrite fields filled
  before upload. Upload first, then fill.
- Hidden required fields on later steps. Do not assume the field set
  from step one is complete.
- CAPTCHA. Uncommon on Ashby, but if one appears, mark the item
  `blocked` with a note and stop. Never attempt to solve it.
- Login wall. Some orgs require an Ashby account for internal
  postings. Mark `blocked` and stop.

## Sources

- openapplier.com, "Greenhouse, Lever, Ashby: a form-filler's view"
  (blog/greenhouse-lever-ashby-fillers-view)
- veloapply.com autofill-failure analysis
- github.com/AkbarDevop/ai-job-agent answer bank, built over 228
  submitted applications
