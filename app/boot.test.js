import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

// boot.js is the file that wires the whole triage flow together, and on the
// real page it happens to work even when its own load()-before-isDegraded()
// ordering is broken: browse.js touches Store.load() first, through
// Status.badgeFor, which primes isDegraded() before boot.js ever checks it.
// Loading the real page (the way page.test.js does) would hide that. So this
// suite deliberately loads boot.js and its dependencies WITHOUT browse.js,
// which is the only way a regression in boot.js's own ordering can be seen
// failing here rather than being masked by another script's side effect.
const BOOT_FILES = ['store.js', 'rowindex.js', 'match.js', 'status.js', 'onboard.js', 'today.js', 'boot.js']

// Two disjoint sets of rows. The first three match a software, Summer 2027,
// internship profile and nothing else. The last three match a civil, Fall
// 2026, new grad profile and nothing else. A profile edit that moves from one
// to the other must move the rendered list with it.
const PAGE = [
  '<p class="sub">sub</p>',
  '<div id="triage"></div>',
  '<h2>Open roles</h2>',
  '<div class="wrap"><table>',
  '<tr><td class="co">Acme</td><td>Software Engineer Intern</td><td class="loc">Remote</td>',
  '<td><a href="https://acme.example/1">Apply</a></td></tr>',
  '<tr><td class="co">Borealis</td><td>Software Engineer Intern, Summer 2027</td><td class="loc">Remote</td>',
  '<td><a href="https://borealis.example/1">Apply</a></td></tr>',
  '<tr><td class="co">Cedar</td><td>Backend Engineer Intern, Summer 2027</td><td class="loc">Remote</td>',
  '<td><a href="https://cedar.example/1">Apply</a></td></tr>',
  '<tr><td class="co">Delta</td><td>Structural Engineer, New Grad, Fall 2026</td><td class="loc">Austin, TX</td>',
  '<td><a href="https://delta.example/1">Apply</a></td></tr>',
  '<tr><td class="co">Everest</td><td>Structural Analysis Engineer, New Grad, Fall 2026</td><td class="loc">Austin, TX</td>',
  '<td><a href="https://everest.example/1">Apply</a></td></tr>',
  '<tr><td class="co">Foxglove</td><td>Geotechnical Engineer, New Grad, Fall 2026</td><td class="loc">Austin, TX</td>',
  '<td><a href="https://foxglove.example/1">Apply</a></td></tr>',
  '</table></div>',
].join('\n')

const SOFTWARE = { fields: ['swe'], term: 'sum27', types: ['intern'] }
const CIVIL = { fields: ['civil'], term: 'fall26', types: ['newgrad'] }

// Drives the profile strip to an exact target rather than to a delta, so the
// test reads as the profile the reader ends up with.
function setStripTo(S27, profile) {
  const strip = document.querySelector('#triage .onboard')
  const press = (group, val, want) => {
    const b = strip.querySelector(`.ob-group[data-group="${group}"] button[data-val="${val}"]`)
    if (!b) return
    if ((b.getAttribute('aria-pressed') === 'true') !== want) b.click()
  }
  S27.RowIndex.FIELDS.forEach((f) => press('fields', f[0], profile.fields.includes(f[0])))
  S27.RowIndex.TERMS.forEach((t) => press('term', t[0], profile.term === t[0]))
  S27.RowIndex.TYPES.forEach((t) => press('types', t[0], profile.types.includes(t[0])))
  strip.querySelector('.ob-save').click()
}

function shownCards() {
  return Array.from(document.querySelectorAll('#triage .tcard')).map((el) => ({
    co: el.querySelector('.tcard-co').textContent,
    meta: el.querySelector('.tcard-meta').textContent,
  }))
}

function boot() {
  return loadApp(...BOOT_FILES)
}

beforeEach(() => {
  clearStorage()
  vi.restoreAllMocks()
  document.body.innerHTML = PAGE
})

