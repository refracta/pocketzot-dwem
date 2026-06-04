// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildGameView, type SpectateTarget } from './game-view'
import type { WsConnection } from '../ws/connection'
import type { ServerMsg, ClientMsg, GameExit } from '../ws/types'
import type { MapStore } from '../game/map/map-store'

// game-view.ts exports only buildGameView, so it's exercised end-to-end the way
// the app drives it: the view assigns conn.onMessage, and we feed it server
// frames via that handler (same approach as lobby.test.ts). These cover the
// message-dispatch state machine — message log, HUD reveal gating, the overlay /
// menu / CRT / dialog stack, and the lobby-transition forwarding — which is the
// bulk of what game-view owns. DOM rendering of individual HUD widgets lives in
// their own unit tests; here we assert game-view's wiring of them.
//
// Messages are cast through `unknown` to ServerMsg: many handlers read fields
// (channel, title, items, …) that the hand-maintained ServerMsg union in
// types.ts doesn't fully enumerate, and the handler casts them internally too.

interface Harness {
  view: HTMLElement
  send: ReturnType<typeof vi.fn>
  onLobby: ReturnType<typeof vi.fn>
  dispatch: (msg: unknown) => void
}

function setup(spectating?: SpectateTarget): Harness {
  const send = vi.fn()
  const conn = {
    wsUrl: 'wss://test.example/socket',
    httpBase: 'https://test.example',
    onMessage: (() => {}) as (msg: ServerMsg) => void,
    onClose: () => {},
    onOpen: () => {},
    send,
    close: vi.fn(),
  } as unknown as WsConnection
  const onLobby = vi.fn()
  const view = buildGameView(conn, onLobby, spectating)
  document.body.appendChild(view)
  return { view, send, onLobby, dispatch: (msg) => conn.onMessage(msg as ServerMsg) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

// --- small DOM helpers, scoped to the view under test ---
const hud = (h: Harness) => h.view.querySelector<HTMLElement>('#game-hud')!
const msgLog = (h: Harness) => h.view.querySelector<HTMLElement>('#game-messages')!
const overlay = (h: Harness) => h.view.querySelector<HTMLElement>('#ui-overlay')!
const moreBtn = (h: Harness) => h.view.querySelector<HTMLElement>('#more-btn')!
const isHidden = (el: HTMLElement) => el.style.display === 'none'
const sent = (h: Harness): ClientMsg[] => h.send.mock.calls.map(c => c[0] as ClientMsg)
const msgRows = (h: Harness) => [...msgLog(h).querySelectorAll<HTMLElement>('.game-msg')]
// msgLog is flex column-reverse, so the visual order (oldest→newest) is the
// reverse of DOM order — undo that here so assertions read naturally.
const msgTexts = (h: Harness) => msgRows(h).map(r => r.textContent?.trim()).reverse()

describe('message log (msgs)', () => {
  it('prepends rows so the newest sits at the visual bottom (DOM firstChild)', () => {
    const h = setup()
    h.dispatch({ msg: 'msgs', messages: [{ text: 'first' }, { text: 'second' }] })
    expect(msgTexts(h)).toEqual(['first', 'second'])
    // Newest appended is DOM firstChild (the column-reverse convention).
    expect(msgRows(h)[0].textContent?.trim()).toBe('second')
  })

  it('rollback removes the last N appended before appending the replacements', () => {
    const h = setup()
    h.dispatch({ msg: 'msgs', messages: [{ text: 'keep' }, { text: 'stale-a' }, { text: 'stale-b' }] })
    h.dispatch({ msg: 'msgs', rollback: 2, messages: [{ text: 'fresh' }] })
    expect(msgTexts(h)).toEqual(['keep', 'fresh'])
  })

  it('renders a channel-2 prompt with a tappable hotkey button that sends the key', () => {
    const h = setup()
    h.dispatch({ msg: 'msgs', messages: [{ text: 'Increase (S)trength?', channel: 2 }] })
    const promptRow = msgLog(h).querySelector<HTMLElement>('.game-prompt')
    expect(promptRow).toBeTruthy()
    const btn = promptRow!.querySelector<HTMLButtonElement>('.action-btn')
    expect(btn).toBeTruthy()
    btn!.click()
    expect(sent(h)).toContainEqual({ msg: 'input', text: 'S' })
  })

  it('shows the — more — button on more:true and the click sends Space (keycode 32)', () => {
    const h = setup()
    expect(isHidden(moreBtn(h))).toBe(true)
    h.dispatch({ msg: 'msgs', messages: [{ text: 'hi' }], more: true })
    expect(isHidden(moreBtn(h))).toBe(false)
    moreBtn(h).click()
    expect(sent(h)).toContainEqual({ msg: 'key', keycode: 32 })
  })

  it('hides the — more — button on more:false', () => {
    const h = setup()
    h.dispatch({ msg: 'msgs', messages: [{ text: 'hi' }], more: true })
    h.dispatch({ msg: 'msgs', messages: [], more: false })
    expect(isHidden(moreBtn(h))).toBe(true)
  })
})

describe('player message → HUD reveal gating', () => {
  it('keeps the HUD hidden until the first player message, then reveals it with stats', () => {
    const h = setup()
    expect(isHidden(hud(h))).toBe(true)
    h.dispatch({ msg: 'player', hp: 17, hp_max: 23 })
    expect(isHidden(hud(h))).toBe(false)
    expect(h.view.querySelector('#hud-hp')?.textContent).toContain('17/23')
  })

  it('does NOT reveal the HUD on a player message that arrives while an overlay covers the screen', () => {
    // Character-creation screens emit placeholder `player` frames behind the
    // newgame overlay; revealing then would flash empty bars (see handler).
    const h = setup()
    h.dispatch({ msg: 'ui-push', type: 'describe-item', title: 'x', body: 'y' })
    h.dispatch({ msg: 'player', hp: 1, hp_max: 1 })
    expect(isHidden(hud(h))).toBe(true)
    // Closing the overlay reveals it now that hudRevealed has latched on.
    h.dispatch({ msg: 'ui-pop' })
    expect(isHidden(hud(h))).toBe(false)
  })

  it('records the player position into the shared map store', () => {
    const h = setup()
    h.dispatch({ msg: 'player', pos: { x: 30, y: 40 } })
    const store = (window as unknown as { __dcssStore: MapStore }).__dcssStore
    expect(store.playerPos).toEqual({ x: 30, y: 40 })
  })
})

describe('map message → store merge', () => {
  it('merges delta cells into the store and clears on clear:true', () => {
    const h = setup()
    h.dispatch({ msg: 'map', cells: [{ x: 5, y: 6, g: '#', col: 7 }] })
    const store = (window as unknown as { __dcssStore: MapStore }).__dcssStore
    expect(store.get(5, 6)?.g).toBe('#')
    h.dispatch({ msg: 'map', clear: true, cells: [] })
    expect(store.get(5, 6)).toBeUndefined()
  })
})

describe('ui-push / ui-pop overlay stack', () => {
  it('renders a pushed overlay with title + body and shows the overlay', () => {
    const h = setup()
    h.dispatch({ msg: 'ui-push', type: 'describe-item', title: 'A +0 short sword', body: 'A fine blade.' })
    expect(isHidden(overlay(h))).toBe(false)
    expect(overlay(h).querySelector('.overlay-title span')?.textContent).toBe('A +0 short sword')
    expect(overlay(h).querySelector('.overlay-body')?.textContent).toContain('A fine blade.')
  })

  it('restores the previous push on pop, and hides the overlay when the stack empties', () => {
    const h = setup()
    h.dispatch({ msg: 'ui-push', type: 'describe-item', title: 'OUTER', body: 'outer body' })
    h.dispatch({ msg: 'ui-push', type: 'describe-item', title: 'INNER', body: 'inner body' })
    expect(overlay(h).querySelector('.overlay-title span')?.textContent).toBe('INNER')
    h.dispatch({ msg: 'ui-pop' })
    expect(overlay(h).querySelector('.overlay-title span')?.textContent).toBe('OUTER')
    h.dispatch({ msg: 'ui-pop' })
    expect(isHidden(overlay(h))).toBe(true)
  })

  it('close_all_menus tears down the whole overlay stack', () => {
    const h = setup()
    h.dispatch({ msg: 'ui-push', type: 'describe-item', title: 'A', body: 'a' })
    h.dispatch({ msg: 'close_all_menus' })
    expect(isHidden(overlay(h))).toBe(true)
  })

  it('ui-stack re-dispatches each nested item back through the handler (spectator join)', () => {
    const h = setup()
    h.dispatch({ msg: 'ui-stack', items: [{ msg: 'ui-push', type: 'describe-item', title: 'SNAP', body: 'b' }] })
    expect(isHidden(overlay(h))).toBe(false)
    expect(overlay(h).querySelector('.overlay-title span')?.textContent).toBe('SNAP')
  })
})

describe('menu handler', () => {
  it('renders a regular menu as a list; tapping an item sends its hotkey', () => {
    const h = setup()
    h.dispatch({
      msg: 'menu',
      tag: 'inventory',
      title: { text: 'Inventory' },
      items: [{ level: 2, text: 'a - a +0 short sword', hotkeys: [97] }],
    })
    expect(isHidden(overlay(h))).toBe(false)
    expect(overlay(h).querySelector('.overlay-title span')?.textContent).toBe('Inventory')
    const item = overlay(h).querySelector<HTMLButtonElement>('.overlay-list .overlay-item')
    expect(item?.textContent).toContain('a - a +0 short sword')
    item!.click()
    expect(sent(h)).toContainEqual({ msg: 'key', keycode: 97 })
  })

  it('renders a type:crt menu as a CRT display and paints txt lines into it', () => {
    const h = setup()
    h.dispatch({ msg: 'menu', type: 'crt' })
    expect(isHidden(overlay(h))).toBe(false)
    expect(overlay(h).querySelector('#crt-display')).toBeTruthy()
    h.dispatch({ msg: 'txt', id: 1, lines: { '0': 'Skill screen' } })
    expect(overlay(h).querySelector('.crt-line')?.textContent).toBe('Skill screen')
  })

  it('close_menu pops the menu stack and hides the overlay when empty', () => {
    const h = setup()
    h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inventory' }, items: [] })
    expect(isHidden(overlay(h))).toBe(false)
    h.dispatch({ msg: 'close_menu' })
    expect(isHidden(overlay(h))).toBe(true)
  })
})

describe('show_dialog / hide_dialog', () => {
  it('renders the server HTML and wires [data-key] buttons to send that key', () => {
    const h = setup()
    h.dispatch({ msg: 'show_dialog', html: 'Transfer save? <button data-key="N">No</button><button data-key="T">Transfer</button>' })
    expect(isHidden(overlay(h))).toBe(false)
    const dialog = overlay(h).querySelector('.dialog-body')
    expect(dialog).toBeTruthy()
    const transfer = overlay(h).querySelector<HTMLButtonElement>('[data-key="T"]')
    transfer!.click()
    expect(sent(h)).toContainEqual({ msg: 'input', text: 'T' })
  })

  it('hide_dialog dismisses the dialog overlay', () => {
    const h = setup()
    h.dispatch({ msg: 'show_dialog', html: '<button data-key="T">T</button>' })
    h.dispatch({ msg: 'hide_dialog' })
    expect(isHidden(overlay(h))).toBe(true)
  })

  it('layer:game resets overlay/dialog state and hides the overlay', () => {
    const h = setup()
    h.dispatch({ msg: 'ui-push', type: 'describe-item', title: 'A', body: 'a' })
    h.dispatch({ msg: 'layer', layer: 'game' })
    expect(isHidden(overlay(h))).toBe(true)
  })
})

describe('X-mode (eXamine level map) via cursor', () => {
  it('enters X-mode on an id:2 cursor (hiding the message log) and exits when the cursor clears', () => {
    const h = setup()
    expect(isHidden(msgLog(h))).toBe(false)
    h.dispatch({ msg: 'cursor', id: 2, loc: { x: 5, y: 5 } })
    expect(isHidden(msgLog(h))).toBe(true)
    h.dispatch({ msg: 'cursor', id: 2 }) // loc absent → leave X-mode
    expect(isHidden(msgLog(h))).toBe(false)
  })
})

describe('input_mode COMMAND transition', () => {
  it('hides the more button on the return to normal play (mode 1)', () => {
    const h = setup()
    h.dispatch({ msg: 'msgs', messages: [{ text: 'hi' }], more: true })
    expect(isHidden(moreBtn(h))).toBe(false)
    h.dispatch({ msg: 'input_mode', mode: 1 })
    expect(isHidden(moreBtn(h))).toBe(true)
  })

  it('marks the most-recent message row with a turn glyph on a player time tick', () => {
    const h = setup()
    h.dispatch({ msg: 'msgs', messages: [{ text: 'You hit the rat.' }] })
    h.dispatch({ msg: 'player', time: 10 })
    const mark = msgRows(h)[0].querySelector<HTMLElement>('.msg-turn-mark')
    expect(mark?.textContent).toBe('_')
    expect(mark?.classList.contains('turn')).toBe(true)
  })
})

describe('lobby transitions', () => {
  it('game_ended forwards the exit details to onLobby', () => {
    const h = setup()
    h.dispatch({ msg: 'game_ended', reason: 'dead', message: 'Slain by a rat.', dump: 'http://x/morgue' })
    expect(h.onLobby).toHaveBeenCalledTimes(1)
    const exit = h.onLobby.mock.calls[0][0] as GameExit
    expect(exit).toMatchObject({
      reason: 'dead',
      message: 'Slain by a rat.',
      dump: 'http://x/morgue',
      spectated: false,
    })
  })

  it('tags the exit as spectated when watching someone else', () => {
    const h = setup({ username: 'bob' })
    h.dispatch({ msg: 'game_ended', reason: 'dead' })
    const exit = h.onLobby.mock.calls[0][0] as GameExit
    expect(exit).toMatchObject({ spectated: true, spectatedName: 'bob' })
  })

  it('go_lobby and close both return to the lobby with no exit payload', () => {
    const a = setup()
    a.dispatch({ msg: 'go_lobby' })
    expect(a.onLobby).toHaveBeenCalledWith()

    const b = setup()
    b.dispatch({ msg: 'close' })
    expect(b.onLobby).toHaveBeenCalledWith()
  })
})
