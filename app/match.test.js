import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp } from './test-helpers.js'

let Match
const TODAY = '2026-09-03'

function row(over) {
  return Object.assign({
    key: 'u:x/1', co: 'Anduril', title: 'Flight Software Engineer', loc: 'Costa Mesa',
    url: 'https://x/1', date: null, fields: [], terms: [], types: [],
    closed: false, deep: false, info: false,
  }, over)
}

beforeEach(() => { Match = loadApp('match.js').Match })

describe('hard excludes', () => {
  it('excludes a closed row whatever else matches', () => {
    const r = Match.score(row({ closed: true, fields: ['swe'] }), { fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe('closed')
    expect(r.score).toBe(0)
  })

  it('excludes a row whose term conflicts with the profile', () => {
    const r = Match.score(row({ terms: ['fall26'] }), { term: 'sum27' }, TODAY)
    expect(r.excluded).toBe('term')
  })

  it('does not exclude a row that carries no term signal at all', () => {
    const r = Match.score(row({ terms: [], fields: ['swe'] }), { term: 'sum27', fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe(null)
  })

  it('excludes a new grad row for a reader who wants internships', () => {
    const r = Match.score(row({ types: ['newgrad'] }), { types: ['intern'] }, TODAY)
    expect(r.excluded).toBe('type')
  })

  it('keeps a row that matches any one of several wanted types', () => {
    const r = Match.score(row({ types: ['newgrad'] }), { types: ['intern', 'newgrad'] }, TODAY)
    expect(r.excluded).toBe(null)
  })
})

describe('ranking', () => {
  it('scores three points per overlapping field', () => {
    const r = Match.score(row({ fields: ['swe', 'data'], deep: true }), { fields: ['swe', 'data'] }, TODAY)
    expect(r.score).toBe(6)
  })

  it('does not exclude a row that misses on field, because titles lie', () => {
    const r = Match.score(row({ fields: ['business'], deep: true }), { fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe(null)
    expect(r.score).toBe(0)
  })

  it('adds two points for a posting inside the freshness window', () => {
    const r = Match.score(row({ date: '2026-09-01', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(2)
  })

  it('adds nothing for a posting older than the freshness window', () => {
    const r = Match.score(row({ date: '2026-08-20', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(0)
  })

  it('adds one point for a hand-checked section over the wide net', () => {
    expect(Match.score(row({ deep: false }), { fields: [] }, TODAY).score).toBe(1)
    expect(Match.score(row({ deep: true }), { fields: [] }, TODAY).score).toBe(0)
  })
})

describe('reasons', () => {
  it('names every rule that actually contributed and no others', () => {
    const r = Match.score(row({ fields: ['swe'], date: '2026-09-02', deep: false }), { fields: ['swe'] }, TODAY)
    expect(r.reasons).toEqual([
      { t: 'fields', v: ['swe'] },
      { t: 'fresh', v: 1 },
      { t: 'vetted' },
    ])
    expect(r.score).toBe(6)
  })

  it('returns no reasons for an excluded row', () => {
    const r = Match.score(row({ closed: true, fields: ['swe'] }), { fields: ['swe'] }, TODAY)
    expect(r.reasons).toEqual([])
  })
})

describe('daysOld', () => {
  it('counts whole days back from today', () => {
    expect(Match.daysOld('2026-09-01', TODAY)).toBe(2)
    expect(Match.daysOld('2026-09-03', TODAY)).toBe(0)
  })

  it('returns null for a row with no date rather than guessing zero', () => {
    expect(Match.daysOld(null, TODAY)).toBe(null)
  })
})

describe('threshold', () => {
  it('is set so that a single field match clears it', () => {
    expect(Match.THRESHOLD).toBe(3)
  })
})
