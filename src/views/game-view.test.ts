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

// Silent spell harvest: fire `I`, capture the default columns, toggle with `!`
// to capture power/damage/range/noise, then Escape — all without rendering the
// menu. Driven via the dev hooks (window.__dcssHarvestSpells / __dcssSpellCache,
// present because vitest runs with import.meta.env.DEV — cf. __dcssStore above).
// These lock in the three regressions from review:
//   1. the preselected (last-cast) row's " a + " preface must be stripped, or
//      its title and every column shift (parseSpellItem);
//   2. same for the toggled extra columns' fixed-width slices (mergeSpellExtra);
//   3. the close-swallow latch must not leak past the harvest and eat a later
//      real menu's close_menu, and a teardown mid-harvest must reset cleanly.
describe('spell harvest (silent I → ! → Esc) + preface parsing', () => {
  type CachedSpell = {
    letter: string; title: string; schools?: string; fail?: string; level?: number
    power?: string; damage?: string; range_string?: string; noise?: string
  }
  const hooks = () => window as unknown as { __dcssHarvestSpells: () => void; __dcssSpellCache: CachedSpell[] }
  const cache = () => hooks().__dcssSpellCache
  const byLetter = (l: string) => cache().find(s => s.letter === l)!

  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
  // Default-column row. Columns are separated by 2+ spaces (the parser splits on
  // padding runs). `sign` is '-' for a normal row but '+' for the preselected
  // you.last_cast_spell row (SpellMenuEntry::_get_text_preface in the engine).
  const baseRow = (sign: '-' | '+', letter: string, hot: number, name: string, schools: string, fail: string, level: number) =>
    ({ level: 2, hotkeys: [hot], tiles: [{ t: 1, tex: 0 }],
       text: ` ${letter} ${sign} <lightgrey>${pad(name, 32)}${pad(schools, 26)}${fail}       ${level}      </lightgrey>` })
  // Toggled extra row — fixed-width chop_string columns (no 2-space guarantee):
  // name(32) power(10) damage(10) range(8) noise(14), after the preface.
  const extraRow = (sign: '-' | '+', letter: string, hot: number, name: string, power: string, damage: string, range: string, noise: string) =>
    ({ level: 2, hotkeys: [hot], tiles: [{ t: 1, tex: 0 }],
       text: ` ${letter} ${sign} <lightgrey>${pad(name, 32)}${pad(power, 10)}${pad(damage, 10)}${pad(range, 8)}${pad(noise, 14)}</lightgrey>` })

  // 'a' Freeze is the preselected '+' row — the case that regressed; 'c'
  // Ozocubu's Armour is a normal '-' row (a buff: N/A damage/range). The
  // preselected row carries a long, space-containing noise ("Almost silent",
  // 13 chars): a left-in ' a + ' preface shifts the fixed-width slices by 5, so
  // a near-full field gets truncated/garbled — which a short value would hide
  // (the trailing column padding + .trim() absorb a small shift). That makes
  // the extra-column slice genuinely sensitive to the preface bug.
  const BASE = [
    baseRow('+', 'a', 97, 'Freeze', 'Ice', '1%', 1),
    baseRow('-', 'c', 99, "Ozocubu's Armour", 'Ice', '4%', 3),
  ]
  const EXTRA = [
    extraRow('+', 'a', 97, 'Freeze', '88%', '1d9', '1', 'Almost silent'),
    extraRow('-', 'c', 99, "Ozocubu's Armour", '22%', 'N/A', 'N/A', 'Quiet'),
  ]
  const startHarvest = () => hooks().__dcssHarvestSpells()
  const feedBase = (h: Harness) => h.dispatch({ msg: 'menu', tag: 'spell', items: BASE })
  const feedExtra = (h: Harness) => h.dispatch({ msg: 'update_menu_items', chunk_start: 0, items: EXTRA })
  const fullHarvest = (h: Harness) => { startHarvest(); feedBase(h); feedExtra(h) }
  const sentInputI = (h: Harness) => sent(h).filter(m => m.msg === 'input' && (m as { text?: string }).text === 'I')

  it('drives exactly the silent I → ! → Esc sequence and never shows an overlay', () => {
    const h = setup()
    fullHarvest(h)
    expect(sent(h)).toEqual([
      { msg: 'input', text: 'I' },
      { msg: 'input', text: '!' },
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
    feedExtra(h) // finish the harvest so the fallback timer is cleared
  })

  it('merges the toggled extra columns by fixed-width slice for the "+" preselected row too', () => {
    const h = setup()
    fullHarvest(h)
    // Regression: unstripped ' a + ' shifts every slice by 5; the 13-char noise
    // is truncated ("Almost si…") unless the preface is stripped first.
    expect(byLetter('a')).toMatchObject({ power: '88%', damage: '1d9', range_string: '1', noise: 'Almost silent' })
    expect(byLetter('c')).toMatchObject({ power: '22%', damage: 'N/A', range_string: 'N/A', noise: 'Quiet' })
  })

  it('keeps a space-containing noise value intact (fixed-width slice, not a whitespace split)', () => {
    const h = setup()
    fullHarvest(h)
    expect(byLetter('a').noise).toBe('Almost silent')
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

  // A message can race into the brief harvest window that isn't part of our own
  // `I` round-trip. The harvest looks like normal play (activeMenu stays null),
  // so it must hand the channel back rather than mistake a foreign message for
  // its own data — which would freeze input (phase stuck) or fire a stray
  // Escape into a real menu (extra-phase hijack).
  describe('foreign messages racing in mid-harvest', () => {
    const escapes = (h: Harness) =>
      sent(h).filter(m => m.msg === 'key' && (m as { keycode?: number }).keycode === 27)

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
      feedBase(h); feedExtra(h)  // settle the new harvest's fallback timer
    })

    it('does not hijack a real menu opened during the extra phase, nor Escape it', () => {
      const h = setup()
      startHarvest()  // I; phase 'base'
      feedBase(h)     // capture base, send `!`; phase 'extra', activeMenu still null
      // A real menu opens mid-`!`-round-trip. It can't be ours — the extra
      // re-send arrives as update_menu_items, never a fresh `menu` — so the
      // harvest aborts and the menu renders (activeMenu set).
      h.dispatch({ msg: 'menu', tag: 'inventory', title: { text: 'Inv' },
                   items: [{ level: 1, text: 'old', hotkeys: [97] }] })
      expect(isHidden(overlay(h))).toBe(false)
      expect(overlay(h).textContent).toContain('old')
      // Its own item refresh must PATCH the menu, not be consumed as the
      // harvest's extra columns and answered with an Escape. The extra-phase
      // `!activeMenu` guard is the backstop: with both guards gone, this update
      // fires keycode 27 into the open menu and never patches it.
      h.dispatch({ msg: 'update_menu_items', chunk_start: 0,
                   items: [{ level: 1, text: 'new', hotkeys: [97] }] })
      expect(escapes(h)).toHaveLength(0)            // no stray Escape to the server
      expect(isHidden(overlay(h))).toBe(false)      // menu still open
      expect(overlay(h).textContent).toContain('new')  // patched, not hijacked
    })
  })

  // Keep the rail in sync with the letter→spell map: it casts `z<letter>`
  // blindly, so a stale letter would fire the WRONG spell. Exactly three events
  // change that map, each re-harvests via the spellsDirty path. The triggers are
  // precise — routine play (casting, plain viewing, combat log) must NOT poll.
  describe('re-harvest on a letter-map change', () => {
    // Settle a re-harvest's own I → ! → Esc so its 1.5s fallback timer is cleared.
    const settle = (h: Harness) => { feedBase(h); feedExtra(h) }

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
      settle(h)
    })

    it('re-harvests when a spell is lost ("Your memory of X unravels.")', () => {
      const h = setup()
      fullHarvest(h)
      h.dispatch({ msg: 'msgs', messages: [{ text: 'Your memory of Freeze unravels.' }] })
      expect(sentInputI(h)).toHaveLength(2)
      settle(h)
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
      settle(h)
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
      settle(h)
    })

    it('does NOT re-harvest when the player merely views the spell list (I/describe)', () => {
      const h = setup()
      h.dispatch({ msg: 'input_mode', mode: 1 })
      settle(h)
      expect(sentInputI(h)).toHaveLength(1)
      // Same tag, but a "(describe)" title — viewing changes no letters.
      h.dispatch({ msg: 'menu', tag: 'spell', title: { text: 'Your spells (describe)' }, items: BASE })
      h.dispatch({ msg: 'close_menu' })
      h.dispatch({ msg: 'input_mode', mode: 1 })
      expect(sentInputI(h)).toHaveLength(1)
    })
  })

  // The ✦ tab hosts a quick-cast grid in the touch panel (no map coverage).
  // game-view supplies the grid DOM via the spellTab.render callback; touch.ts
  // hosts it and re-renders on refreshSpellTab() after each (re)harvest.
  describe('✦ spell tab (touch-panel quick-cast grid)', () => {
    const spellTab = (h: Harness) => h.view.querySelector<HTMLElement>('.tc-tab[data-tab="spells"]')
    const gridBtns = (h: Harness) => [...h.view.querySelectorAll<HTMLElement>('.tc-spell-grid .tc-spell-btn')]
    const gridBtn = (h: Harness, letter: string) =>
      gridBtns(h).find(b => b.querySelector('.tc-spell-letter')?.textContent === letter)!

    it('renders one grid button (tile + letter) per harvested spell when the ✦ tab is tapped', () => {
      const h = setup()
      fullHarvest(h)
      spellTab(h)!.click()
      expect(gridBtns(h)).toHaveLength(BASE.length)
      expect(gridBtn(h, 'a').querySelector('.tile-stack')).toBeTruthy()
    })

    it('casts the tapped spell (z + letter) from the grid', () => {
      const h = setup()
      h.dispatch({ msg: 'input_mode', mode: 1 }) // command mode (+ the once-per-game auto-harvest)
      feedBase(h); feedExtra(h)                   // complete that harvest → cache populated, idle
      spellTab(h)!.click()
      gridBtn(h, 'a').click()
      expect(sent(h)).toContainEqual({ msg: 'input', text: 'z' })
      expect(sent(h)).toContainEqual({ msg: 'input', text: 'a' })
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
      feedExtra(h) // settle the harvest's fallback timer
    })

    it('omits the ✦ tab while spectating (no spells to cast)', () => {
      const h = setup({ username: 'bob' })
      expect(spellTab(h)).toBeNull()
    })
  })
})
