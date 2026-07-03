// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import type { ClientMsg } from '../ws/types'
import {
  showInputDialog, showNewgameChoice, showRandomCombo, showSeedSelection,
  type OverlayScreenCtx, type UiPushMsg,
} from './game-overlays'

// Stub OverlayScreenCtx that records everything the screens do to it. The
// renderOverlay stub honours the real contract the screens rely on: clear the
// overlay, mount a title header, then run buildBody (which appends more into
// ctx.overlay). Layout side effects (hiding map/HUD/log) are game-view's
// business and don't exist here — these tests cover the screens' own DOM and
// wire traffic only.
function makeCtx() {
  const overlay = document.createElement('div')
  document.body.appendChild(overlay)
  const sent: ClientMsg[] = []
  const calls = {
    enterLayout: [] as Array<{ touch?: boolean } | undefined>,
    renderOverlay: [] as string[],
    autoOpenKbd: 0,
    focusView: 0,
  }
  const ctx: OverlayScreenCtx = {
    overlay,
    send: (m) => { sent.push(m) },
    enterLayout: (opts) => {
      calls.enterLayout.push(opts)
      overlay.innerHTML = ''
    },
    renderOverlay: (title, buildBody) => {
      calls.renderOverlay.push(title)
      overlay.innerHTML = ''
      const header = document.createElement('div')
      header.className = 'overlay-title'
      header.textContent = title
      overlay.appendChild(header)
      buildBody()
    },
    autoOpenKbd: () => { calls.autoOpenKbd++ },
    focusView: () => { calls.focusView++ },
  }
  return { ctx, overlay, sent, calls }
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}

describe('showInputDialog (msgwin-get-line)', () => {
  const MSG: UiPushMsg = { type: 'msgwin-get-line', prompt: '<cyan>Describe what?</cyan>', generation_id: 7 }

  it('renders the prompt and a focused-style input, opens the kbd', () => {
    const { ctx, overlay, calls } = makeCtx()
    showInputDialog(ctx, MSG)
    expect(calls.enterLayout).toEqual([undefined])  // touch controls stay visible
    expect(overlay.querySelector('.input-dialog-prompt')?.textContent).toBe('Describe what?')
    const input = overlay.querySelector<HTMLInputElement>('.input-dialog-field')
    expect(input).toBeTruthy()
    expect(input!.inputMode).toBe('none')  // virtual kbd owns typing, not the OS one
    expect(calls.autoOpenKbd).toBe(1)
  })

  it('echoes each edit as ui_state_sync with the push generation_id', () => {
    const { ctx, overlay, sent } = makeCtx()
    showInputDialog(ctx, MSG)
    type(overlay.querySelector<HTMLInputElement>('.input-dialog-field')!, 'orc')
    expect(sent).toEqual([
      { msg: 'ui_state_sync', widget_id: 'input', text: 'orc', cursor: 3, generation_id: 7 },
    ])
  })

  it('sends nothing on edit when the push carried no generation_id', () => {
    const { ctx, overlay, sent } = makeCtx()
    showInputDialog(ctx, { type: 'msgwin-get-line' })
    type(overlay.querySelector<HTMLInputElement>('.input-dialog-field')!, 'x')
    expect(sent).toEqual([])
  })

  it('submits Enter and Escape as raw keycodes', () => {
    const { ctx, overlay, sent } = makeCtx()
    showInputDialog(ctx, MSG)
    const input = overlay.querySelector<HTMLInputElement>('.input-dialog-field')!
    key(input, 'Enter')
    key(input, 'Escape')
    expect(sent).toEqual([
      { msg: 'key', keycode: 13 },
      { msg: 'key', keycode: 27 },
    ])
  })
})