describe('storage blocked', () => {
  it('shows the degraded banner when storage throws on both read and write', () => {
    vi.spyOn(globalThis.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    boot()
    const banner = document.querySelector('.degraded')
    expect(banner).not.toBeNull()
    expect(banner.textContent).toContain('blocking local storage')
  })
})

describe('stored data that will not parse', () => {
  it('says the page started fresh rather than blaming the browser', () => {
    // The spec lists these as two conditions. A reader whose saved state
    // failed to parse was told their browser was broken.
    globalThis.localStorage.setItem('s27.v1', '{not json')
    boot()
    const banner = document.querySelector('.degraded')
    expect(banner).not.toBeNull()
    expect(banner.textContent).not.toContain('blocking local storage')
    expect(banner.textContent).toContain('started fresh')
    expect(banner.textContent).toContain('s27.v1.bak')
  })
})

describe('no stored profile', () => {
  it('renders the onboarding strip into #triage', () => {
    boot()
    expect(document.querySelector('#triage .onboard')).not.toBeNull()
    expect(document.querySelector('#triage .today')).toBeNull()
  })

  it('records the visit on the first load, before any profile exists', () => {
    // start() used to return before setLastVisit whenever the strip rendered,
    // so the field was never written on visit one.
    const S27 = boot()
    expect(document.querySelector('#triage .onboard')).not.toBeNull()
    expect(S27.Store.getLastVisit()).not.toBeNull()
  })
})

describe('complete stored profile', () => {
  it('renders a Today section instead of the onboarding strip', () => {
    loadApp('store.js').Store.setProfile({ fields: ['swe'], term: null, types: [] })
    boot()
    expect(document.querySelector('#triage .today')).not.toBeNull()
    expect(document.querySelector('#triage .onboard')).toBeNull()
  })

  it('records the visit with setLastVisit', () => {
    loadApp('store.js').Store.setProfile({ fields: ['swe'], term: null, types: [] })
    const S27 = boot()
    expect(S27.Store.getLastVisit()).not.toBeNull()
  })
})

describe('skipped profile', () => {
  it('renders no Today section and leaves the page browsable', () => {
    loadApp('store.js').Store.setProfile({ fields: [], term: null, types: [], skipped: true })
    boot()
    expect(document.querySelector('#triage .today')).toBeNull()
    expect(document.querySelector('#triage .onboard')).toBeNull()
    // The rest of the page, outside the mount, is untouched and still
    // browsable: the row committed above is still there to be seen.
    expect(document.querySelectorAll('td.co').length).toBeGreaterThan(0)
  })
})

describe('editing the profile later', () => {
  it('offers an edit control once a profile exists and reopens the strip prefilled', () => {
    // The spec calls the strip editable later. boot rendered it only when no
    // profile existed, so a reader who picked the wrong field was stuck.
    loadApp('store.js').Store.setProfile({ fields: ['data'], term: null, types: [] })
    boot()
    expect(document.querySelector('#triage .onboard')).toBeNull()

    const edit = document.querySelector('#triage .ob-edit')
    expect(edit, 'no control reopens the profile strip').not.toBeNull()
    edit.click()

    const strip = document.querySelector('#triage .onboard')
    expect(strip).not.toBeNull()
    const pressed = Array.from(strip.querySelectorAll('.ob-group[data-group="fields"] button'))
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.dataset.val)
    expect(pressed).toEqual(['data'])
  })

  it('picks a new list for the edited profile instead of replaying the old one', () => {
    // The day's picks are stored so a same-day reload is stable. That store
    // used to be replayed for any profile, so a reader who edited theirs got
    // the same cards back, every one of them now hard excluded and scoring
    // zero, with the match reasons stripped out of the meta line. The reader
    // edits precisely because they chose wrong, so an unchanged list is the
    // one answer that cannot be right.
    loadApp('store.js').Store.setProfile(SOFTWARE)
    const app = boot()

    const before = shownCards()
    expect(before.map((c) => c.co).sort()).toEqual(['Acme', 'Borealis', 'Cedar'])

    document.querySelector('#triage .ob-edit').click()
    setStripTo(app, CIVIL)

    expect(app.Store.getProfile()).toMatchObject(CIVIL)
    expect(document.querySelector('#triage .today')).not.toBeNull()
    expect(document.querySelector('#triage .onboard')).toBeNull()
    expect(document.querySelector('#triage .ob-edit')).not.toBeNull()

    const after = shownCards()
    expect(after.map((c) => c.co).sort()).toEqual(['Delta', 'Everest', 'Foxglove'])
    // Nothing from the old profile survives, and every card explains itself.
    expect(after.filter((c) => before.some((b) => b.co === c.co))).toEqual([])
    after.forEach((c) => expect(c.meta).toContain('Civil / Struct'))
  })

  it('offers the edit control to a reader who skipped, so skipping is not permanent', () => {
    loadApp('store.js').Store.setProfile({ fields: [], term: null, types: [], skipped: true })
    boot()
    expect(document.querySelector('#triage .ob-edit')).not.toBeNull()
  })
})
