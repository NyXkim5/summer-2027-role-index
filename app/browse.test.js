import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { clearStorage } from './test-helpers.js'

// This is a behavioral test, not a unit test. It loads the real index.html
// the same way app/page.test.js does, and then drives the rendered page:
// clicking chips, typing into search, and setting a URL hash before load.
// Until Task 5, browse.js's correctness rested on it being byte-identical
// to code that already worked. This task edits that file, so that
// protection is gone. These tests replace it with real assertions on the
// rendered DOM.

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const INDEX_PATH = resolve(ROOT, 'index.html')

let bodyHTML
let scriptPaths

beforeAll(() => {
  const html = readFileSync(INDEX_PATH, 'utf8')
  const parsed = new JSDOM(html)
  const parsedDoc = parsed.window.document
  bodyHTML = parsedDoc.body.innerHTML

  const scriptSrcs = Array.from(parsedDoc.querySelectorAll('script[src]')).map((el) =>
    el.getAttribute('src')
  )
  scriptPaths = scriptSrcs.map((src) => resolve(ROOT, src))
  scriptPaths.forEach((p) => {
    expect(existsSync(p), `script src does not resolve: ${p}`).toBe(true)
  })
})

afterEach(() => {
  // browse.js's apply() calls history.replaceState on every render, which
  // would otherwise leak a stale hash into the next test's fresh load.
  history.replaceState(null, '', location.pathname)
})

// Wipes the shared jsdom document back to the real page markup and runs the
// four app scripts against it, in the order index.html declares. Call this
// before the hash is meant to matter, since browse.js reads location.hash
// exactly once, synchronously, while it runs.
function renderPage(hash) {
  document.body.innerHTML = bodyHTML
  history.replaceState(null, '', hash ? '#' + hash : location.pathname)
  delete globalThis.S27
  scriptPaths.forEach((p) => {
    runInThisContext(readFileSync(p, 'utf8'), { filename: p })
  })
}

// Runs the page scripts the way a browser does over file://: browse.js
// executes during parse, boot.js defers to DOMContentLoaded. jsdom reports the
// document complete, so readyState is stubbed for the duration of the run and
// the caller dispatches the event itself.
function renderPageInLoadOrder() {
  document.body.innerHTML = bodyHTML
  history.replaceState(null, '', location.pathname)
  delete globalThis.S27
  Object.defineProperty(document, 'readyState', { get: () => 'loading', configurable: true })
  try {
    scriptPaths.forEach((p) => {
      runInThisContext(readFileSync(p, 'utf8'), { filename: p })
    })
  } finally {
    delete document.readyState
  }
}

function countText() {
  const text = document.querySelector('#fcount').textContent
  const m = /^(\d+) of (\d+)$/.exec(text)
  expect(m, `#fcount text "${text}" is not in "N of M" form`).not.toBeNull()
  return { shown: Number(m[1]), total: Number(m[2]) }
}

function chip(key, val) {
  return document.querySelector('.chip[data-key="' + key + '"][data-val="' + val + '"]')
}

describe('field chip toggling', () => {
  it('hides non-matching rows and lowers the N of M count on click', () => {
    renderPage(null)
    const before = countText()
    const btn = chip('field', 'swe')
    expect(btn, 'no Software field chip rendered').not.toBeNull()
    const chipCount = Number(btn.querySelector('.n').textContent)
    expect(chipCount).toBeGreaterThan(0)

    btn.click()

    const after = countText()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    // The chip's own printed count comes from the same countFor() the "N of
    // M" shown-count is built from, so clicking it must show exactly that
    // many rows: not fewer (over-filtering) and not the full total
    // (filter never applied).
    expect(after.shown).toBe(chipCount)
    expect(after.total).toBe(before.total)
    expect(after.shown).toBeLessThan(before.shown)
  })

  it('clicking the same chip again clears the filter and restores the original count', () => {
    renderPage(null)
    const before = countText()
    const btn = chip('field', 'swe')

    btn.click()
    expect(countText().shown).toBeLessThan(before.shown)

    btn.click()

    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(countText()).toEqual(before)
  })
})

describe('search', () => {
  it('filters rows after the debounce, and clears back after emptying the box', async () => {
    renderPage(null)
    const before = countText()
    const input = document.getElementById('q')

    input.value = 'zzz-nothing-should-ever-match-this-xyz'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // The debounce is 120ms. Read too early and the assertion would pass
    // for the wrong reason: the count has not moved yet, not because
    // filtering actually happened.
    await new Promise((r) => setTimeout(r, 50))
    expect(countText()).toEqual(before)
    await new Promise((r) => setTimeout(r, 150))

    const noMatch = countText()
    expect(noMatch.shown).toBe(0)
    expect(noMatch.total).toBe(before.total)
    expect(document.querySelector('.noresult').classList.contains('hidden')).toBe(false)

    input.value = 'anduril'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))

    const filtered = countText()
    expect(filtered.shown).toBeGreaterThan(0)
    expect(filtered.shown).toBeLessThan(before.shown)
    // Every row left visible must actually carry the search term. This is
    // the assertion that would fail if search stopped filtering and just
    // showed everything.
    document.querySelectorAll('tr').forEach((tr) => {
      if (!tr.querySelector('td') || tr.classList.contains('hidden')) return
      expect(tr.textContent.toLowerCase()).toContain('anduril')
    })
  })
})