describe('showSeedSelection', () => {
  const MSG: UiPushMsg = {
    type: 'seed-selection',
    generation_id: 3,
    title: 'Play a game with a custom seed.',
    body: 'Choose 0 for a random seed.',
    footer: 'The seed will determine the dungeon layout.',
    show_pregen_toggle: true,
  }

  it('renders title/body/footer and the pregen checkbox when toggled on', () => {
    const { ctx, overlay } = makeCtx()
    showSeedSelection(ctx, MSG)
    expect(overlay.querySelector('.seed-header')?.textContent).toContain('custom seed')
    expect(overlay.querySelector('.seed-footer')?.textContent).toContain('dungeon layout')
    expect(overlay.querySelector('.seed-pregen-checkbox')).toBeTruthy()
  })

  it('omits the pregen checkbox for dgamelaunch builds (show_pregen_toggle off)', () => {
    const { ctx, overlay } = makeCtx()
    showSeedSelection(ctx, { ...MSG, show_pregen_toggle: false })
    expect(overlay.querySelector('.seed-pregen-checkbox')).toBeNull()
  })

  it('syncs digit edits and reverts non-digit input to the last valid value', () => {
    const { ctx, overlay, sent } = makeCtx()
    showSeedSelection(ctx, MSG)
    const input = overlay.querySelector<HTMLInputElement>('.seed-input-field')!
    type(input, '42')
    expect(sent).toEqual([
      { msg: 'ui_state_sync', widget_id: 'seed', text: '42', cursor: 2, generation_id: 3 },
    ])
    type(input, '42a')
    expect(input.value).toBe('42')   // reverted, mirroring _keyfun_seed_input
    expect(sent).toHaveLength(1)     // and the bad edit was never echoed
  })

  it('sends the pregen checkbox state as ui_state_sync', () => {
    const { ctx, overlay, sent } = makeCtx()
    showSeedSelection(ctx, MSG)
    const cb = overlay.querySelector<HTMLInputElement>('.seed-pregen-checkbox')!
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    expect(sent).toEqual([
      { msg: 'ui_state_sync', widget_id: 'pregenerate', checked: true, generation_id: 3 },
    ])
  })

  it('maps Begin/Clear/Daily buttons to their server hotkeys', () => {
    const { ctx, overlay, sent } = makeCtx()
    showSeedSelection(ctx, MSG)
    const labels = new Map(
      [...overlay.querySelectorAll<HTMLButtonElement>('.seed-btn')]
        .map(b => [b.textContent?.trim() ?? '', b]),
    )
    labels.get('[Enter] Begin!')!.click()
    labels.get('[-] Clear')!.click()
    labels.get('[d] Daily')!.click()
    expect(sent).toEqual([
      { msg: 'key', keycode: 13 },
      { msg: 'key', keycode: 45 },
      { msg: 'key', keycode: 100 },
    ])
  })
})

describe('showRandomCombo', () => {
  it('renders through renderOverlay with the DCSS markup stripped from the title', () => {
    const { ctx, calls } = makeCtx()
    showRandomCombo(ctx, { type: 'newgame-random-combo', prompt: '<yellow>You are a Vine Stalker Hedge Wizard.</yellow>' })
    expect(calls.renderOverlay).toEqual(['You are a Vine Stalker Hedge Wizard.'])
  })

  it('offers Yes/Reroll/Quit and sends the picked key as pty input', () => {
    const { ctx, overlay, sent, calls } = makeCtx()
    showRandomCombo(ctx, { type: 'newgame-random-combo', prompt: 'combo' })
    const btns = [...overlay.querySelectorAll<HTMLButtonElement>('.action-btn')]
    expect(btns.map(b => b.textContent)).toEqual(['Yes (Y)', 'Reroll (n)', 'Quit (q)'])
    btns[2].click()
    expect(sent).toEqual([{ msg: 'input', text: 'q' }])
    expect(calls.focusView).toBe(1)
  })
})

