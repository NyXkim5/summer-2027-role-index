# Lever fieldmap

Playbook for the applying agent driving Chrome on a Lever job form.
Current as of late 2026. Follow the shared rules in `apply/README.md`:
the ghost-listing check, resume matching and pinning, re-run safety,
single writer, the parking procedure, the park-proof check, and the log
record schema. State changes go through the HTTP API only.

Lever is a single-page React app over a private API. Two rules follow
from that:

- **Wait for hydration.** The form does not exist until the app
  hydrates. Do not probe or fill until the form inputs are present in
  the DOM. A blank or skeleton page means wait, not fail.
- **Never write `input.value` directly.** Form state lives in a Redux
  store that ignores direct value writes. A direct write leaves React
  state untouched and the form submits with empty fields, silently,
  with no error. Every text fill must go through `form_input` or real
  keystrokes so React-style input and change events fire.

Per-widget verify rule: after filling any widget, re-read its value and
confirm it took before moving to the next one. If it did not take,
retry once with keystrokes, then add the field to `fields_pending`.

### Combobox rule (applies to every dropdown here)

Lever dropdowns are W3C combobox custom components, not native
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
| `address.structured` | Street address, City, State, Zip / Postal code | separate text inputs | form_input per part |
| `custom` (only if a matching key exists) | Current company | text input | form_input |
| `linkedin` | LinkedIn URL (under Links) | text input | form_input |
| `github` | GitHub URL (under Links) | text input | form_input |
| `portfolio` | Portfolio URL, Other website (under Links) | text input | form_input |
| `work_authorization` | Are you legally authorized to work in the United States? | posting-specific card, radio or select | click-dropdown |
| `requires_sponsorship_future` | Will you now or in the future require sponsorship? | posting-specific card, radio or select | click-dropdown |
| `requires_sponsorship_now` | Do you require sponsorship for this role? Do you currently require sponsorship? | posting-specific card, radio or select | click-dropdown |
| `gender` | Gender | select in the EEO block | click-dropdown |
| `race_ethnicity` | Race, Ethnicity | select in the EEO block | click-dropdown |
| `veteran_status` | Veteran status | select in the EEO block | click-dropdown |
| `disability_status` | Disability status | select in the EEO block | click-dropdown |

Address: Lever often wants structured street, city, state, and zip.
Fill those parts from `address.structured`. A single location
typeahead takes `location` or `address.single_line`.

Sponsorship is two questions, not one. "Now or in the future" wording
maps to `requires_sponsorship_future`. Current-role wording maps to
`requires_sponsorship_now`. Read the question scope before picking the
key. If only the legacy `requires_sponsorship` is set, use it for
either phrasing.

Lever has no standard education section. School, degree, major, and
graduation date only appear as posting-specific cards. When they do,
fill them from the profile keys and verify like any other widget.

EEO handling: the block is titled U.S. Equal Employment Opportunity
information. Store the canonical value `decline` in the profile and
translate it here:

| Canonical profile value | Lever option text |
|---|---|
| `decline` | I do not wish to answer |

Some postings word it "Decline to self-identify". Pick the option
whose meaning is declining. If the profile value is empty, leave the
question untouched and list it in `fields_pending`.

### The "Additional information" box

The free-text box at the bottom varies per company. Sometimes it is an
optional catch-all. Sometimes it is a required why-are-you-applying
gate. Probe the placeholder text and any required marker to decide
which. Optional: leave it empty. Required: still leave it empty, we
never write essays, and list it in `fields_pending` so the human
writes it before submitting.

## 3. Resume upload

Upload the resume FIRST on Lever. The `ATTACH RESUME/CV` control feeds
a parser that autofills name, email, phone, and links, overwriting
anything already typed. The upload itself is an XHR with custom
multipart, so the file dialog closing proves nothing. Order of
operations:

1. Click `ATTACH RESUME/CV`, upload `apply/user/files/<file>` from the
   matched library entry.
2. Wait for the filename to render as `Success` next to the control.
   That rendered state is the done signal, not the dialog or the
   network.
3. Then fill and verify every field in the table, correcting whatever
   the parser guessed wrong.

## 4. Screener handling

Lever screeners are per-posting cards between the profile section and
the EEO block. Answer a card only when the answer exists in the
profile. Work authorization and sponsorship come from their profile
keys. These high-frequency screeners map to dedicated profile keys:

| profile.json key | Common phrasings |
|---|---|
| `willing_to_relocate` | Are you willing to relocate? |
| `willing_onsite` | Are you able to work onsite? Can you commit to X days in office? |
| `willing_travel_pct` | Are you willing to travel N% of the time? |
| `start_availability` | When can you start? What is your earliest start date? |
| `desired_compensation` | What are your salary expectations? Desired compensation? |
| `drivers_license` | Do you have a valid driver's license? |

Other factual cards may match a key in `profile.custom` by label.
Anything else stays empty and goes into `screeners_unanswered`.
Free-text boxes and essays always stay empty, no exceptions. A required
unanswered card does not stop the run. Fill everything else, then park
with it listed.

## 5. Park signal

Stop at the button with the exact text `Submit application`. Never
click it. When the button is in view and every widget above it is
filled or recorded as pending, run the park-proof check from
`apply/README.md`, then PUT the park notes and write the log line.

Lever runs surprise server-side validation on submit. A form that
passes every visible check can still bounce when the human submits.
Note in the park notes anything you could not verify, so the human
knows where to look if the submit rejects.

## 6. Known failure modes

- Silent empty-field submit. The worst Lever failure. Direct
  `input.value` writes bypass the Redux store, the form looks filled,
  and it submits with empty fields with no error shown. The verify
  rule plus event-dispatching fills prevent this. Never trust a field
  you did not re-read.
- Hydration race. Filling before the SPA hydrates hits detached or
  placeholder nodes. Wait until the form inputs exist, then start.
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
- Stranded combobox text. Typed text matched no option, the list went
  empty, and the field looks filled with nothing selected. The combobox
  rule catches this. Re-read the committed value.
- Posting page vs form. `/apply` missing from the URL means you are on
  the description page. The apply button there scrolls or navigates to
  the form.
- EU tenant. `jobs.eu.lever.co` behaves identically. Keep the log key
  as `lever:<uuid>`.
- Login wall. Rare, but internal or referral postings can require
  login. Mark `blocked` and stop.

## Sources

- openapplier.com, "Greenhouse, Lever, Ashby: a form-filler's view"
  (blog/greenhouse-lever-ashby-fillers-view)
- veloapply.com autofill-failure analysis
- github.com/AkbarDevop/ai-job-agent answer bank, built over 228
  submitted applications
