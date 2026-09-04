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

const PAGE = [
  '<p class="sub">sub</p>',
  '<div id="triage"></div>',
  '<h2>Software roles</h2>',
  '<div class="wrap"><table>',
  '<tr><td class="co">Acme</td><td>Software Engineer Intern</td><td class="loc">Remote</td>',
  '<td><a href="https://acme.example/1">Apply</a></td></tr>',
  '</table></div>',
].join('\n')

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

  it('saves the edited profile and re-renders Today', () => {
    const S27 = loadApp('store.js')
    S27.Store.setProfile({ fields: ['data'], term: null, types: [] })
    const app = boot()
    document.querySelector('#triage .ob-edit').click()

    const strip = document.querySelector('#triage .onboard')
    strip.querySelector('.ob-group[data-group="fields"] button[data-val="swe"]').click()
    strip.querySelector('.ob-save').click()

    expect(app.Store.getProfile().fields).toContain('swe')
    expect(document.querySelector('#triage .today')).not.toBeNull()
    expect(document.querySelector('#triage .onboard')).toBeNull()
    expect(document.querySelector('#triage .ob-edit')).not.toBeNull()
  })

  it('offers the edit control to a reader who skipped, so skipping is not permanent', () => {
    loadApp('store.js').Store.setProfile({ fields: [], term: null, types: [], skipped: true })
    boot()
    expect(document.querySelector('#triage .ob-edit')).not.toBeNull()
  })
})
