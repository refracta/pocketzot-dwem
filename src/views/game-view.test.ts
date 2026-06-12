// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildGameView, type SpectateTarget } from './game-view'
import { ENABLE_SPELL_TAB } from '../game/input/touch'
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

  it('update_menu_items patches the chunk in place, leaving items outside it intact', () => {
    const h = setup()
    h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inventory' }, items: [
      { level: 2, text: 'a - a +0 short sword', hotkeys: [97] },
      { level: 2, text: 'b - a buckler', hotkeys: [98] },
    ] })
    // Server refresh of item index 1 only (e.g. a selection mark / quantity
    // change) — the splice must replace exactly that chunk and re-render.
    h.dispatch({ msg: 'update_menu_items', chunk_start: 1, items: [
      { level: 2, text: 'b - a buckler (worn)', hotkeys: [98] },
    ] })
    expect(isHidden(overlay(h))).toBe(false)
    expect(overlay(h).textContent).toContain('a +0 short sword')   // untouched
    expect(overlay(h).textContent).toContain('a buckler (worn)')   // patched
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

// Silent spell harvest: fire `I`, capture the default columns, then Escape —
// all without rendering the menu. Driven via the dev hooks
// (window.__dcssHarvestSpells / __dcssSpellCache, present because vitest runs
// with import.meta.env.DEV — cf. __dcssStore above).
// These lock in the regressions from review:
//   1. the preselected (last-cast) row's " a + " preface must be stripped, or
//      its title and every column shift (parseSpellItem);
//   2. the close-swallow latch must not leak past the harvest and eat a later
//      real menu's close_menu, and a teardown mid-harvest must reset cleanly.
describe('spell harvest (silent I → Esc) + preface parsing', () => {
  type CachedSpell = {
    letter: string; title: string; schools?: string; fail?: string; level?: number
  }
  const hooks = () => window as unknown as { __dcssHarvestSpells: () => void; __dcssSpellCache: CachedSpell[] }
  const cache = () => hooks().__dcssSpellCache
  const byLetter = (l: string) => cache().find(s => s.letter === l)!

  // Default-column row, fixed-width like the engine's _spell_base_description:
  // name padded to 32 chars, schools padded out to column 58, then the
  // fail/level tail. The parser slices by position and whitespace-splits only
  // that tail (see parseSpellItem) — keep the padEnd widths, not the spacing.
  // `sign` is '-' for a normal row but '+' for the preselected
  // you.last_cast_spell row (SpellMenuEntry::_get_text_preface in the engine).
  const baseRow = (sign: '-' | '+', letter: string, hot: number, name: string, schools: string, fail: string, level: number) =>
    ({ level: 2, hotkeys: [hot], tiles: [{ t: 1, tex: 0 }],
       text: ` ${letter} ${sign} <lightgrey>${name.padEnd(32)}${schools.padEnd(26)}${fail}       ${level}      </lightgrey>` })
  // 'a' Freeze is the preselected '+' row — the case that regressed; 'c'
  // Ozocubu's Armour is a normal '-' row (control).
  const BASE = [
    baseRow('+', 'a', 97, 'Freeze', 'Ice', '1%', 1),
    baseRow('-', 'c', 99, "Ozocubu's Armour", 'Ice', '4%', 3),
  ]
  const startHarvest = () => hooks().__dcssHarvestSpells()
  const feedBase = (h: Harness) => h.dispatch({ msg: 'menu', tag: 'spell', items: BASE })
  const fullHarvest = (h: Harness) => { startHarvest(); feedBase(h) }
  const sentInputI = (h: Harness) => sent(h).filter(m => m.msg === 'input' && (m as { text?: string }).text === 'I')

  it('drives exactly the silent I → Esc sequence and never shows an overlay', () => {
    const h = setup()
    fullHarvest(h)
    expect(sent(h)).toEqual([
      { msg: 'input', text: 'I' },
      { msg: 'key', keycode: 27 },
    ])
    expect(isHidden(overlay(h))).toBe(true)
  })

  it('strips the "+" preface on the preselected row so title and columns are not shifted', () => {
    const h = setup()
    startHarvest()
    feedBase(h)
    // Regression: ' a + ' left in place → title "a + Freeze" + shifted columns.
    const a = byLetter('a')
    expect(a.title).toBe('Freeze')
    expect(a.title).not.toContain('+')
    expect(a).toMatchObject({ schools: 'Ice', fail: '1%', level: 1 })
    // The normal '-' row parses fine (control).
    expect(byLetter('c')).toMatchObject({ title: "Ozocubu's Armour", schools: 'Ice', fail: '4%', level: 3 })
  })

  it('parses a 25-char schools string (single pad space before the failure column)', () => {
    const h = setup()
    startHarvest()
    // "Conjuration/Translocation" is 25 chars — the longest player-spell
    // schools string in 0.34 (Momentum Strike, Iskenderun's Mystic Blast).
    // The engine pads name+schools to column 58, leaving exactly ONE space
    // before the failure column; a whitespace-run split merges schools+fail
    // and shifts level into fail. Fixed-position slicing must not.
    h.dispatch({ msg: 'menu', tag: 'spell', items: [
      baseRow('-', 'd', 100, 'Momentum Strike', 'Conjuration/Translocation', '5%', 2),
    ] })
    expect(byLetter('d')).toMatchObject({
      title: 'Momentum Strike', schools: 'Conjuration/Translocation', fail: '5%', level: 2,
    })
  })

  it('does NOT leak the close-swallow latch: a real menu opened after a harvest closes normally', () => {
    const h = setup()
    fullHarvest(h) // Escape sent, pendingHarvestClose latched
    // The finding's abnormal teardown: the harvest's own close_menu never comes.
    // A real menu then opens and is closed by the user.
    h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inv' }, items: [] })
    expect(isHidden(overlay(h))).toBe(false)
    h.dispatch({ msg: 'close_menu' })
    // Regression: a leaked latch swallows this close_menu, stranding the overlay.
    expect(isHidden(overlay(h))).toBe(true)
  })

  it('swallows only the harvest Escape close_menu, leaving a later real menu intact', () => {
    const h = setup()
    fullHarvest(h)
    h.dispatch({ msg: 'close_menu' }) // the harvest's own close — swallowed
    h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inv' }, items: [] })
    expect(isHidden(overlay(h))).toBe(false)
    h.dispatch({ msg: 'close_menu' })
    expect(isHidden(overlay(h))).toBe(true)
  })

  // Each full-state teardown must reset the harvest (clear phase + latch) so an
  // interrupted harvest can't strand input suppression or the close latch. We
  // observe the phase reset behaviorally: a fresh harvest only fires a new `I`
  // if the prior phase was cleared (harvestSpells() bails while non-idle).
  for (const { name, reset } of [
    { name: 'close_all_menus', reset: { msg: 'close_all_menus' } },
    { name: 'layer:game', reset: { msg: 'layer', layer: 'game' } },
    { name: 'go_lobby', reset: { msg: 'go_lobby' } },
  ]) {
    it(`${name} aborts an in-flight harvest so a new harvest can start`, () => {
      const h = setup()
      startHarvest()        // I #1; phase 'base'
      h.dispatch(reset)     // resetHarvest(): phase → idle (+ clears latch/timer)
      fullHarvest(h)        // I #2 only fires if phase was reset
      expect(sentInputI(h)).toHaveLength(2)
    })
  }

  // A spell-less character's `I` opens no menu — it prints the canned
  // "You don't know any spells." instead. The base phase must end on that line
  // (not sit suppressing input until the 1.5s fallback), and the artifact line
  // must be swallowed so the player never sees a message they didn't trigger.
  describe('no-spells terminator (non-caster)', () => {
    const NO_SPELLS = "You don't know any spells."

    it('ends the harvest immediately when the no-spells line arrives (no 1.5s lockout)', () => {
      const h = setup()
      startHarvest()  // I #1; phase 'base'
      h.dispatch({ msg: 'msgs', messages: [{ text: NO_SPELLS }] })
      // Phase must be idle now: a fresh harvest fires I #2 only if it was reset.
      // With the old code the phase stays 'base' until the timer.
      startHarvest()
      expect(sentInputI(h)).toHaveLength(2)
      h.dispatch({ msg: 'msgs', messages: [{ text: NO_SPELLS }] }) // settle harvest #2
    })

    it('swallows the no-spells artifact line so it never reaches the message log', () => {
      const h = setup()
      startHarvest()
      h.dispatch({ msg: 'msgs', messages: [{ text: NO_SPELLS }] })
      expect(msgTexts(h)).not.toContain(NO_SPELLS)
    })

    it('leaves the spell rail/z tab empty (no spells harvested)', () => {
      const h = setup()
      startHarvest()
      h.dispatch({ msg: 'msgs', messages: [{ text: NO_SPELLS }] })
      expect(cache()).toHaveLength(0)
      expect(isHidden(h.view.querySelector<HTMLElement>('#spell-rail')!)).toBe(true)
      expect(h.view.querySelector<HTMLElement>('.tc-tab[data-tab="spells"]')!.style.display).toBe('none')
    })

    it('does NOT swallow the no-spells line outside a harvest', () => {
      const h = setup()
      // Not harvesting → a literal "You don't know any spells." is a real game
      // message (e.g. the player pressed `z` with none) and must show.
      h.dispatch({ msg: 'msgs', messages: [{ text: NO_SPELLS }] })
      expect(msgTexts(h)).toContain(NO_SPELLS)
    })
  })

  // A base reply slower than the 1.5s input-suppression budget must not be
  // abandoned: the old behavior reset to idle, so the late tag:'spell' menu
  // rendered as an unrequested full-screen spell list AND the rail stayed
  // empty for the whole game (autoHarvestedThisGame already true — no retry).
  // Instead the harvest drops to 'late-base': suppression ends on schedule,
  // but the late menu is still captured silently for another 8.5s — gated on
  // the probe's own title ("Your spells (describe)"), since the user has the
  // channel back and could open a spell-tagged menu themselves.
  describe('slow-link harvest (late-base window)', () => {
    const PROBE_TITLE = { text: 'Your spells (describe)   Type                      Failure  Level' }
    afterEach(() => { vi.useRealTimers() })

    it('captures a base reply that lands after the suppression timeout, still silently', () => {
      vi.useFakeTimers()
      const h = setup()
      startHarvest()
      vi.advanceTimersByTime(1500) // suppression budget passes → late-base
      h.dispatch({ msg: 'menu', tag: 'spell', title: PROBE_TITLE, items: BASE })
      expect(isHidden(overlay(h))).toBe(true) // swallowed, not rendered
      expect(cache()).toHaveLength(2)
      // The harvest closed its menu normally (Escape sent, never rendered).
      expect(sent(h)).toContainEqual({ msg: 'key', keycode: 27 })
    })

    it('blocks new probe injection during the late window (server menu may be open)', () => {
      vi.useFakeTimers()
      const h = setup()
      startHarvest()
      vi.advanceTimersByTime(1500)
      startHarvest() // commandChannelIdle is false in late-base → must not fire
      expect(sentInputI(h)).toHaveLength(1)
    })

    it('renders a user-opened spell-tagged menu in the late window instead of eating it', () => {
      vi.useFakeTimers()
      const h = setup()
      startHarvest()
      vi.advanceTimersByTime(1500)
      // Suppression is lifted, so the user could have opened this themselves
      // (memorise / amnesia / adjust share tag:'spell'). Title is not the
      // probe's → it must render, and the stale harvest must abort.
      h.dispatch({ msg: 'menu', tag: 'spell', title: { text: 'Memorise which spell?' }, items: [] })
      expect(isHidden(overlay(h))).toBe(false)
      h.dispatch({ msg: 'close_menu' })
      startHarvest() // aborted harvest left phase idle → a fresh probe fires
      expect(sentInputI(h)).toHaveLength(2)
    })

    it('gives up (cache cleared, idle) only after the late window also expires', () => {
      vi.useFakeTimers()
      const h = setup()
      fullHarvest(h) // populate, then dirty re-harvest whose reply never comes
      startHarvest()
      vi.advanceTimersByTime(1500)
      expect(cache()).toHaveLength(2) // late window: cache kept, still waiting
      vi.advanceTimersByTime(8500)
      expect(cache()).toHaveLength(0) // truly dropped → cleared
      startHarvest() // and the phase is idle again → a fresh probe fires
      expect(sentInputI(h)).toHaveLength(3)
    })

    it('still terminates on the no-spells line during the late window', () => {
      vi.useFakeTimers()
      const h = setup()
      startHarvest()
      vi.advanceTimersByTime(1500)
      h.dispatch({ msg: 'msgs', messages: [{ text: "You don't know any spells." }] })
      startHarvest() // terminator reset the phase → a fresh probe fires
      expect(sentInputI(h)).toHaveLength(2)
    })
  })

  // The rail is a grid row below the message log; while it's visible the
  // `spell-row` class on #game-view floats the log over the map's bottom edge
  // (style.css) so the rail's row reuses the log's old slot instead of
  // shrinking the map. The class must track rail visibility exactly.
  describe('spell-row layout mode (rail row + log-over-map)', () => {
    const rail = (h: Harness) => h.view.querySelector<HTMLElement>('#spell-rail')!
    const inSpellRow = (h: Harness) => h.view.classList.contains('spell-row')

    it('engages when a harvest finds spells, not before', () => {
      const h = setup()
      expect(inSpellRow(h)).toBe(false)
      fullHarvest(h)
      expect(isHidden(rail(h))).toBe(false)
      expect(inSpellRow(h)).toBe(true)
    })

    it('disengages (rail + log overlay) for X-mode and restores on exit', () => {
      const h = setup()
      fullHarvest(h)
      h.dispatch({ msg: 'cursor', id: 2, loc: { x: 5, y: 5 } })
      expect(isHidden(rail(h))).toBe(true)
      expect(inSpellRow(h)).toBe(false)
      h.dispatch({ msg: 'cursor', id: 2 }) // loc absent → leave X-mode
      expect(isHidden(rail(h))).toBe(false)
      expect(inSpellRow(h)).toBe(true)
    })

    it('never engages for a non-caster (no-spells harvest)', () => {
      const h = setup()
      startHarvest()
      h.dispatch({ msg: 'msgs', messages: [{ text: "You don't know any spells." }] })
      expect(inSpellRow(h)).toBe(false)
    })
  })

  // A message can race into the brief harvest window that isn't part of our own
  // `I` round-trip. The harvest looks like normal play (activeMenu stays null),
  // so it must hand the channel back rather than mistake a foreign message for
  // its own data — which would freeze input (phase stuck).
  describe('foreign messages racing in mid-harvest', () => {
    it('aborts the harvest when a non-spell menu races in, instead of freezing input', () => {
      const h = setup()
      startHarvest()  // I #1; phase 'base'
      // A non-spell menu arrives before the spell-menu reply. It can't be ours
      // (our base menu is captured + swallowed), so the harvest must abort and
      // let it render. Bug: harvestPhase stays 'base', isHarvesting() stays true,
      // and every input handler early-returns until the 1.5s fallback fires.
      h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inv' }, items: [] })
      expect(isHidden(overlay(h))).toBe(false)  // the real menu renders
      h.dispatch({ msg: 'close_menu' })
      // Phase must be idle now: a fresh harvest fires I #2 only if it was reset
      // (harvestSpells bails while non-idle). With the bug it's still 'base'.
      startHarvest()
      expect(sentInputI(h)).toHaveLength(2)
      feedBase(h)  // settle the new harvest
    })
  })

  // Keep the rail in sync with the letter→spell map: it casts `z<letter>`
  // blindly, so a stale letter would fire the WRONG spell. A re-harvest fires
  // via the spellsDirty path whenever the map changes: any GAIN (engine emits
  // "Spell assigned to '<letter>'." — book memorise, Djinni/level-up gift, etc.),
  // any LOSS ("Your memory of X unravels."), or a `=` reassign. The triggers are
  // precise — routine play (casting, plain viewing, combat log) must NOT poll.
  describe('re-harvest on a letter-map change', () => {
    // The trailing feedBase(h) in each test settles the re-harvest it
    // triggered (the menu capture clears the 1.5s fallback timer).

    it('re-harvests when a spell is memorised (joined "finish memorising. Spell assigned to" line)', () => {
      const h = setup()
      fullHarvest(h)
      expect(sentInputI(h)).toHaveLength(1)
      // The REAL wire form: DCSS joins the two same-turn mprs ("You finish
      // memorising." + "Spell assigned to 'b'.") onto one line, so the match
      // must be a substring — an anchored `$` (the original bug) misses this.
      // Memorise completes inside command mode (no input_mode transition fires),
      // so the msgs handler itself must fire the refresh.
      h.dispatch({ msg: 'msgs', messages: [{ text: "You finish memorising. Spell assigned to 'b'." }] })
      expect(sentInputI(h)).toHaveLength(2)
      feedBase(h)
    })

    it('re-harvests on a level-up / Djinni spell gift (no "memorising" — only "Spell assigned to")', () => {
      const h = setup()
      fullHarvest(h)
      expect(sentInputI(h)).toHaveLength(1)
      // Djinni and other auto-gain paths skip the book-memorise flavour entirely;
      // the only shared signal is add_spell_to_memory's "Spell assigned to '<l>'."
      // (joined onto the gift's "…wells up from within." mpr). The old
      // "You finish memorising" trigger missed this, stranding the rail stale.
      h.dispatch({ msg: 'msgs', messages: [{ text: "The power to cast Call Canine Familiar wells up from within. Spell assigned to 'g'." }] })
      expect(sentInputI(h)).toHaveLength(2)
      feedBase(h)
    })

    it('re-harvests when a spell is lost ("Your memory of X unravels.")', () => {
      const h = setup()
      fullHarvest(h)
      h.dispatch({ msg: 'msgs', messages: [{ text: 'Your memory of Freeze unravels.' }] })
      expect(sentInputI(h)).toHaveLength(2)
      feedBase(h)
    })

    it('does NOT re-harvest on unrelated messages (no needless polling)', () => {
      const h = setup()
      fullHarvest(h)
      h.dispatch({ msg: 'msgs', messages: [{ text: 'You hit the rat.' }, { text: 'The rat dies.' }] })
      expect(sentInputI(h)).toHaveLength(1)
    })

    it('re-harvests after a `=` letter reassign, once back at the command prompt', () => {
      const h = setup()
      // Spend the once-per-game auto-harvest first, so the resolving input_mode→1
      // can't be mistaken for it.
      h.dispatch({ msg: 'input_mode', mode: 1 })
      feedBase(h)
      expect(sentInputI(h)).toHaveLength(1)
      // `=` opens the spell list titled "(adjust)" — all spell lists share
      // tag:"spell", so the title is the discriminator. Flags dirty but does not
      // harvest while the menu is up (the guard bails on the active menu).
      h.dispatch({ msg: 'menu', tag: 'spell', title: { text: 'Your spells (adjust)' }, items: BASE })
      expect(sentInputI(h)).toHaveLength(1)
      // Reassign done → menu closes → command mode resumes → re-harvest fires.
      h.dispatch({ msg: 'close_menu' })
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(sentInputI(h)).toHaveLength(2)
      feedBase(h)
    })

    it('does NOT re-harvest when the player merely views the spell list (I/describe)', () => {
      const h = setup()
      h.dispatch({ msg: 'input_mode', mode: 1 })
      feedBase(h)
      expect(sentInputI(h)).toHaveLength(1)
      // Same tag, but a "(describe)" title — viewing changes no letters.
      h.dispatch({ msg: 'menu', tag: 'spell', title: { text: 'Your spells (describe)' }, items: BASE })
      h.dispatch({ msg: 'close_menu' })
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(sentInputI(h)).toHaveLength(1)
    })
  })

  // The z tab hosts a quick-cast grid in the touch panel (no map coverage).
  // game-view supplies the grid DOM via the spellTab.render callback; touch.ts
  // hosts it and re-renders on refreshSpellTab() after each (re)harvest.
  describe('z spell tab (touch-panel quick-cast grid)', () => {
    const spellTab = (h: Harness) => h.view.querySelector<HTMLElement>('.tc-tab[data-tab="spells"]')
    const gridBtns = (h: Harness) => [...h.view.querySelectorAll<HTMLElement>('.tc-spell-grid .tc-spell-btn')]
    // Grid labels read "za"/"zb" (the literal cast keystroke), so match on that.
    const gridBtn = (h: Harness, letter: string) =>
      gridBtns(h).find(b => b.querySelector('.spell-letter')?.textContent === `z${letter}`)!

    it('renders one grid button (tile + letter) per harvested spell when the z tab is tapped', () => {
      const h = setup()
      fullHarvest(h)
      spellTab(h)!.click()
      expect(gridBtns(h)).toHaveLength(BASE.length)
      expect(gridBtn(h, 'a').querySelector('.tile-stack')).toBeTruthy()
    })

    it('casts the tapped spell (z + letter, one atomic input message) from the grid', () => {
      const h = setup()
      h.dispatch({ msg: 'input_mode', mode: 1 }) // command mode (+ the once-per-game auto-harvest)
      feedBase(h)                                 // complete that harvest → cache populated, idle
      spellTab(h)!.click()
      gridBtn(h, 'a').click()
      // Single message: the server pty-writes a message's text in one write,
      // so the engine gets both keys together and never blocks between them.
      expect(sent(h)).toContainEqual({ msg: 'input', text: 'za' })
    })

    it('updates an open grid in place when a re-harvest changes the spell list', () => {
      const h = setup()
      fullHarvest(h)
      spellTab(h)!.click()
      expect(gridBtns(h)).toHaveLength(2)
      // A re-harvest yields a 3rd spell; the visible grid reflects it (via
      // refreshSpellTab) without the player re-tapping the tab.
      startHarvest()
      h.dispatch({ msg: 'menu', tag: 'spell', items: [...BASE, baseRow('-', 'd', 100, 'Magic Dart', 'Conj', '3%', 1)] })
      expect(gridBtns(h)).toHaveLength(3)
    })

    it('omits the z tab while spectating (no spells to cast)', () => {
      const h = setup({ username: 'bob' })
      expect(spellTab(h)).toBeNull()
    })

    it('keeps the z tab hidden until a harvest finds spells, then reveals it (if enabled)', () => {
      const h = setup()
      expect(spellTab(h)!.style.display).toBe('none') // no spells yet → hidden
      fullHarvest(h)
      // Reveal is additionally gated on the ENABLE_SPELL_TAB experiment flag:
      // with the tab toggled off it stays hidden even once spells exist.
      if (ENABLE_SPELL_TAB) expect(spellTab(h)!.style.display).not.toBe('none')
      else expect(spellTab(h)!.style.display).toBe('none')
    })

    it('hides the z tab again (and falls back to @) when a re-harvest finds no spells', () => {
      const h = setup()
      fullHarvest(h)
      spellTab(h)!.click()
      expect(spellTab(h)!.classList.contains('active')).toBe(true)
      // Re-harvest returns an empty spell menu (forgot the last spell).
      startHarvest()
      h.dispatch({ msg: 'menu', tag: 'spell', items: [] })
      expect(spellTab(h)!.style.display).toBe('none')
      expect(h.view.querySelector<HTMLElement>('.tc-tab[data-tab="micro"]')!.classList.contains('active')).toBe(true)
    })
  })

  // A quick double-tap's second cast lands inside the first cast's round-trip:
  // the engine answers the `z` by flushing input_mode:PROMPT (7) + the
  // channel-2 "Cast which spell?" line BEFORE the buffered letter resolves the
  // cast, and the tap guard used to drop the second tap silently in that
  // window (keyboard `zaza` queues server-side and casts twice). The fix
  // queues one tap and fires it on the input_mode→1 that ends the round-trip.
  describe('double-tap quick-cast (pending cast queue)', () => {
    afterEach(() => { vi.useRealTimers() })
    const railBtn = (h: Harness, letter: string) =>
      [...h.view.querySelectorAll<HTMLElement>('#spell-rail .spell-rail-btn')]
        .find(b => b.querySelector('.spell-letter')?.textContent === `z${letter}`)!
    const castsSent = (h: Harness) =>
      sent(h).filter(m => m.msg === 'input' && (m as { text?: string }).text === 'za').length
    // Enter command mode and settle the auto-harvest it kicks off, so the
    // rail is populated and the command channel is idle.
    const ready = (h: Harness) => { h.dispatch({ msg: 'input_mode', mode: 1 }); feedBase(h) }
    // The server's reply to our `z`, as flushed before the cast resolves.
    const castPromptArrives = (h: Harness) => {
      h.dispatch({ msg: 'input_mode', mode: 7 })
      h.dispatch({ msg: 'msgs', messages: [{ text: 'Cast which spell? (? or * to list) ', channel: 2 }] })
    }

    // Synthetic touch event with a contact point (happy-dom has no TouchEvent
    // constructor; the handlers only read touches[0].clientX/Y).
    const touch = (el: HTMLElement, type: string, x = 0, y = 0) => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(e, { touches: [{ clientX: x, clientY: y }] })
      el.dispatchEvent(e)
    }

    it('casts on a completed touch tap (touchend without drift)', () => {
      const h = setup()
      ready(h)
      touch(railBtn(h, 'a'), 'touchstart')
      expect(castsSent(h)).toBe(0) // not on contact — a drag may be starting
      touch(railBtn(h, 'a'), 'touchend')
      expect(castsSent(h)).toBe(1)
    })

    it('does NOT cast when the finger drags off the button (drift past slop)', () => {
      const h = setup()
      ready(h)
      const b = railBtn(h, 'a')
      touch(b, 'touchstart', 0, 0)
      touch(b, 'touchmove', 0, 40) // scroll-sized drift
      touch(b, 'touchend')
      expect(castsSent(h)).toBe(0)
    })

    it('ignores the synthetic click iOS fires at the lift point of a drag from the log', () => {
      const h = setup()
      ready(h)
      // Drag starts on the message log (touch events keep targeting it), but
      // WebKit hit-tests its compatibility click at the lift point — the rail
      // button. The click gate must reject it; a later real mouse click (no
      // recent touch) still casts, which the .click()-based tests above cover.
      touch(msgLog(h), 'touchstart')
      touch(msgLog(h), 'touchend')
      railBtn(h, 'a').click()
      expect(castsSent(h)).toBe(0)
    })

    it('lets a self-identified mouse click through the gate despite recent touch activity', () => {
      const h = setup()
      ready(h)
      // Hybrid device: finger scrolls the log, then a real trackpad/mouse
      // click lands on the rail within the suppression window. Modern
      // engines mark the click's pointerType, which bypasses the gate.
      touch(msgLog(h), 'touchstart')
      touch(msgLog(h), 'touchend')
      const click = Object.assign(new Event('click', { bubbles: true }), { pointerType: 'mouse' })
      railBtn(h, 'a').dispatchEvent(click)
      expect(castsSent(h)).toBe(1)
    })

    it('queues the second tap of a double-tap and casts it on input_mode→1', () => {
      const h = setup()
      ready(h)
      railBtn(h, 'a').click() // tap 1 → z + a
      expect(castsSent(h)).toBe(1)
      castPromptArrives(h)    // mode 7 + prompt row: both tap-guard blockers
      railBtn(h, 'a').click() // tap 2, mid round-trip → queued, not dropped
      expect(castsSent(h)).toBe(1)
      h.dispatch({ msg: 'input_mode', mode: 1 }) // cast resolved
      expect(castsSent(h)).toBe(2)
      expect(sent(h).at(-1)).toEqual({ msg: 'input', text: 'za' })
    })

    it('does NOT queue a tap when the blocking prompt is not our own cast', () => {
      const h = setup()
      ready(h)
      h.dispatch({ msg: 'input_mode', mode: 7 }) // server-initiated prompt
      railBtn(h, 'a').click() // genuine stray — no recent cast of ours
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(castsSent(h)).toBe(0)
    })

    it('drops the queued tap if a menu claimed the screen before the channel reopened', () => {
      const h = setup()
      ready(h)
      railBtn(h, 'a').click()
      castPromptArrives(h)
      railBtn(h, 'a').click() // queued
      h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inv' }, items: [] })
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(castsSent(h)).toBe(1) // flush re-check saw the menu → dropped
      // And it stays dropped — a later clean mode-1 must not revive it.
      h.dispatch({ msg: 'close_menu' })
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(castsSent(h)).toBe(1)
    })

    it('expires a stale queued tap instead of firing a surprise late cast', () => {
      vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
      const h = setup()
      ready(h)
      railBtn(h, 'a').click()
      castPromptArrives(h)
      railBtn(h, 'a').click() // queued
      vi.advanceTimersByTime(1100) // slow link: > PENDING_CAST_TTL_MS passes
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(castsSent(h)).toBe(1)
    })
  })
})
