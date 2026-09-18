import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Same classic-script loader app/test-helpers.js uses. The bare jsdom
// document carries no #apply-root, so the module skips init and only the
// pure helpers are exercised here. No fetch ever fires.
function loadApply() {
  delete globalThis.S27
  const path = resolve(HERE, 'apply-ui.js')
  runInThisContext(readFileSync(path, 'utf8'), { filename: path })
  return globalThis.S27.Apply
}

let A
beforeEach(() => { A = loadApply() })

describe('parseTags', () => {
  it('splits on commas, trims, and lowercases', () => {
    expect(A.parseTags(' ML, SWE , Defense')).toEqual(['ml', 'swe', 'defense'])
  })

  it('dedupes case-insensitively and drops empties', () => {
    expect(A.parseTags('swe,, SWE ,swe,')).toEqual(['swe'])
  })

  it('returns an empty list for blank or missing input', () => {
    expect(A.parseTags('')).toEqual([])
    expect(A.parseTags(undefined)).toEqual([])
    expect(A.parseTags(' , , ')).toEqual([])
  })
})

describe('splitUrls', () => {
  it('splits a pasted blob on newlines, spaces, and commas', () => {
    const text = 'https://a.example/1\n\nhttps://b.example/2, https://c.example/3 https://d.example/4'
    expect(A.splitUrls(text)).toEqual([
      'https://a.example/1', 'https://b.example/2',
      'https://c.example/3', 'https://d.example/4',
    ])
  })

  it('drops anything that is not an http(s) URL', () => {
    expect(A.splitUrls('see this\nftp://x.example/f\nhttps://ok.example/1')).toEqual([
      'https://ok.example/1',
    ])
  })

  it('dedupes repeated URLs and keeps first-seen order', () => {
    expect(A.splitUrls('https://a.example/1\nhttps://b.example/2\nhttps://a.example/1')).toEqual([
      'https://a.example/1', 'https://b.example/2',
    ])
  })

  it('returns an empty list for blank input', () => {
    expect(A.splitUrls('')).toEqual([])
    expect(A.splitUrls(null)).toEqual([])
  })
})

describe('readiness', () => {
  const fullProfile = { name: 'Jay', email: 'j@x.com', phone: '555', location: 'NoVA' }
  const taggedLibrary = { resumes: [{ id: 'r1', label: 'SWE', tags: ['swe'] }] }
  const oneQueued = { items: [{ id: 'q1', status: 'queued' }] }

  it('fails every check on empty state and maps each check to its tab', () => {
    const r = A.readiness(null, null, null)
    expect(r.ready).toBe(false)
    expect(r.checks.map((c) => c.ok)).toEqual([false, false, false])
    expect(r.checks.map((c) => c.tab)).toEqual(['profile', 'resumes', 'queue'])
  })

  it('requires all four of name, email, phone, location', () => {
    const missingPhone = { name: 'Jay', email: 'j@x.com', phone: '  ', location: 'NoVA' }
    const r = A.readiness(missingPhone, taggedLibrary, oneQueued)
    expect(r.checks[0].ok).toBe(false)
    expect(r.ready).toBe(false)
  })

  it('does not count a resume without tags', () => {
    const untagged = { resumes: [{ id: 'r1', label: 'SWE', tags: [] }] }
    const r = A.readiness(fullProfile, untagged, oneQueued)
    expect(r.checks[1].ok).toBe(false)
    expect(r.ready).toBe(false)
  })

  it('counts one tagged resume among untagged ones', () => {
    const mixed = { resumes: [{ tags: [] }, { tags: ['ml'] }] }
    expect(A.readiness(fullProfile, mixed, oneQueued).checks[1].ok).toBe(true)
  })

  it('passes all three and flips ready with a full setup', () => {
    const r = A.readiness(fullProfile, taggedLibrary, oneQueued)
    expect(r.checks.map((c) => c.ok)).toEqual([true, true, true])
    expect(r.ready).toBe(true)
  })
})

describe('summarizePost', () => {
  it('counts added items per ATS in greenhouse, lever, ashby order', () => {
    const res = {
      added: [
        { ats: 'lever', status: 'queued' },
        { ats: 'greenhouse', status: 'queued' },
        { ats: 'greenhouse', status: 'queued' },
        { ats: 'ashby', status: 'queued' },
      ],
    }
    expect(A.summarizePost(res)).toBe('Added 2 greenhouse, 1 lever, 1 ashby.')
  })

  it('counts unknown-ATS and unsupported-status items as unsupported', () => {
    const res = {
      added: [
        { ats: 'workday', status: 'queued' },
        { ats: 'other', status: 'unsupported' },
        { ats: 'greenhouse', status: 'queued' },
      ],
    }
    expect(A.summarizePost(res)).toBe('Added 1 greenhouse. 2 queued as unsupported.')
  })

  it('reports rejected counts grouped by reason', () => {
    const res = {
      added: [{ ats: 'lever', status: 'queued' }],
      rejected: [
        { url: 'https://a', reason: 'duplicate' },
        { url: 'https://b', reason: 'duplicate' },
        { url: 'https://c', reason: 'already-applied' },
      ],
    }
    expect(A.summarizePost(res)).toBe(
      'Added 1 lever. Rejected 3 (2 duplicate, 1 already-applied).'
    )
  })

  it('accepts a bare array of added items', () => {
    expect(A.summarizePost([{ ats: 'ashby', status: 'queued' }])).toBe('Added 1 ashby.')
  })

  it('says nothing was added when the response is empty', () => {
    expect(A.summarizePost({ added: [] })).toBe('Nothing added.')
    expect(A.summarizePost(null)).toBe('Nothing added.')
  })
})

