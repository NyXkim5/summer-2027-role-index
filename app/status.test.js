import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
function row(over) {
  return Object.assign({
    key: 'u:x/1', co: 'Anduril', title: 'Flight Software Engineer',
    loc: 'Costa Mesa, CA', url: 'https://x/1',
  }, over)
}

beforeEach(() => {
  clearStorage()
  document.body.innerHTML = ''
  S27 = loadApp('store.js', 'status.js')
})

describe('snapshot', () => {
  it('captures enough to render the row after the page drops it', () => {
    expect(S27.Status.snapshot(row())).toEqual({
      co: 'Anduril', title: 'Flight Software Engineer',
      loc: 'Costa Mesa, CA', url: 'https://x/1',
    })
  })
})

describe('set', () => {
  it('stores the snapshot alongside the status so a pruned row survives', () => {
    S27.Status.set(row(), 'saved')
    expect(S27.Store.getStatus('u:x/1').snap.co).toBe('Anduril')
  })

  it('clears the status when passed null', () => {
    S27.Status.set(row(), 'applied')
    S27.Status.set(row(), null)
    expect(S27.Store.getStatus('u:x/1')).toBe(null)
  })
})

describe('controlsFor', () => {
  it('offers apply, save, and dismiss', () => {
    const el = S27.Status.controlsFor(row(), () => {})
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['Applied', 'Save', 'Not for me'])
  })

  it('marks the row applied when the reader clicks Applied', () => {
    const el = S27.Status.controlsFor(row(), () => {})
    document.body.appendChild(el)
    el.querySelector('button').click()
    expect(S27.Store.getStatus('u:x/1').s).toBe('applied')
  })

  it('toggles a status off when the same control is clicked twice', () => {
    const el = S27.Status.controlsFor(row(), () => {})
    document.body.appendChild(el)
    el.querySelector('button').click()
    el.querySelector('button').click()
    expect(S27.Store.getStatus('u:x/1')).toBe(null)
  })

  it('tells the caller the status changed so the view can re-render', () => {
    let seen = null
    const el = S27.Status.controlsFor(row(), (v) => { seen = v })
    document.body.appendChild(el)
    el.querySelectorAll('button')[1].click()
    expect(seen).toBe('saved')
  })

  it('shows the current status as pressed when the row already has one', () => {
    S27.Status.set(row(), 'saved')
    const el = S27.Status.controlsFor(row(), () => {})
    expect(el.querySelectorAll('button')[1].getAttribute('aria-pressed')).toBe('true')
  })
})

describe('badgeFor', () => {
  it('returns nothing for an untouched row', () => {
    expect(S27.Status.badgeFor(row())).toBe(null)
  })

  it('names the status for a row that has one', () => {
    S27.Status.set(row(), 'applied')
    expect(S27.Status.badgeFor(row()).textContent).toBe('applied')
  })
})
