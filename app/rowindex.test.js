import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadApp } from './test-helpers.js'

let RowIndex
let doc
const TODAY = '2026-09-03'

beforeEach(() => {
  RowIndex = loadApp('rowindex.js').RowIndex
  document.body.innerHTML = readFileSync(resolve('app/fixtures/page.html'), 'utf8')
  doc = document
})

describe('normalizeUrl', () => {
  it('drops tracking parameters so a key survives a rewritten link', () => {
    expect(RowIndex.normalizeUrl('https://x.example/jobs/1?utm_source=a&gh_src=b'))
      .toBe('x.example/jobs/1')
  })

  it('drops a trailing slash and the www prefix and lowercases the host', () => {
    expect(RowIndex.normalizeUrl('https://WWW.Citi.example/Job/77/')).toBe('citi.example/Job/77')
  })

  it('keeps path case, because some boards route case sensitively', () => {
    expect(RowIndex.normalizeUrl('https://x.example/Job/AbC')).toBe('x.example/Job/AbC')
  })

  it('refuses a non http protocol so two mailto rows cannot share one key', () => {
    expect(RowIndex.normalizeUrl('mailto:jobs@co.com?subject=RoleA')).toBe(null)
    const a = RowIndex.keyFor('mailto:jobs@co.com?subject=RoleA', 'Co', 'Role A')
    const b = RowIndex.keyFor('mailto:jobs@co.com?subject=RoleB', 'Co', 'Role B')
    expect(a).not.toBe(b)
  })
})

describe('keyFor', () => {
  it('prefers the apply link', () => {
    expect(RowIndex.keyFor('https://x.example/1/', 'A', 'B')).toBe('u:x.example/1')
  })

  it('falls back to company and title when a row has no link', () => {
    expect(RowIndex.keyFor(null, 'Grant Thornton (US)', 'Tax Intern, Summer 2027'))
      .toBe('t:grant-thornton-us|tax-intern-summer-2027')
  })
})

describe('parseTagDate', () => {
  it('reads a month and day tag as this year', () => {
    expect(RowIndex.parseTagDate('Sep 1', TODAY)).toBe('2026-09-01')
  })

  it('rolls back a year when the tag would otherwise land in the future', () => {
    expect(RowIndex.parseTagDate('Dec 20', TODAY)).toBe('2025-12-20')
  })

  it('returns null for text that is not a date tag', () => {
    expect(RowIndex.parseTagDate('8 regional reqs', TODAY)).toBe(null)
  })

  it('returns null for a day that does not exist in that month', () => {
    expect(RowIndex.parseTagDate('Sep 31', TODAY)).toBe(null)
  })

  it('returns null for 29 February in a year that is not a leap year', () => {
    expect(RowIndex.parseTagDate('Feb 29', TODAY)).toBe(null)
  })

  it('returns null for three letters that are not a month', () => {
    expect(RowIndex.parseTagDate('Xyz 12', TODAY)).toBe(null)
  })
})

describe('build', () => {
  it('indexes every data row and skips header rows', () => {
    const { rows } = RowIndex.build(doc, TODAY)
    expect(rows.map((r) => r.co)).toEqual(['Anduril', 'Palantir', 'Citi', 'SimplifyJobs'])
  })

  it('reads company, title, location, and posting date off the row', () => {
    const r = RowIndex.build(doc, TODAY).rows[0]
    expect(r.co).toBe('Anduril')
    expect(r.title).toContain('Flight Software Engineer')
    expect(r.loc).toBe('Costa Mesa, CA')
    expect(r.date).toBe('2026-09-01')
  })

  it('flags a row carrying a closed tag', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[0].closed).toBe(false)
    expect(rows[1].closed).toBe(true)
  })

  it('flags wide-net rows so scoring can prefer the hand-checked sections', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[1].deep).toBe(false)
    expect(rows[2].deep).toBe(true)
  })

  it('flags reference rows so filters never hide them as if they were roles', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[3].info).toBe(true)
    expect(rows[0].info).toBe(false)
  })

  it('classifies fields, terms, and types from the row text', () => {
    const rows = RowIndex.build(doc, TODAY).rows
    expect(rows[0].fields).toContain('swe')
    expect(rows[2].terms).toContain('sum27')
    expect(rows[1].types).toContain('newgrad')
  })

  it('groups rows under their section heading', () => {
    const { sections } = RowIndex.build(doc, TODAY)
    expect(sections.length).toBe(3)
    expect(sections[0].rows.length).toBe(2)
    expect(sections[1].deep).toBe(true)
    expect(sections[2].info).toBe(true)
  })
})
