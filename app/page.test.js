import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

// This is an integration smoke test, not a unit test. It loads the actual
// index.html from the repo root and proves the page it declares still comes
// alive. A byte-diff of the extraction cannot catch a wrong src or href: that
// produces a page that looks perfect in a diff and is silently dead in a
// browser. So this test discovers what the page points at by parsing it,
// the same way a browser would, instead of hardcoding the paths we expect.

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const INDEX_PATH = resolve(ROOT, 'index.html')

describe('index.html', () => {
  let scriptSrcs

  beforeAll(() => {
    const html = readFileSync(INDEX_PATH, 'utf8')

    // Parse without executing anything. This step only reads what the page
    // declares: which scripts, in which order, and which stylesheet.
    const parsed = new JSDOM(html)
    const parsedDoc = parsed.window.document

    const scriptEls = Array.from(parsedDoc.querySelectorAll('script[src]'))
    scriptSrcs = scriptEls.map((el) => el.getAttribute('src'))
    const styleHref = parsedDoc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')

    expect(scriptSrcs.length, 'index.html declares no script[src] tags').toBeGreaterThan(0)
    expect(styleHref, 'index.html declares no stylesheet link').toBeTruthy()

    // Every script src must resolve to a real file relative to the repo
    // root, the same place a file:// browser would resolve it from.
    const scriptPaths = scriptSrcs.map((src) => resolve(ROOT, src))
    scriptPaths.forEach((p, i) => {
      expect(existsSync(p), `script src "${scriptSrcs[i]}" does not resolve to a real file`).toBe(true)
    })

    const stylePath = resolve(ROOT, styleHref)
    expect(existsSync(stylePath), `stylesheet href "${styleHref}" does not resolve to a real file`).toBe(true)

    // Bring the real page markup into this test's live document, then run
    // the scripts the page declares, in the order it declares them. This
    // mirrors what a browser does over file://.
    document.body.innerHTML = parsedDoc.body.innerHTML

    scriptPaths.forEach((p) => {
      runInThisContext(readFileSync(p, 'utf8'), { filename: p })
    })
  })

  it('loads its scripts in dependency order, with browse last', () => {
    // Discovered from the HTML above, not hardcoded there. Hardcoded only
    // here, as the expected value, because load order is exactly what this
    // task's contract requires and a passing count/chip check cannot prove
    // it: browse.js is still self-contained today, so it renders fine even
    // loaded first. Task 5 wires it onto RowIndex, making order load-bearing.
    expect(scriptSrcs).toEqual([
      'app/store.js',
      'app/rowindex.js',
      'app/match.js',
      'app/status.js',
      'app/onboard.js',
      'app/today.js',
      'app/boot.js',
      'app/browse.js',
    ])
  })

  it('renders the filter bar with Field, Term, Type, and Status groups', () => {
    const labels = Array.from(document.querySelectorAll('.flabel')).map((el) => el.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Field', 'Term', 'Type', 'Status']))
  })

  it('renders the search input', () => {
    expect(document.querySelector('#q')).not.toBeNull()
  })

  it('renders an N of M count with a plausible M', () => {
    const text = document.querySelector('#fcount').textContent
    const m = text.match(/^(\d+) of (\d+)$/)
    expect(m, `#fcount text "${text}" is not in "N of M" form`).not.toBeNull()
    const total = Number(m[2])
    // The real page carries several hundred hand-checked rows. Zero, or a
    // handful, means the scripts did not actually run against the page.
    expect(total).toBeGreaterThan(300)
  })

  it('renders at least one Field chip', () => {
    const fieldGroup = Array.from(document.querySelectorAll('.fgroup')).find(
      (g) => g.querySelector('.flabel')?.textContent === 'Field'
    )
    expect(fieldGroup).toBeTruthy()
    expect(fieldGroup.querySelectorAll('.chip').length).toBeGreaterThan(0)
  })

  it('never has a row that carries a td but no td.co', () => {
    // RowIndex.build() selects a row by the presence of td.co, not by the
    // presence of any td. Today every row that has a td also has a td.co,
    // so the two selectors agree. A hand edit could break that agreement:
    // a row with a td and no td.co would then silently vanish from every
    // filter, count, and badge, instead of failing loudly. This scans a
    // fresh parse of the real file, not the live executed document, so it
    // checks the markup as committed.
    const raw = readFileSync(INDEX_PATH, 'utf8')
    const fresh = new JSDOM(raw).window.document
    const bad = Array.from(fresh.querySelectorAll('tr')).filter(
      (tr) => tr.querySelector('td') && !tr.querySelector('td.co')
    )
    expect(
      bad.length,
      `row(s) with a td but no td.co: ${bad.map((tr) => tr.outerHTML.slice(0, 100)).join(' | ')}`
    ).toBe(0)
  })
})
