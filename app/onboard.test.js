import { beforeEach, describe, expect, it } from 'vitest'
import { loadApp, clearStorage } from './test-helpers.js'

let S27
let mount

beforeEach(() => {
  clearStorage()
  document.body.innerHTML = '<div id="m"></div>'
  mount = document.getElementById('m')
  S27 = loadApp('store.js', 'rowindex.js', 'onboard.js')
})

describe('isComplete', () => {
  it('needs at least one field before it will call a profile usable', () => {
    expect(S27.Onboard.isComplete({ fields: [], term: 'sum27', types: ['intern'] })).toBe(false)
    expect(S27.Onboard.isComplete({ fields: ['swe'], term: null, types: [] })).toBe(true)
  })

  it('treats a missing profile as incomplete', () => {
    expect(S27.Onboard.isComplete(null)).toBe(false)
  })
})

describe('render', () => {
  it('offers a chip for every field, term, and type the index knows', () => {
    S27.Onboard.render(mount, () => {})
    expect(mount.querySelectorAll('[data-group="fields"] button').length).toBe(12)
    expect(mount.querySelectorAll('[data-group="term"] button').length).toBe(3)
    expect(mount.querySelectorAll('[data-group="types"] button').length).toBe(2)
  })

  it('lets a reader pick several fields but only one term', () => {
    S27.Onboard.render(mount, () => {})
    const fields = mount.querySelectorAll('[data-group="fields"] button')
    fields[0].click()
    fields[1].click()
    const terms = mount.querySelectorAll('[data-group="term"] button')
    terms[0].click()
    terms[1].click()
    S27.Onboard.save()
    const p = S27.Store.getProfile()
    expect(p.fields.length).toBe(2)
    expect(p.term).toBe('spr27')
  })

  it('saves the profile and reports it to the caller', () => {
    let got = null
    S27.Onboard.render(mount, (p) => { got = p })
    mount.querySelector('[data-group="fields"] button').click()
    mount.querySelector('.ob-save').click()
    expect(got.fields).toEqual(['swe'])
    expect(S27.Store.getProfile().fields).toEqual(['swe'])
  })

  it('pre-selects the chips from a profile saved on an earlier visit', () => {
    S27.Store.setProfile({ fields: ['quant'], term: 'sum27', types: ['intern'] })
    S27.Onboard.render(mount, () => {})
    const pressed = [...mount.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.dataset.val)
    expect(pressed).toContain('quant')
    expect(pressed).toContain('sum27')
    expect(pressed).toContain('intern')
  })

  it('records a skip so the strip does not reappear on every visit', () => {
    S27.Onboard.render(mount, () => {})
    mount.querySelector('.ob-skip').click()
    expect(S27.Store.getProfile()).toEqual({ fields: [], term: null, types: [], skipped: true })
  })
})