describe('showNewgameChoice', () => {
  // Trimmed-down species screen: 3 columns with headers, a gap in the grid
  // (no button at x:1), and a brown sub-item row with a non-printable hotkey
  // (Tab=9). Field shapes per the live captures documented in CLAUDE.md.
  const MSG: UiPushMsg = {
    type: 'newgame-choice',
    title: 'Please select your species.',
    'main-items': {
      width: 3,
      labels: [
        { x: 0, y: 0, label: '<lightblue>Simple</lightblue>' },
        { x: 2, y: 0, label: '<lightblue>Advanced</lightblue>' },
      ],
      buttons: [
        { x: 0, y: 1, hotkey: 97, labels: ['<w>a</w> - Gnoll'], description: 'Gnolls have a nose for treasure.' },
        { x: 2, y: 1, hotkey: 115, labels: ['<w>s</w> - Coglin'], description: 'Coglins wield two weapons.' },
      ],
    },
    'sub-items': {
      width: 2,
      buttons: [
        { x: 0, y: 0, hotkey: 9, label: '<brown>Tab - Recommended character</brown>' },
      ],
    },
  }

  it('hides the touch controls and builds headers, grid cells, and gap padding', () => {
    const { ctx, overlay, calls } = makeCtx()
    showNewgameChoice(ctx, MSG)
    expect(calls.enterLayout).toEqual([{ touch: false }])
    const grid = overlay.querySelector<HTMLElement>('.ngc-grid:not(.ngc-sub-grid)')!
    expect(grid.style.getPropertyValue('--ngc-cols')).toBe('3')
    const headers = [...grid.querySelectorAll('.ngc-col-header')].map(h => h.textContent)
    expect(headers).toEqual(['Simple', '', 'Advanced'])
    // Row 1 renders [button, filler, button]: the x:1 gap must be padded so
    // the CSS grid keeps later buttons in their server-assigned columns.
    const cells = [...grid.children].slice(3)
    expect(cells.map(c => c.tagName)).toEqual(['BUTTON', 'DIV', 'BUTTON'])
  })

  it('two-tap confirm: first tap previews without sending, second tap sends the hotkey', () => {
    const { ctx, overlay, sent } = makeCtx()
    showNewgameChoice(ctx, MSG)
    const gnoll = [...overlay.querySelectorAll<HTMLButtonElement>('.ngc-btn')]
      .find(b => b.textContent?.includes('Gnoll'))!
    gnoll.click()
    expect(sent).toEqual([])  // preview only
    expect(gnoll.classList.contains('ngc-selected')).toBe(true)
    const desc = overlay.querySelector('.ngc-desc')!
    expect(desc.textContent).toContain('Gnolls have a nose for treasure.')
    expect(desc.textContent).toContain('Tap again to confirm.')
    gnoll.click()
    expect(sent).toEqual([{ msg: 'input', text: 'a' }])
  })

  it('tapping a different button re-arms the preview instead of confirming', () => {
    const { ctx, overlay, sent } = makeCtx()
    showNewgameChoice(ctx, MSG)
    const btns = [...overlay.querySelectorAll<HTMLButtonElement>('.ngc-btn')]
    const gnoll = btns.find(b => b.textContent?.includes('Gnoll'))!
    const coglin = btns.find(b => b.textContent?.includes('Coglin'))!
    gnoll.click()
    coglin.click()  // switches the pending selection, still no send
    expect(sent).toEqual([])
    expect(gnoll.classList.contains('ngc-selected')).toBe(false)
    expect(coglin.classList.contains('ngc-selected')).toBe(true)
    coglin.click()
    expect(sent).toEqual([{ msg: 'input', text: 's' }])
  })

  it('sends non-printable hotkeys (Tab=9) via {key,keycode}, not {input,text}', () => {
    const { ctx, overlay, sent } = makeCtx()
    showNewgameChoice(ctx, MSG)
    const tab = overlay.querySelector<HTMLButtonElement>('.ngc-sub-grid .ngc-btn')!
    tab.click()
    tab.click()
    expect(sent).toEqual([{ msg: 'key', keycode: 9 }])
  })

  it('renders weapon-menu two-part labels as main + right-aligned suffix spans', () => {
    const { ctx, overlay } = makeCtx()
    showNewgameChoice(ctx, {
      type: 'newgame-choice',
      'main-items': {
        width: 1,
        buttons: [{ x: 0, y: 1, hotkey: 97, labels: ['<w>a</w> - war axe', '(+2 apt)'] }],
      },
    })
    const btn = overlay.querySelector('.ngc-btn')!
    expect(btn.querySelector('.ngc-btn-main')?.textContent).toBe('a - war axe')
    expect(btn.querySelector('.ngc-btn-suffix')?.textContent).toBe('(+2 apt)')
  })
})
