// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../test/fake-storage'

vi.stubGlobal('localStorage', fakeStorage())

import { openSettings } from './settings-view'
import {
  builtinSets, encodeControlSet, getActiveControlSet, listControlSets,
} from '../game/input/control-sets'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]

function findButton(label: string, root: ParentNode = document): HTMLButtonElement {
  const btn = [...root.querySelectorAll('button')].find(b => b.textContent === label)
  if (!btn) throw new Error(`no button "${label}"`)
  return btn as HTMLButtonElement
}

describe('settings overlay', () => {
  it('lists the built-in sets with the active one marked', () => {
    openSettings()
    const rows = $$('.set-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].classList.contains('active')).toBe(true)
    expect(rows[0].querySelector('.set-name')!.textContent).toBe('Standard (12 per tab)')
    expect(rows[1].querySelector('.set-name')!.textContent).toBe('Big keys (9+9+12)')
    expect($$('.set-badge')).toHaveLength(2)
  })

  it('activates a set when its row is tapped', () => {
    openSettings()
    $$('.set-row-main')[1].click()
    expect(getActiveControlSet().id).toBe('bigkeys')
    expect($$('.set-row')[1].classList.contains('active')).toBe(true)
  })

  it('imports a valid string as a new active custom set, and reports bad ones', () => {
    openSettings()
    findButton('Import…').click()
    const field = $<HTMLTextAreaElement>('.settings-import-field')!

    field.value = 'garbage'
    findButton('Import').click()
    expect($('.settings-error')!.hidden).toBe(false)
    expect($('.settings-error')!.textContent).toContain('not a control-set')

    findButton('Import…').click()  // list re-rendered the collapsed area; reopen
    const field2 = $<HTMLTextAreaElement>('.settings-import-field')!
    field2.value = encodeControlSet({ ...builtinSets()[1], name: 'Imported set' })
    findButton('Import').click()

    const names = $$('.set-name').map(e => e.textContent)
    expect(names).toContain('Imported set')
    expect(getActiveControlSet().name).toBe('Imported set')
  })

  it('duplicates a built-in into an editable custom set', () => {
    openSettings()
    $$('.set-row-more')[0].click()
    findButton('Duplicate').click()
    expect(listControlSets()).toHaveLength(3)
    const custom = listControlSets()[2]
    expect(custom.builtin).toBeUndefined()
    expect(custom.name).toBe('My controls')
    expect(custom.tabs).toEqual(builtinSets()[0].tabs)
  })

  it('creates, edits, and saves a new set through the editor', () => {
    openSettings()
    findButton('＋ New set').click()

    // editor is showing, seeded from the active (Standard) set
    expect($('.settings-h')!.textContent).toBe('New control set')
    const nameInput = $<HTMLInputElement>('.ed-name-input')!
    nameInput.value = 'Edited set'

    // rename the first tab
    const charInput = $<HTMLInputElement>('.ed-tab-char')!
    charInput.value = 'Q'
    charInput.dispatchEvent(new Event('input', { bubbles: true }))

    // shrink the first tab to 3×3
    const firstTabBox = $('.ed-tab')!
    findButton('3×3', firstTabBox).click()
    expect($$('.ed-tab')[0].querySelectorAll('.ed-slot')).toHaveLength(9)

    // reassign its first slot to a macro via the picker
    $$('.ed-slot')[0].click()
    const pickerInput = $<HTMLInputElement>('.ed-picker-text')!
    pickerInput.value = 'za.'
    findButton('Set').click()
    expect($$('.ed-slot')[0].textContent).toBe('za.')

    findButton('Save').click()

    const saved = listControlSets().find(s => s.name === 'Edited set')!
    expect(saved).toBeDefined()
    expect(saved.tabs[0].name).toBe('Q')
    expect(saved.tabs[0].cols).toBe(3)
    expect(saved.tabs[0].slots[0]).toEqual({ text: 'za.' })
    expect(saved.tabs[0].slots).toHaveLength(9)
    // a brand-new set becomes active on save
    expect(getActiveControlSet().id).toBe(saved.id)
  })

  it('a new set opens with every tab at 3×4 even when cloned from a 3×3 set', () => {
    openSettings()
    $$('.set-row-main')[1].click()  // activate Big keys (3×3 first tabs)
    findButton('＋ New set').click()
    for (const tab of $$('.ed-tab')) {
      expect(tab.querySelectorAll('.ed-slot')).toHaveLength(12)
    }
    // the 3×3 source keys occupy the first three columns; col 4 is empty
    const faces = [...$$('.ed-tab')[0].querySelectorAll('.ed-slot')].map(s => s.textContent)
    expect(faces.slice(0, 4)).toEqual(['⇥', '5', 'o', '·'])
  })

  it('toggling a tab 4→3→4 in the editor keeps the 4th-column keys', () => {
    openSettings()
    findButton('＋ New set').click()
    const firstTabBox = $('.ed-tab')!
    findButton('3×3', firstTabBox).click()
    findButton('3×4', $('.ed-tab')!).click()
    const faces = $$('.ed-tab')[0].querySelectorAll('.ed-slot')
    expect(faces).toHaveLength(12)
    expect(faces[3].textContent).toBe('o')  // Standard @ row 1 col 4 restored
  })

  it('deletes a custom set only after arming the button', () => {
    openSettings()
    $$('.set-row-more')[0].click()
    findButton('Duplicate').click()
    expect(listControlSets()).toHaveLength(3)

    $$('.set-row-more')[2].click()
    const del = findButton('Delete')
    del.click()
    expect(listControlSets()).toHaveLength(3)  // armed, not deleted
    expect(del.textContent).toBe('Really delete?')
    del.click()
    expect(listControlSets()).toHaveLength(2)
  })

  it('morphs the Export button to "Copied ✓" on clipboard success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    openSettings()
    $$('.set-row-more')[0].click()
    const exp = findButton('Export')
    exp.click()
    await vi.waitFor(() => expect(exp.textContent).toBe('Copied ✓'))
    expect(exp.classList.contains('flash')).toBe(true)
    expect(exp.disabled).toBe(true)
  })

  it('exports to a visible fallback when the clipboard is unavailable', () => {
    // Force the no-clipboard path so the assertion is deterministic (the
    // clipboard path resolves asynchronously).
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    openSettings()
    $$('.set-row-more')[0].click()
    findButton('Export').click()
    const out = $<HTMLTextAreaElement>('.settings-export-out textarea')!
    expect(out.value).toBe(encodeControlSet(builtinSets()[0]))
  })
})
