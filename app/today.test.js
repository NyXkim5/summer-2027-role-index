import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
const TODAY = '2026-09-03'
const PROFILE = { fields: ['swe'], term: 'sum27', types: ['intern'] }

function row(over) {
  return Object.assign({
    key: 'k' + Math.random(), co: 'Co', title: 'Software Engineer Intern',
    loc: 'CA', url: 'https://x/' + Math.random(), date: '2026-09-02',
    fields: ['swe'], terms: ['sum27'], types: ['intern'],
    closed: false, deep: false, info: false,
  }, over)
}

beforeEach(() => {
  clearStorage()
  document.body.innerHTML = '<div id="m"></div>'
  S27 = loadApp('store.js', 'rowindex.js', 'match.js', 'status.js', 'today.js')
})

describe('pick', () => {
  it('ranks the strongest match first', () => {
    const weak = row({ key: 'weak', fields: [], date: null })
    const strong = row({ key: 'strong', fields: ['swe'] })
    const { fresh } = S27.Today.pick([weak, strong], PROFILE, S27.Store, TODAY)
    expect(fresh[0].row.key).toBe('strong')
  })

  it('drops rows below the threshold', () => {
    const { fresh } = S27.Today.pick([row({ key: 'weak', fields: [], date: null })], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).not.toContain('weak')
  })

  it('drops excluded rows even when they score well elsewhere', () => {
    const closed = row({ key: 'closed', closed: true })
    const wrongTerm = row({ key: 'wrongterm', terms: ['fall26'] })
    const { fresh } = S27.Today.pick([closed, wrongTerm], PROFILE, S27.Store, TODAY)
    expect(fresh).toEqual([])
  })

  it('never shows a row the reader has already handled', () => {
    const a = row({ key: 'a' })
    const b = row({ key: 'b' })
    S27.Status.set(b, 'dismissed')
    const { fresh } = S27.Today.pick([a, b], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).toEqual(['a'])
  })

  it('never shows a row that a previous visit already displayed', () => {
    const a = row({ key: 'a' })
    S27.Store.markSeen('a')
    const { fresh } = S27.Today.pick([a, row({ key: 'b' })], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).toEqual(['b'])
  })

  it('caps the list so the view stays readable', () => {
    const many = []
    for (let i = 0; i < 40; i++) many.push(row({ key: 'k' + i }))
    const { fresh } = S27.Today.pick(many, PROFILE, S27.Store, TODAY)
    expect(fresh.length).toBe(15)
  })

  it('backfills with seen rows when too little is new, and keeps them separate', () => {
    const a = row({ key: 'a' })
    const b = row({ key: 'b' })
    S27.Store.markSeen('b')
    const { fresh, backfill } = S27.Today.pick([a, b], PROFILE, S27.Store, TODAY)
    expect(fresh.map((f) => f.row.key)).toEqual(['a'])
    expect(backfill.map((f) => f.row.key)).toEqual(['b'])
  })

  it('does not backfill once enough rows are genuinely new', () => {
    const rows = []
    for (let i = 0; i < 6; i++) rows.push(row({ key: 'n' + i }))
    const seen = row({ key: 'seen' })
    S27.Store.markSeen('seen')
    const { backfill } = S27.Today.pick(rows.concat([seen]), PROFILE, S27.Store, TODAY)
    expect(backfill).toEqual([])
  })

  it('skips reference rows, which are not roles', () => {
    const { fresh } = S27.Today.pick([row({ key: 'i', info: true })], PROFILE, S27.Store, TODAY)
    expect(fresh).toEqual([])
  })
})

describe('render', () => {
  it('marks every row it displayed as seen so it does not repeat tomorrow', () => {
    const a = row({ key: 'a' })
    S27.Today.render(document.getElementById('m'), [a], PROFILE, TODAY)
    expect(S27.Store.isSeen('a')).toBe(true)
  })

  it('says so plainly when there is nothing new rather than rendering an empty box', () => {
    const el = S27.Today.render(document.getElementById('m'), [], PROFILE, TODAY)
    expect(el.textContent).toContain('Nothing new')
  })
})
