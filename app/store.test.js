import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let Store

beforeEach(() => {
  clearStorage()
  vi.restoreAllMocks()
  Store = loadApp('store.js').Store
})

describe('load', () => {
  it('returns a blank record when storage is empty', () => {
    const d = Store.load()
    expect(d).toEqual({ v: 1, profile: null, lastVisit: null, seen: {}, status: {} })
  })

  it('reads back what a previous session saved', () => {
    Store.setStatus('u:jobs.example/1', 'applied', { co: 'Anduril', title: 'FSE', loc: 'CA', url: 'x' })
    Store.reset()
    expect(Store.getStatus('u:jobs.example/1').s).toBe('applied')
  })
})

describe('corrupt data', () => {
  it('backs the raw string up instead of discarding it, then starts clean', () => {
    globalThis.localStorage.setItem(Store.KEY, '{not json')
    Store.reset()
    const d = Store.load()
    expect(d.status).toEqual({})
    expect(globalThis.localStorage.getItem(Store.BAK)).toBe('{not json')
    expect(Store.isDegraded()).toBe(true)
  })

  it('backs up a record from an unknown schema version before discarding it', () => {
    const old = JSON.stringify({ v: 99, status: { a: { s: 'applied' } } })
    globalThis.localStorage.setItem(Store.KEY, old)
    Store.reset()
    expect(Store.load().status).toEqual({})
    expect(globalThis.localStorage.getItem(Store.BAK)).toBe(old)
  })
})

describe('migrate', () => {
  it('keeps a record written by the current schema version', () => {
    const out = Store.migrate({ v: 1, profile: { fields: ['swe'] }, lastVisit: '2026-09-01', seen: { a: '2026-09-01' }, status: {} })
    expect(out.profile).toEqual({ fields: ['swe'] })
    expect(out.seen).toEqual({ a: '2026-09-01' })
  })

  it('drops a record from an unknown schema version rather than trusting it', () => {
    const out = Store.migrate({ v: 99, status: { a: { s: 'applied' } } })
    expect(out.status).toEqual({})
  })
})

describe('degraded storage', () => {
  it('keeps working in memory when the browser refuses to write', () => {
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    Store.setStatus('k', 'saved', { co: 'A', title: 'B', loc: 'C', url: 'd' })
    expect(Store.getStatus('k').s).toBe('saved')
    expect(Store.isDegraded()).toBe(true)
  })
})

describe('setStatus', () => {
  it('removes the entry when passed null so a reader can undo', () => {
    Store.setStatus('k', 'dismissed', { co: 'A', title: 'B', loc: 'C', url: 'd' })
    Store.setStatus('k', null)
    expect(Store.getStatus('k')).toBe(null)
  })
})

describe('seen', () => {
  it('records the first date a row was shown and does not move it later', () => {
    Store.markSeen('k')
    // Backdate the stored value so a missing guard would visibly overwrite it.
    // Same-day clock granularity cannot show the difference on its own.
    Store.load().seen['k'] = '2020-01-01'
    Store.save()
    Store.markSeen('k')
    expect(Store.load().seen['k']).toBe('2020-01-01')
    expect(Store.isSeen('k')).toBe(true)
  })
})