describe('hide closed', () => {
  it('removes rows carrying a closed tag', () => {
    renderPage(null)
    const closedRows = Array.from(document.querySelectorAll('.cl')).map((el) =>
      el.closest('tr')
    )
    expect(closedRows.length, 'fixture page has no closed rows to test against').toBeGreaterThan(0)
    closedRows.forEach((tr) => expect(tr.classList.contains('hidden')).toBe(false))

    const before = countText()
    const btn = Array.from(document.querySelectorAll('.chip')).find(
      (c) => c.textContent === 'Hide closed'
    )
    expect(btn, 'no Hide closed chip rendered').not.toBeNull()

    btn.click()

    expect(btn.getAttribute('aria-pressed')).toBe('true')
    closedRows.forEach((tr) => expect(tr.classList.contains('hidden')).toBe(true))
    expect(countText().shown).toBeLessThan(before.shown)
  })
})

describe('URL hash restore', () => {
  it('restores a field filter from #field=swe on load, with the chip shown pressed', () => {
    renderPage('field=swe')

    const btn = chip('field', 'swe')
    expect(btn.getAttribute('aria-pressed')).toBe('true')

    const chipCount = Number(btn.querySelector('.n').textContent)
    const after = countText()
    expect(after.shown).toBe(chipCount)

    // A chip for a filter that was never requested must not also render as
    // pressed just because something else did.
    const other = chip('field', 'data')
    if (other) expect(other.getAttribute('aria-pressed')).toBe('false')
  })
})

// Browse paints a status badge once, from S27.Store, when its script runs.
// There is no live re-render on click here, so "marking a row" is done
// through S27.Status directly (the same call a Task 7/8 control makes) and
// then observed on the next renderPage(), which is exactly what a reload is:
// a fresh document plus a fresh script run against the same localStorage.
function firstRealRow(doc) {
  const today = new Date().toISOString().slice(0, 10)
  const idx = globalThis.S27.RowIndex.build(doc, today)
  return idx.rows.find((r) => !r.info && !r.deep)
}

describe('row status', () => {
  afterEach(() => {
    clearStorage()
  })

  it('shows an applied badge for a row marked applied, and the badge survives a reload', () => {
    clearStorage()
    renderPage(null)
    const before = firstRealRow(document)
    expect(before.tr.querySelector('.tag.st')).toBeNull()

    globalThis.S27.Status.set(before, 'applied')

    renderPage(null)
    const afterFirstReload = firstRealRow(document)
    const badge = afterFirstReload.tr.querySelector('.tag.st')
    expect(badge, 'no status badge rendered after marking the row applied').not.toBeNull()
    expect(badge.textContent).toBe('applied')

    // A second reload proves persistence, not a one-shot fluke of the first
    // render right after the write.
    renderPage(null)
    const afterSecondReload = firstRealRow(document)
    expect(afterSecondReload.tr.querySelector('.tag.st')?.textContent).toBe('applied')
  })

  it('hides a dismissed row while Hide dismissed is pressed, shows it again once released, and keeps the count right', () => {
    clearStorage()
    renderPage(null)
    const target = firstRealRow(document)
    globalThis.S27.Status.set(target, 'dismissed')

    renderPage(null)
    const dismissBtn = Array.from(document.querySelectorAll('.chip')).find(
      (c) => c.textContent === 'Hide dismissed'
    )
    expect(dismissBtn, 'no Hide dismissed chip rendered').not.toBeNull()
    // Hide dismissed defaults on, so the row starts hidden with no click.
    expect(dismissBtn.getAttribute('aria-pressed')).toBe('true')

    const reloaded = firstRealRow(document)
    expect(reloaded.tr.classList.contains('hidden')).toBe(true)
    const hidden = countText()

    dismissBtn.click()

    expect(dismissBtn.getAttribute('aria-pressed')).toBe('false')
    expect(reloaded.tr.classList.contains('hidden')).toBe(false)
    const shown = countText()
    // The dismissed row was always part of the denominator. Only whether it
    // is counted as shown changes.
    expect(shown.total).toBe(hidden.total)
    expect(shown.shown).toBe(hidden.shown + 1)
  })

  it('keeps Hide dismissed pressed and the dismissed row hidden after Reset', () => {
    clearStorage()
    renderPage(null)
    const target = firstRealRow(document)
    globalThis.S27.Status.set(target, 'dismissed')

    renderPage(null)
    const dismissBtn = Array.from(document.querySelectorAll('.chip')).find(
      (c) => c.textContent === 'Hide dismissed'
    )
    const reloaded = firstRealRow(document)
    expect(reloaded.tr.classList.contains('hidden')).toBe(true)

    document.getElementById('fclear').click()

    expect(dismissBtn.getAttribute('aria-pressed')).toBe('true')
    expect(reloaded.tr.classList.contains('hidden')).toBe(true)
  })
})

