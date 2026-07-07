// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../../test/fake-storage'

vi.stubGlobal('localStorage', fakeStorage())

import { buildTouchControls } from './touch'
import {
  cloneSet, newSetId, saveControlSet, setActiveControlSet, builtinSets,
} from './control-sets'
import type { ClientMsg } from '../../ws/types'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

function setup() {
  const sent: ClientMsg[] = []
  const tc = buildTouchControls(msg => sent.push(msg))
  document.body.appendChild(tc.element)  // connected: the live-apply listener stays subscribed
  return { tc, sent }
}

// button.tc-btn: spacer divs also carry the .tc-btn class for layout
const tabButtons = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.tc-content button.tc-btn')]

const tabStrip = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.tc-tab')].map(b => b.textContent)

describe('control-set-driven rendering', () => {
  it('renders the Standard @ tab by default: 12 buttons, original faces and dispatch', () => {
    const { tc, sent } = setup()
    const btns = tabButtons(tc.element)
    expect(btns).toHaveLength(12)
    expect(btns[0].textContent).toBe('⇥')
    expect(btns[0].classList.contains('glyph')).toBe(true)

    btns[0].click()
    expect(sent.pop()).toEqual({ msg: 'key', keycode: 9 })
    btns.find(b => b.textContent === 'q')!.click()
    expect(sent.pop()).toEqual({ msg: 'input', text: 'q' })
  })

  it('re-renders live when the active set changes (3×3 Big keys grid)', () => {
    const { tc } = setup()
    setActiveControlSet('bigkeys')
    const btns = tabButtons(tc.element)
    expect(btns).toHaveLength(9)
    const rows = tc.element.querySelectorAll('.tc-content .tc-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].querySelectorAll('.tc-btn')).toHaveLength(3)
  })

  it('shows custom tab labels, macros, and empty-slot spacers', () => {
    const set = cloneSet(builtinSets()[0], newSetId(), 'Custom')
    set.tabs[0].name = 'A'
    set.tabs[1].name = 'B'
    set.tabs[2].name = 'C'
    set.tabs[0].slots[0] = { text: 'za.' }
    set.tabs[0].slots[1] = null
    saveControlSet(set)

    const { tc, sent } = setup()
    setActiveControlSet(set.id)

    expect(tabStrip(tc.element)).toEqual(['A', 'B', 'C'])

    const btns = tabButtons(tc.element)
    expect(btns).toHaveLength(11)  // one slot is a spacer, not a button
    expect(tc.element.querySelectorAll('.tc-btn-spacer')).toHaveLength(1)

    const macro = btns[0]
    expect(macro.textContent).toBe('za.')
    expect(macro.classList.contains('tri')).toBe(true)
    macro.click()
    expect(sent.pop()).toEqual({ msg: 'input', text: 'za.' })
  })

  it('keeps the active tab position across a set switch', () => {
    const { tc } = setup()
    // switch to the info tab (position 3, labelled '?')
    const infoTab = tc.element.querySelector<HTMLElement>('.tc-tab[data-tab="info"]')!
    infoTab.click()
    expect(infoTab.classList.contains('active')).toBe(true)

    setActiveControlSet('bigkeys')
    const infoAfter = tc.element.querySelector<HTMLElement>('.tc-tab[data-tab="info"]')!
    expect(infoAfter.classList.contains('active')).toBe(true)
    expect(tabButtons(tc.element)).toHaveLength(12)  // Big keys info tab keeps 3×4
  })

  it('unhooks its live-apply listener after the panel is discarded', () => {
    const { tc } = setup()
    tc.element.remove()
    // Fires the change event with the panel gone: listener must self-remove
    // without touching the dead DOM (and without throwing).
    expect(() => setActiveControlSet('bigkeys')).not.toThrow()
  })
})