describe('groupQueue', () => {
  it('pins parked to the top whatever order the items arrive in', () => {
    const items = [
      { id: '1', status: 'queued' },
      { id: '2', status: 'submitted' },
      { id: '3', status: 'parked' },
      { id: '4', status: 'queued' },
    ]
    const groups = A.groupQueue(items)
    expect(groups.map((g) => g.status)).toEqual(['parked', 'queued', 'submitted'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['3'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['1', '4'])
  })

  it('omits empty groups entirely', () => {
    const groups = A.groupQueue([{ id: '1', status: 'blocked' }])
    expect(groups.map((g) => g.status)).toEqual(['blocked'])
  })

  it('collects unknown statuses into a trailing group instead of dropping them', () => {
    const groups = A.groupQueue([
      { id: '1', status: 'parked' },
      { id: '2', status: 'weird' },
    ])
    expect(groups.map((g) => g.status)).toEqual(['parked', 'other'])
    expect(groups[1].items[0].id).toBe('2')
  })

  it('handles an empty or missing list', () => {
    expect(A.groupQueue([])).toEqual([])
    expect(A.groupQueue(undefined)).toEqual([])
  })
})

describe('parkedDetails', () => {
  it('reads structured notes given as an object', () => {
    const item = {
      notes: {
        resume_used: 'SWE general',
        fields_pending: ['gpa'],
        screeners_unanswered: ['Why us?'],
      },
    }
    expect(A.parkedDetails(item)).toEqual({
      resume: 'SWE general',
      fieldsPending: ['gpa'],
      screeners: ['Why us?'],
    })
  })

  it('parses notes given as a JSON string', () => {
    const item = { notes: '{"resume_used":"ML","fields_pending":[],"screeners_unanswered":["visa"]}' }
    const d = A.parkedDetails(item)
    expect(d.resume).toBe('ML')
    expect(d.screeners).toEqual(['visa'])
  })

  it('reads resume_id, the key serve.py validates in notes', () => {
    const item = { notes: { resume_id: 'r2', fields_pending: [], screeners_unanswered: [] } }
    expect(A.parkedDetails(item).resume).toBe('r2')
  })

  it('prefers resume_id over legacy resume_used', () => {
    const item = { notes: { resume_id: 'r2', resume_used: 'old label' } }
    expect(A.parkedDetails(item).resume).toBe('r2')
  })

  it('falls back to empty details on malformed or missing notes', () => {
    const empty = { resume: null, fieldsPending: [], screeners: [] }
    expect(A.parkedDetails({ notes: 'not json {' })).toEqual(empty)
    expect(A.parkedDetails({})).toEqual(empty)
    expect(A.parkedDetails(null)).toEqual(empty)
  })
})

describe('resume pinning', () => {
  const resumes = [
    { id: 'r1', label: 'SWE general' },
    { id: 'r2', label: 'ML research' },
  ]

  it('builds one option per resume and marks the pinned one selected', () => {
    const opts = A.resumeOptions(resumes, { id: 'q1', resume_id: 'r2' })
    expect(opts).toEqual([
      { id: 'r1', label: 'SWE general', selected: false },
      { id: 'r2', label: 'ML research', selected: true },
    ])
  })

  it('selects nothing when the item has no pin', () => {
    const opts = A.resumeOptions(resumes, { id: 'q1' })
    expect(opts.every((o) => !o.selected)).toBe(true)
  })

  it('resolves the pinned label, falling back to the raw id for a deleted resume', () => {
    expect(A.pinnedLabel(resumes, { resume_id: 'r1' })).toBe('SWE general')
    expect(A.pinnedLabel(resumes, { resume_id: 'gone' })).toBe('gone')
    expect(A.pinnedLabel(resumes, { id: 'q1' })).toBe(null)
  })

  it('builds the PUT payload for a pin', () => {
    expect(A.pinPayload('r2')).toEqual({ resume_id: 'r2' })
  })
})

describe('markOptions', () => {
  it('offers submitted and skipped on a parked item', () => {
    expect(A.markOptions('parked').map((c) => c[0])).toEqual(['submitted', 'skipped'])
  })

  it('offers only skipped on a queued item, matching the server state machine', () => {
    expect(A.markOptions('queued').map((c) => c[0])).toEqual(['skipped'])
  })

  it('offers nothing for terminal or unknown statuses', () => {
    ;['submitted', 'skipped', 'blocked', 'unsupported', 'weird'].forEach((s) => {
      expect(A.markOptions(s), s).toEqual([])
    })
  })
})

describe('isTerminal', () => {
  it('treats submitted, skipped, blocked, unsupported as terminal', () => {
    ;['submitted', 'skipped', 'blocked', 'unsupported'].forEach((s) => {
      expect(A.isTerminal(s), s).toBe(true)
    })
  })

  it('keeps queued and parked live', () => {
    expect(A.isTerminal('queued')).toBe(false)
    expect(A.isTerminal('parked')).toBe(false)
  })
})

describe('buildProfile', () => {
  it('carries every spec field, trimmed, defaulting absent ones to empty strings', () => {
    const p = A.buildProfile({ name: '  Jay Kim ', email: 'j@x.com' }, [])
    expect(p.name).toBe('Jay Kim')
    expect(p.email).toBe('j@x.com')
    A.PROFILE_FIELDS.forEach(([key]) => {
      expect(typeof p[key], key).toBe('string')
    })
    expect(p.gpa).toBe('')
    expect(p.custom).toEqual({})
  })

  it('folds custom rows into the custom map and drops rows with a blank key', () => {
    const p = A.buildProfile({}, [
      { key: ' clearance ', value: ' none ' },
      { key: '', value: 'orphan value' },
      { key: 'languages', value: 'en, ko' },
    ])
    expect(p.custom).toEqual({ clearance: 'none', languages: 'en, ko' })
  })
})
