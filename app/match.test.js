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

  it('does not exclude a row that carries no type signal at all', () => {
    const r = Match.score(row({ types: [], fields: ['swe'] }), { types: ['intern'], fields: ['swe'] }, TODAY)
    expect(r.excluded).toBe(null)
  })

  it('scores nothing and excludes nothing when there is no profile yet', () => {
    const r = Match.score(row({ fields: ['swe'] }), null, TODAY)
    expect(r).toEqual({ score: 0, excluded: null, reasons: [] })
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

  it('counts a posting made exactly FRESH_DAYS ago as still fresh', () => {
    const r = Match.score(row({ date: '2026-08-27', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(2)
  })

  it('counts a posting one day past the window as no longer fresh', () => {
    const r = Match.score(row({ date: '2026-08-26', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(0)
  })

  it('does not treat a future dated row as fresh', () => {
    const r = Match.score(row({ date: '2026-09-10', deep: true }), { fields: [] }, TODAY)
    expect(r.score).toBe(0)
    expect(Match.daysOld('2026-09-10', TODAY)).toBe(-7)
  })

  it('adds one point for a hand-checked section over the wide net', () => {
    expect(Match.score(row({ deep: false }), { fields: [] }, TODAY).score).toBe(1)
    expect(Match.score(row({ deep: true }), { fields: [] }, TODAY).score).toBe(0)
  })
})

describe('reasons', () => {
  it('names every rule that actually contributed and no others', () => {
    // The row carries a field the profile did not ask for, so a reasons list
    // built from the row rather than from the overlap is visibly wrong.
    const r = Match.score(row({ fields: ['swe', 'business'], date: '2026-09-02', deep: false }), { fields: ['swe'] }, TODAY)
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

describe('profileKey', () => {
  it('gives two profiles with the same content one key, whatever the order', () => {
    // Chip order and object key order are both accidents of how the profile
    // was built. Either one leaking into the key would repick the day's list
    // on a load that changed nothing.
    const a = { fields: ['swe', 'data'], term: 'sum27', types: ['intern', 'newgrad'] }
    const b = { types: ['newgrad', 'intern'], term: 'sum27', fields: ['data', 'swe'] }
    expect(Match.profileKey(b)).toBe(Match.profileKey(a))
  })

  it('gives a different key to every profile that ranks rows differently', () => {
    const base = { fields: ['swe'], term: 'sum27', types: ['intern'] }
    const keys = [
      base,
      { fields: ['civil'], term: 'sum27', types: ['intern'] },
      { fields: ['swe'], term: 'fall26', types: ['intern'] },
      { fields: ['swe'], term: 'sum27', types: ['newgrad'] },
      { fields: ['swe', 'data'], term: 'sum27', types: ['intern'] },
      { fields: [], term: null, types: [] },
    ].map((p) => Match.profileKey(p))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not confuse an added field with a renamed one', () => {
    // A key built by concatenating the parts with no separator would read
    // these two as the same profile.
    expect(Match.profileKey({ fields: ['swe'], term: null, types: [] }))
      .not.toBe(Match.profileKey({ fields: [], term: 'swe', types: [] }))
  })

  it('handles a missing profile rather than throwing', () => {
    expect(Match.profileKey(null)).toBe('')
  })
})