// Task 10 built two indexes: browse.js made one at parse time and boot.js made
// another on DOMContentLoaded. The two held disjoint record objects for the
// same rows, so a dismiss in Today left the table row unbadged and the count
// unmoved. These drive the real page end to end, which is the only place the
// split was visible.
describe('Today and Browse over one index', () => {
  afterEach(() => {
    clearStorage()
  })

  it('badges and hides the table row when a Today card is dismissed', () => {
    clearStorage()
    renderPage(null)
    globalThis.S27.Store.setProfile({ fields: ['swe'], term: null, types: [] })

    renderPage(null)
    const card = document.querySelector('#triage .tcard')
    expect(card, 'no Today card rendered, so the profile did not take').not.toBeNull()
    expect(document.querySelectorAll('table .tag.st').length).toBe(0)
    const before = countText()

    const dismiss = Array.from(card.querySelectorAll('.sbtn')).find((b) => b.dataset.val === 'dismissed')
    expect(dismiss, 'no Not for me control on the card').not.toBeNull()
    dismiss.click()

    const badges = Array.from(document.querySelectorAll('table .tag.st'))
    expect(badges.length, 'the table row carries no badge after the dismiss').toBe(1)
    expect(badges[0].textContent).toBe('dismissed')
    expect(badges[0].closest('tr').classList.contains('hidden')).toBe(true)
    expect(countText().shown).toBe(before.shown - 1)
  })

  it('does not let boot.js build a second index of its own', () => {
    // Reproduces the real browser order, which this harness otherwise cannot:
    // browse.js runs at parse time, boot.js waits for DOMContentLoaded. Under
    // that order the two used to hold disjoint record objects for the same
    // rows.
    clearStorage()
    renderPageInLoadOrder()
    const RI = globalThis.S27.RowIndex
    const real = RI.build
    let builds = 0
    RI.build = function () { builds++; return real.apply(null, arguments) }

    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(document.querySelector('#triage')).not.toBeNull()
    expect(builds, 'boot.js built its own index instead of using the shared one').toBe(0)
    expect(globalThis.S27.Browse.index).toBe(RI.shared(document, new Date().toISOString().slice(0, 10)))
  })

  it('builds the shared index before any badge is written into a title cell', () => {
    // Badges are appended to the title cell, so an index built afterwards
    // reads titles like "...Internshipsdismissed". That changes the fallback
    // key and orphans the reader's status. This asserts the hazard is real
    // and that the index both views use is on the clean side of it.
    clearStorage()
    renderPage(null)
    globalThis.S27.Status.set(firstRealRow(document), 'dismissed')

    renderPageInLoadOrder()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(document.querySelectorAll('table .tag.st').length).toBe(1)

    const badgeText = /(applied|saved|dismissed)$/
    const today = new Date().toISOString().slice(0, 10)

    // An index built now, after the badge landed, does read the badge text.
    // That is what boot.js's own second index used to be.
    const late = globalThis.S27.RowIndex.build(document, today)
    expect(late.rows.some((r) => badgeText.test(r.title))).toBe(true)

    const polluted = globalThis.S27.Browse.index.rows
      .map((r) => r.title)
      .filter((t) => badgeText.test(t))
    expect(polluted, `titles carrying badge text: ${polluted.join(', ')}`).toEqual([])
  })
})

describe('a row with no second cell', () => {
  it('renders the filter bar instead of throwing at top level', () => {
    // Eight rows on the page today have exactly two cells. One with a single
    // cell would have thrown on td[1].appendChild and taken the whole filter
    // bar down for the sake of one badge.
    clearStorage()
    document.body.innerHTML = [
      '<p class="sub">sub</p>',
      '<div id="triage"></div>',
      '<h2>Software roles</h2>',
      '<div class="wrap"><table>',
      '<tr><td class="co">Acme</td></tr>',
      '<tr><td class="co">Beta</td><td>Software Engineer Intern</td><td class="loc">CA</td>',
      '<td><a href="https://beta.example/1">Apply</a></td></tr>',
      '</table></div>',
    ].join('\n')
    delete globalThis.S27
    scriptPaths.forEach((p) => {
      runInThisContext(readFileSync(p, 'utf8'), { filename: p })
    })

    globalThis.S27.Status.set(globalThis.S27.Browse.index.rows[0], 'saved')
    globalThis.S27.Browse.refresh()

    expect(document.querySelector('.filters')).not.toBeNull()
    expect(document.querySelector('#fcount').textContent).toMatch(/^\d+ of \d+$/)
  })
})
