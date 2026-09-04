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
