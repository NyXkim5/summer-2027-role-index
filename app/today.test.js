import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
const TODAY = '2026-09-03'
const PROFILE = { fields: ['swe'], term: 'sum27', types: ['intern'] }
// Shares no field, no term and no type with PROFILE, so a row that matches
// one is hard excluded by the other.
const OTHER = { fields: ['civil'], term: 'fall26', types: ['newgrad'] }
// The stored day list is keyed by the day and by the profile fingerprint.
function fp(profile) {
  return S27.Match.profileKey(profile || PROFILE)
}

function row(over) {
  return Object.assign({
    key: 'k' + Math.random(), co: 'Co', title: 'Software Engineer Intern',
    loc: 'CA', url: 'https://x/' + Math.random(), date: '2026-09-02',
    fields: ['swe'], terms: ['sum27'], types: ['intern'],
    closed: false, deep: false, info: false,
  }, over)
}

function civilRow(over) {
  return row(Object.assign({ fields: ['civil'], terms: ['fall26'], types: ['newgrad'] }, over))
}

function keysOf(list) {
  return list.map((e) => e.row.key)
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

  it('shows the same list again on a reload instead of burning through the queue', () => {
    // Eight loads in one day used to consume the whole eligible pool with zero
    // overlap, because render marks rows seen and pick routes seen rows out of
    // fresh. Two open tabs did the same. There is no way to undo it.
    const rows = []
    for (let i = 0; i < 90; i++) rows.push(row({ key: 'k' + i }))

    const seenAcross = []
    let first = null
    for (let load = 0; load < 8; load++) {
      document.body.innerHTML = '<div id="m"></div>'
      // A reload is a fresh script run against the same localStorage.
      S27 = loadApp('store.js', 'rowindex.js', 'match.js', 'status.js', 'today.js')
      const el = S27.Today.render(document.getElementById('m'), rows, PROFILE, TODAY)
      const shown = Array.from(el.querySelectorAll('.tcard-title')).length
      const titles = Array.from(el.querySelectorAll('.tcard-co')).length
      expect(shown).toBe(titles)
      const keys = S27.Store.getPicks(TODAY, fp()).fresh
      if (first === null) first = keys
      else expect(keys).toEqual(first)
      seenAcross.push(shown)
    }
    expect(first.length).toBe(15)
    expect(seenAcross).toEqual([15, 15, 15, 15, 15, 15, 15, 15])
  })

  it('drops a card the reader has since handled from the stored day list', () => {
    const rows = [row({ key: 'a' }), row({ key: 'b' })]
    S27.Today.render(document.getElementById('m'), rows, PROFILE, TODAY)
    S27.Status.set(rows[0], 'dismissed')

    document.body.innerHTML = '<div id="m"></div>'
    S27 = loadApp('store.js', 'rowindex.js', 'match.js', 'status.js', 'today.js')
    const el = S27.Today.render(document.getElementById('m'), rows, PROFILE, TODAY)
    const shown = Array.from(el.querySelectorAll('.tcard-title')).map((n) => n.textContent)
    expect(shown.length).toBe(1)
  })

  it('shows the same cards again on a reload when the profile has not changed', () => {
    // The point of storing the day's list. This pins the rendered cards, not
    // just the stored keys, because a reader judges the page by what is on it.
    const rows = []
    for (let i = 0; i < 40; i++) rows.push(row({ key: 'k' + i, title: 'Software Engineer Intern ' + i }))
    const textOf = (el) => Array.from(el.querySelectorAll('.tcard')).map((c) => c.textContent)

    const first = textOf(S27.Today.render(document.getElementById('m'), rows, PROFILE, TODAY))
    document.body.innerHTML = '<div id="m"></div>'
    S27 = loadApp('store.js', 'rowindex.js', 'match.js', 'status.js', 'today.js')
    const second = textOf(S27.Today.render(document.getElementById('m'), rows, PROFILE, TODAY))

    expect(first.length).toBe(15)
    expect(second).toEqual(first)
  })

  it('picks a new list once the stored one belongs to an earlier day', () => {
    const rows = []
    for (let i = 0; i < 40; i++) rows.push(row({ key: 'k' + i }))
    S27.Today.render(document.getElementById('m'), rows, PROFILE, TODAY)
    const dayOne = S27.Store.getPicks(TODAY, fp()).fresh

    const TOMORROW = '2026-09-04'
    document.body.innerHTML = '<div id="m"></div>'
    S27 = loadApp('store.js', 'rowindex.js', 'match.js', 'status.js', 'today.js')
    S27.Today.render(document.getElementById('m'), rows, PROFILE, TOMORROW)
    const dayTwo = S27.Store.getPicks(TOMORROW, fp()).fresh

    expect(dayTwo.length).toBe(15)
    expect(dayTwo.filter((k) => dayOne.indexOf(k) !== -1)).toEqual([])
  })
})

describe('listFor', () => {
  it('picks a new list when the profile changed, even on the same day', () => {
    // The stored list belongs to the profile that picked it. Replaying it for
    // an edited profile handed the reader the same cards back, every one now
    // hard excluded and scoring zero.
    const rows = []
    for (let i = 0; i < 20; i++) rows.push(row({ key: 's' + i }))
    for (let i = 0; i < 20; i++) rows.push(civilRow({ key: 'c' + i }))

    const first = keysOf(S27.Today.listFor(rows, PROFILE, S27.Store, TODAY).fresh)
    const second = keysOf(S27.Today.listFor(rows, OTHER, S27.Store, TODAY).fresh)

    expect(first.length).toBe(15)
    expect(second.length).toBe(15)
    expect(first.every((k) => k[0] === 's')).toBe(true)
    expect(second.every((k) => k[0] === 'c')).toBe(true)
  })

  it('holds the day list when the same profile is written in a different order', () => {
    // The fingerprint is built from sorted content, so neither key order nor
    // the order a reader tapped the chips can make one profile look like two.
    // Rendering between the two calls is what gives this test teeth: render
    // marks its rows seen, so a fingerprint that disagreed with itself would
    // hand back the next fifteen rows instead of the same fifteen.
    const multi = { fields: ['swe', 'data'], term: 'sum27', types: ['intern'] }
    const reordered = { types: ['intern'], term: 'sum27', fields: ['data', 'swe'] }
    const rows = []
    for (let i = 0; i < 40; i++) rows.push(row({ key: 'k' + i }))

    S27.Today.render(document.getElementById('m'), rows, multi, TODAY)
    const first = keysOf(S27.Today.listFor(rows, multi, S27.Store, TODAY).fresh)
    const second = keysOf(S27.Today.listFor(rows, reordered, S27.Store, TODAY).fresh)

    expect(first.length).toBe(15)
    expect(second).toEqual(first)
  })
})
