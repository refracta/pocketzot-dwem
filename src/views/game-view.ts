import type { WsConnection } from '../ws/connection'
import type { ClientMsg, ServerMsg } from '../ws/types'
import { MapStore } from '../game/map/map-store'
import { MapView } from '../game/map/map-view'
import { TileMapView } from '../game/map/tile-map-view'
import { StatsView } from '../game/hud/stats-view'
import { StatusView } from '../game/hud/status-view'
import { MonsterListView } from '../game/hud/monster-list'
import { MonsterPanelView } from '../game/hud/monster-panel'
import { fgHaloDngnName, loFlagOverlayIcons } from '../game/hud/monster-style'
import { InventoryStore } from '../game/inventory-store'
import { buildTouchControls } from '../game/input/touch'
import type { TouchControls } from '../game/input/touch'
import { handleKeydown, CK_UP, CK_DOWN, CK_PGUP, CK_PGDN, CK_HOME, CK_END } from '../game/input/keyboard'
import { createShiftToggle } from '../game/input/shift-state'
import { uiColor, escHtml, dcssToHtml, DCSS_COLOR_MAP } from '../game/dcss-colors'
import { parsePromptText, PROMPT_TRIGGER_RE } from './prompt-parse'
import { extractSkillHotkeys } from './skill-hotkeys'
import { tileLoader, TEX } from '../game/tiles/tile-loader'
import { renderTiles, appendIconOverlays, monsterTileSpec, prependDngnLayer, type TileRef } from '../game/tiles/tile-view'

// MOUSE_MODE_YESNO from DCSS defines.h. Set inside yesno() (prompt.cc:219)
// for the duration of the y/N read, regardless of whether a menu is open.
const MOUSE_MODE_YESNO = 8

// --- local protocol interfaces ---

interface NewgameButton {
  hotkey?: string | number
  label?: string
  labels?: string[]
  x?: number
  y?: number
  description?: string
  highlight_colour?: number
  tile?: Array<{t: number; tex: number}>
}

interface NewgameGridLabel {
  x: number
  y: number
  label: string
}

interface NewgameItems {
  buttons?: NewgameButton[]
  labels?: NewgameGridLabel[]
  width?: number
  height?: number
}

interface SpellEntry {
  title: string
  letter: string
  tile: number
  colour?: number
  effect?: string
  range_string?: string
  schools?: string
  level?: number
}

interface SpellBook {
  label: string
  spells: SpellEntry[]
}

interface UiPushMsg {
  type: string
  title?: string
  prompt?: string
  body?: string
  text?: string
  desc?: string
  tile?: { t: number; tex: number } | Array<{ t: number; tex: number }>
  tiles?: Array<{ t: number; tex: number }>
  highlight?: string
  information?: string
  features?: string
  changes?: string
  actions?: string
  feats?: Array<{ title?: string; body?: string; quote?: string; tile?: { t: number; tex: number } }>
  fg_idx?: number  // describe-monster: monster's primary tile id (texture inferred)
  doll?: Array<[number, number]>  // describe-monster: player-doll part [tile_id, ymax] entries
  mcache?: Array<[number, number, number]> | null  // describe-monster: humanoid+equipment [tile_id, xofs, yofs]
  flag?: number     // describe-monster: status overlay bitmask (attitude, behavior, etc.)
  icons?: number[]  // describe-monster: pre-decoded extra icon tile ids
  // describe-monster / describe-item: spell list rendered where SPELLSET_PLACEHOLDER
  // appears in the body. Each book has a header label and a list of spells.
  spellset?: SpellBook[]
  // describe-monster: optional pane fields (cycled via `!` in reference client).
  quote?: string
  status?: string
  // describe-god fields
  name?: string
  colour?: number
  is_altar?: boolean
  description?: string
  favour?: string
  powers_list?: string
  powers?: string
  wrath?: string
  extra?: string
  service_fee?: string
  'main-items'?: NewgameItems
  'sub-items'?: NewgameItems
  // seed-selection: explanatory paragraph rendered below the body, above
  // the pregenerate checkbox; show_pregen_toggle hides the checkbox on
  // dgamelaunch builds (server config), preserving Begin/Clear/Daily.
  footer?: string
  show_pregen_toggle?: boolean
  // msgwin-get-line: stamped by the server; required so our ui_state_sync
  // echoes back the same id (server drops mismatched syncs).
  generation_id?: number
  // formatted-scroller (message log, lookup help, morgue, …): server-side
  // FS_START_AT_END flag (scroller.cc emits it alongside the push). The push
  // is followed by ui-state scroll=INT32_MAX, but those may arrive in a
  // separate WS frame — honoring this flag during the initial render
  // guarantees the first paint is at the bottom even when they don't batch.
  start_at_end?: boolean
}

interface MenuItem {
  level: number
  text?: string
  colour?: number
  hotkeys?: number[]
  tiles?: Array<{ t: number; tex: number }>
}

interface MenuMsg {
  type?: string
  tag?: string
  flags?: number
  title?: { text: string }
  items?: MenuItem[]
  more?: string
  // Authoritative item count. Inventory paging shrinks/grows this via
  // update_menu; we truncate the items list to match (otherwise stale
  // entries from the prior category linger when the new one is shorter).
  total_items?: number
  // When the server pushes a new menu replacing the topmost (without an
  // intervening close_menu) it sets replace:true.
  replace?: boolean
}

// Menu flag bits (subset; values from the reference client enums.js).
const MF_MULTISELECT = 0x0004
const MF_WRAP = 0x0080
const MF_ARROWS_SELECT = 0x40000

// Cell/glyph multiplier applied while X-mode (eXamine level map) is active.
// Honored by both renderers via setFontScale (ASCII shrinks glyphs, tiles
// shrink cellPx); the symmetric slack-fill turns the freed HUD/log area
// into extra cells. Upstream's tile_map_scale defaults to 0.6 — we ship
// 0.7 for now; tune in one place.
const X_MODE_SCALE = 0.7

export function buildGameView(
  conn: WsConnection,
  onLobby: () => void,
  spectating?: { username: string },
): HTMLElement {
  const store = new MapStore()
  if (import.meta.env.DEV) (window as unknown as { __dcssStore: MapStore }).__dcssStore = store
  // Map render mode. Starts in tiles; ASCII remains reachable in-session via
  // a two-finger long-press on the map (see below).
  let renderMode: 'ascii' | 'tiles' = 'tiles'
  let mapView: MapView | TileMapView = new TileMapView(store)
  mapView.setZoomMode(true)
  const inventoryStore = new InventoryStore()
  const statsView = new StatsView(inventoryStore)
  const statusView = new StatusView()
  const monsterListView = new MonsterListView(store)
  monsterListView.setRenderMode(renderMode)
  const monsterPanel = new MonsterPanelView(store)
  let monsterPanelOpen = false

  const uiStack: UiPushMsg[] = []
  const crtLines = new Map<number, string>()
  let crtActive = false
  // True while a server `show_dialog` HTML overlay is up (e.g. trunk's
  // save-transfer prompt on resume). Tracked like crtActive so it can't be
  // orphaned if the server proceeds without an explicit hide_dialog.
  let dialogActive = false
  let crtTag: string | undefined
  // Server tracks a menu stack (open_menu pushes, close_menu pops one,
  // close_all_menus clears). Mirroring it is what lets close_menu restore
  // the previous menu instead of dropping us into a hidden-server-menu state
  // where the next keystroke gets eaten by the menu we forgot about.
  const menuStack: MenuMsg[] = []
  let activeMenu: MenuMsg | null = null
  let hoveredMenuIdx = -1
  // Raw server-side hover index for the active menu. We drive menu hover
  // client-side via menu_hover (see cycleMenuHover) instead of forwarding raw
  // arrow keys, because the server's C++ cycle_hover is hotkey-blind and
  // would step onto coalesced continuation rows — costing a dead keypress per
  // wrapped row. This tracks the server's cursor so the next client move is
  // computed from the right place even when the server moves it.
  let menuServerHover = -1
  // Hover is a keyboard-nav indicator that doesn't earn its visual weight in a
  // touch-first UI; the server, however, sends `last_hovered` defaults
  // (MF_INIT_HOVER → 0) on menu open and re-echoes them on most updates. We
  // suppress the visual until the user actually drives hover (arrows / Home /
  // End / paging) — otherwise e.g. tapping uppercase `D` in a shop would light
  // up row a, because ShopMenu::process_key's shopping-list branch in
  // shopping.cc doesn't update `last_hovered` and echoes the stale init
  // default. After the first user-driven move the flag stays on for the
  // lifetime of the menu, and server echoes track normally.
  let menuHoverFromUser = false
  let activePromptEl: HTMLElement | null = null
  let inXMode = false
  let exitedXModeForInput = false
  // Menu filter input (Ctrl-F → "Search for what? (regex)"). Server sends a
  // title_prompt to start one — and an init_input/close_input pair right
  // alongside, because the resumable_line_reader inherits line_reader's
  // start/abort hooks. Those are artifacts; the actual UI lives in the title
  // and the typed text only goes to the server when the user presses Enter
  // (see menu.js:730 in the reference client). titlePromptInput non-null =
  // both that suppression and the local-only typing state.
  let titlePromptInput: HTMLInputElement | null = null
  // Last cursor loc from the server. Tracked here so an ASCII↔tiles swap
  // can re-apply it to the new view (each view keeps its own cursor state).
  let cursorLoc: { x: number; y: number } | null = null
  // Last `input_mode` from the server. MOUSE_MODE_YESNO (8) is sent while
  // a (y/N) prompt is active inside an open menu (e.g. shop "Purchase
  // items for X gold?"); buildMenuControls swaps the row when this is set.
  let currentInputMode: number | undefined
  // Sticky shift toggle for menu hotkeys. Used in shops ([A-J] adds to
  // shopping list vs [a-j] marks for purchase) and the skill screen
  // (capital letter solo-trains that skill). Same off/once/lock state
  // machine as the virtual kbd (see shift-state.ts). Resets when the
  // menu closes.
  const menuShift = createShiftToggle({ onChange: () => refreshShiftUI() })
  // Tracks whether the virtual keyboard was opened by us (paired with an
  // input prompt). Auto-close sites only fire `closeKbd` when this flag is
  // set, so a kbd the user manually toggled open via the kbd button stays
  // open across overlay transitions.
  let kbdAutoOpened = false

  function autoOpenKbd(): void {
    touchControls.openKbd()
    kbdAutoOpened = true
  }

  function autoCloseKbdIfOurs(): void {
    if (!kbdAutoOpened) return
    kbdAutoOpened = false
    touchControls.closeKbd()
  }

  const view = document.createElement('div')
  view.id = 'game-view'

  const uiOverlay = document.createElement('div')
  uiOverlay.id = 'ui-overlay'
  uiOverlay.style.display = 'none'

  const msgLog = document.createElement('div')
  msgLog.id = 'game-messages'
  msgLog.addEventListener('click', (e) => {
    if (uiOverlay.style.display === 'none' && !(e.target as HTMLElement).closest('button, input, .game-text-input-row')) {
      conn.send({ msg: 'key', keycode: 16 })
      view.focus({ preventScroll: true })
    }
  })

  const mapWrap = document.createElement('div')
  mapWrap.id = 'map-wrap'
  mapWrap.appendChild(mapView.element)
  mapWrap.appendChild(monsterListView.element)

  // Double-tap the map to toggle zoom. Bypassed while X-mode is active
  // (font scale is overridden there) — single-tap behavior is undefined on
  // the map today, so we don't need to suppress click propagation.
  // Bound to mapWrap (not mapView.element) so it survives the in-place swap
  // between MapView and TileMapView.
  let lastTap = { t: 0, x: 0, y: 0 }
  mapWrap.addEventListener('pointerdown', (e) => {
    if (inXMode || e.button !== 0) return
    // Ignore the secondary finger of a multi-touch gesture — otherwise two
    // close-together touches can satisfy the double-tap-zoom check below.
    if (!e.isPrimary) return
    const target = e.target as HTMLElement | null
    if (!target || !target.closest('#map-grid')) return
    const now = e.timeStamp
    const dt = now - lastTap.t
    const dx = e.clientX - lastTap.x
    const dy = e.clientY - lastTap.y
    if (dt < 300 && dx * dx + dy * dy < 30 * 30) {
      mapView.setZoomMode(!mapView.isZoomMode())
      mapView.fitToContainer()
      lastTap = { t: 0, x: 0, y: 0 }
      return
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY }
  })

  // Two-finger long-press on the map flips between ASCII and tile rendering.
  // Hidden gesture (no on-screen affordance) because the toggle is rare and
  // not first-launch discovery — atlases are ~10 MB and we never start a
  // session in tile mode. Hold ~450 ms; cancel on finger movement >40 px,
  // any lift before the timer, or a 3rd touch.
  let tileGestureTimer: number | null = null
  let tileGestureCenter: { x: number; y: number } | null = null
  const cancelTileGesture = (): void => {
    if (tileGestureTimer != null) { window.clearTimeout(tileGestureTimer); tileGestureTimer = null }
    tileGestureCenter = null
  }
  mapWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) { cancelTileGesture(); return }
    const target = e.target as HTMLElement | null
    if (!target || !target.closest('#map-grid')) { cancelTileGesture(); return }
    // Suppress any pending single-tap-zoom state so the two-finger landings
    // can't accidentally satisfy the double-tap-zoom check.
    lastTap = { t: 0, x: 0, y: 0 }
    const t1 = e.touches[0]; const t2 = e.touches[1]
    tileGestureCenter = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
    if (tileGestureTimer != null) window.clearTimeout(tileGestureTimer)
    tileGestureTimer = window.setTimeout(() => {
      tileGestureTimer = null; tileGestureCenter = null
      setRenderMode(renderMode === 'tiles' ? 'ascii' : 'tiles')
    }, 450)
  }, { passive: true })
  mapWrap.addEventListener('touchmove', (e) => {
    if (tileGestureTimer == null || !tileGestureCenter) return
    if (e.touches.length !== 2) { cancelTileGesture(); return }
    const t1 = e.touches[0]; const t2 = e.touches[1]
    const cx = (t1.clientX + t2.clientX) / 2
    const cy = (t1.clientY + t2.clientY) / 2
    const dx = cx - tileGestureCenter.x; const dy = cy - tileGestureCenter.y
    if (dx * dx + dy * dy > 40 * 40) cancelTileGesture()
  }, { passive: true })
  mapWrap.addEventListener('touchend', cancelTileGesture, { passive: true })
  mapWrap.addEventListener('touchcancel', cancelTileGesture, { passive: true })

  // Tap the compact monster list to open the full-screen GUI variant.
  // Refuse while a server-side prompt is up so we don't drop the user out
  // of an in-progress targeting/menu/etc.
  monsterListView.element.addEventListener('click', (e) => {
    if (uiStack.length > 0 || crtActive || dialogActive || activeMenu) return
    if (monsterListView.element.childElementCount === 0) return
    e.stopPropagation()
    openMonsterPanel()
  })

  const hudTop = document.createElement('div')
  hudTop.id = 'hud-top'
  hudTop.appendChild(statsView.element)

  const hud = document.createElement('div')
  hud.id = 'game-hud'
  hud.appendChild(hudTop)
  hud.appendChild(statusView.element)

  const moreBtn = document.createElement('button')
  moreBtn.id = 'more-btn'
  moreBtn.textContent = '— more —'
  moreBtn.style.display = 'none'
  moreBtn.addEventListener('click', () => {
    conn.send({ msg: 'key', keycode: 32 })
    view.focus({ preventScroll: true })
  })

  // The d-pad calls this send directly (it doesn't dispatch a keydown), so
  // the menu-nav redirect has to happen here too — otherwise phone users get
  // the raw-arrow / dead-keypress behaviour the keyboard path now avoids.
  // Post-dispatch hook for outbound user keystrokes (from touch and physical
  // keyboard). X-mode 'R' (CMD_MAP_EXCLUDE_RADIUS, viewmap.cc) blocks
  // on getchm() for one digit char with no `init_input` / `text_cursor` to
  // anchor a touch UI on; pop the numpad here so the user has a way to
  // enter the radius. Outside X-mode, 'R' falls through normally (e.g. the
  // macro tab's 'R' = "Remove jewellery").
  //
  // If the radius numpad is already up, any subsequent outbound keystroke
  // (typically a digit / nav key from the physical keyboard) has just
  // resolved the server's getchm() — close the now-stale numpad. Without
  // this, kbd users see a phantom numpad after pressing R+digit on hardware.
  let radiusNumpadActive = false
  function afterUserSend(msg: ClientMsg): void {
    if (radiusNumpadActive) {
      removeNumpadInput()
      return
    }
    if (inXMode && msg.msg === 'input' && msg.text === 'R') {
      showNumpadInput('Exclusion radius (0–9):', { closeAfterDigit: true })
    }
  }

  const touchControls: TouchControls = buildTouchControls((msg) => {
    if (msg.msg === 'key' && menuNavActive()) {
      if (msg.keycode === CK_DOWN) { cycleMenuHover(false); return }
      if (msg.keycode === CK_UP) { cycleMenuHover(true); return }
      if (msg.keycode === CK_PGDN) { pageMenu(false); return }
      if (msg.keycode === CK_PGUP) { pageMenu(true); return }
      if (msg.keycode === CK_END) { jumpMenu(true); return }
      if (msg.keycode === CK_HOME) { jumpMenu(false); return }
    }
    if (msg.msg === 'key' && handleScrollerKeycode(msg.keycode)) return
    conn.send(msg)
    afterUserSend(msg)
  })

  const menuControls = document.createElement('div')
  menuControls.id = 'menu-controls'
  menuControls.style.display = 'none'

  const numpadInput = document.createElement('div')
  numpadInput.id = 'numpad-input'
  numpadInput.style.display = 'none'

  view.appendChild(uiOverlay)
  view.appendChild(mapWrap)
  view.appendChild(msgLog)
  view.appendChild(moreBtn)
  view.appendChild(hud)
  view.appendChild(numpadInput)
  if (spectating) {
    const bar = document.createElement('div')
    bar.id = 'spectator-bar'
    const exitBtn = document.createElement('button')
    exitBtn.className = 'lobby-btn-ghost'
    exitBtn.setAttribute('aria-label', 'Back to lobby')
    exitBtn.textContent = '← Lobby'
    exitBtn.addEventListener('click', () => {
      conn.send({ msg: 'go_lobby' })
      onLobby()
    })
    const chip = document.createElement('div')
    chip.className = 'lobby-account-chip is-guest'
    chip.innerHTML = `
      <span class="lobby-chip-role">Spectating</span>
      <span class="lobby-chip-sep">·</span>
      <span class="lobby-chip-tag">${escHtml(spectating.username)}</span>
    `
    bar.appendChild(exitBtn)
    bar.appendChild(chip)
    view.appendChild(bar)
  } else {
    view.appendChild(touchControls.element)
    view.appendChild(menuControls)
  }

  view.setAttribute('tabindex', '0')
  requestAnimationFrame(() => view.focus({ preventScroll: true }))

  // Observe the map-grid element so any container size change (initial
  // layout settlement, message panel growth, HUD changes, window resize)
  // triggers a refit. The hysteresis inside fitToContainer is what prevents
  // tiny container shrinks from dropping a row — the observer fires either
  // way, but the recompute keeps the current viewport size if overflow is
  // small.
  //
  // Some call sites (enterXMode/exitXMode, hideOverlay) also call
  // mapView.fitToContainer() explicitly. That's redundant with the observer
  // but resolves the layout one frame earlier — without it there'd be a
  // brief flash at the old size before the observer's callback runs.
  const fontScaleObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => mapView.fitToContainer())
  })
  fontScaleObserver.observe(mapView.element)

  // Swaps the active map view in place. Forces zoom on when switching INTO
  // tile mode (tiles at full 33×21 are ~10 px on a phone), and reuses the
  // current view-center so the swap doesn't flicker through an unset position.
  // Not persisted: choice resets to tiles on next session.
  function setRenderMode(mode: 'ascii' | 'tiles'): void {
    if (mode === renderMode) return
    renderMode = mode
    const center = { x: store.playerPos.x, y: store.playerPos.y }
    fontScaleObserver.unobserve(mapView.element)
    const oldEl = mapView.element
    const next: MapView | TileMapView = mode === 'tiles' ? new TileMapView(store) : new MapView(store)
    next.setViewCenter(center)
    // Default tile mode to zoom-on. Apply unconditionally — tile X-mode 
    // uses the zoom-on (17-floor) base shrunk by X_MODE_SCALE.
    if (mode === 'tiles') next.setZoomMode(true)
    // Carry the X-mode scale across the swap: the new view starts at 1.0
    // by default, which would visibly un-zoom the map mid-X-mode. inXMode
    // is the source of truth (global flag), so re-apply directly.
    if (inXMode) next.setFontScale(X_MODE_SCALE)
    if (cursorLoc) next.setCursor(cursorLoc)
    oldEl.replaceWith(next.element)
    mapView = next
    fontScaleObserver.observe(mapView.element)
    if (mode === 'tiles' && tileLoader.configured) void (mapView as TileMapView).preloadAtlases()
    monsterListView.setRenderMode(mode)
    requestAnimationFrame(() => { mapView.fitToContainer(); mapView.fullRender() })
  }

  // Dev-only console hook so the tile mode (otherwise only a hidden
  // two-finger long-press) can be toggled from desktop Safari, which has
  // no TouchEvent constructor to synthesize the gesture.
  // __dcssTiles() toggles; __dcssTiles(true|false) forces tiles|ascii.
  if (import.meta.env.DEV) {
    (window as unknown as { __dcssTiles: (on?: boolean) => void }).__dcssTiles =
      (on) => setRenderMode(on === undefined ? (renderMode === 'tiles' ? 'ascii' : 'tiles') : (on ? 'tiles' : 'ascii'))
  }

  const docKeyHandler = (e: KeyboardEvent) => {
    if (!view.isConnected) { document.removeEventListener('keydown', docKeyHandler); return }
    if (spectating) {
      if (e.key === 'Escape') {
        e.preventDefault()
        conn.send({ msg: 'go_lobby' })
        onLobby()
      }
      return
    }
    if (document.activeElement instanceof HTMLInputElement) return
    if (monsterPanelOpen) {
      e.preventDefault()
      if (e.key === 'Escape') closeMonsterPanel()
      return
    }
    if (handleMenuNavKey(e)) return
    if (handleScrollerKey(e)) return
    handleKeydown(e, (msg) => { conn.send(msg); afterUserSend(msg) })
  }
  document.addEventListener('keydown', docKeyHandler)

  conn.onMessage = handleMsg

  function handleMsg(msg: ServerMsg): void {
    switch (msg.msg) {
      // Both 0.34 and trunk send bare `layer` (client.js: "layer":
      // do_set_layer). `set_layer` is a defensive alias the server never
      // actually sends.
      case 'layer':
      case 'set_layer':
        if (msg.layer === 'game') { uiStack.length = 0; crtActive = false; dialogActive = false; crtTag = undefined; menuStack.length = 0; activeMenu = null; monsterPanelOpen = false; hideOverlay() }
        break

      // Raw-HTML modal pushed by the server (save-transfer prompt on trunk
      // resume, end-of-game prompts, etc.). Mirrors reference handle_dialog:
      // inject the HTML, wire [data-key] buttons to send that key. Without
      // this the game blocks on an invisible prompt — a black screen.
      case 'show_dialog': {
        const html = msg.html ?? ''
        dialogActive = true
        renderOverlay('', () => {
          const body = document.createElement('div')
          body.className = 'dialog-body'
          body.innerHTML = html
          // Group the server's [data-key] buttons into one flex row. The
          // server appends them in reverse visual order and floats them
          // right (e.g. [No, Yes] → renders "Yes  No"); .dialog-buttons
          // uses row-reverse to reproduce that intent for any button set.
          const btnRow = document.createElement('div')
          btnRow.className = 'dialog-buttons'
          body.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
            el.addEventListener('click', () => {
              const k = el.getAttribute('data-key') ?? ''
              if (k) conn.send({ msg: 'input', text: k })
            })
            btnRow.appendChild(el)
          })
          if (btnRow.children.length) body.appendChild(btnRow)
          uiOverlay.appendChild(body)
        })
        break
      }

      case 'hide_dialog':
        if (dialogActive) { dialogActive = false; hideOverlay() }
        break

      case 'game_client': {
        // Server tells us the gamedata version on game start. Use it to
        // build URLs for tile atlases (gui.png, main.png, ...) served at
        // /gamedata/<version>/.
        const httpBase = conn.wsUrl.replace(/^ws/, 'http').replace(/\/socket\/?$/, '')
        if (msg.version) tileLoader.configure(httpBase, msg.version)
        // If the user toggled to tile mode before game_client arrived (via
        // the two-finger gesture or __dcssTiles), the loader had no URL
        // base yet — nudge it to start loading now.
        if (renderMode === 'tiles') void (mapView as TileMapView).preloadAtlases()
        if (renderMode === 'tiles') monsterListView.update(store.getMonsters())
        break
      }

      case 'map': {
        if (msg.clear) store.clear()
        if (msg.vgrdc) mapView.setViewCenter(msg.vgrdc)
        const dirty = store.merge(msg.cells ?? [])
        if (msg.clear || msg.vgrdc) mapView.fullRender()
        else mapView.render(dirty)
        monsterListView.update(store.getMonsters())
        if (monsterPanelOpen) monsterPanel.update(store.getMonsters())
        break
      }

      case 'player': {
        if (msg.pos) {
          const prev = { ...store.playerPos }
          store.playerPos = { x: msg.pos.x, y: msg.pos.y }
          if (prev.x !== store.playerPos.x || prev.y !== store.playerPos.y) {
            mapView.setViewCenter(store.playerPos)
            mapView.fullRender()
          }
        }
        inventoryStore.update(msg.inv)
        statsView.update(msg)
        if (msg.status !== undefined) statusView.update(msg.status)
        if (msg.time !== undefined) markLastMsg('turn')
        break
      }

      case 'txt': {
        const raw = msg as unknown as Record<string, unknown>
        const lines = raw['lines']
        if (raw['id'] && lines && typeof lines === 'object' && !Array.isArray(lines)) {
          updateCrtLines(lines as Record<string, string>)
        } else {
          const text = String(raw['text'] ?? '')
          if (text.includes('\n')) showTxtPage(text)
          else appendMessage(text)
        }
        break
      }

      case 'ui-push': {
        const pushMsg = msg as unknown as UiPushMsg
        // A server overlay supersedes our client-side monster panel; clear the
        // flag so subsequent map updates don't rewrite the overlay body.
        monsterPanelOpen = false
        // describe-* overlays hint "(press '!' for details)" inside the body,
        // not in the actions footer — promote it to a tappable button so it's
        // reachable on mobile. Mutating actions persists across ui-state body
        // swaps, so the button stays put while the user toggles in/out.
        if (/press '!' for details/.test(pushMsg.body ?? '') && !/\(!\)/.test(pushMsg.actions ?? '')) {
          const trimmed = (pushMsg.actions ?? '').replace(/\.\s*$/, '')
          pushMsg.actions = trimmed ? `${trimmed}, (!)details.` : '(!)details.'
        }
        uiStack.push(pushMsg)
        showUiPush(pushMsg)
        break
      }

      case 'ui-stack': {
        // Sent on spectator join: a snapshot of the watched game's UI stack.
        // Each item carries its own `msg` field (ui-push, ui-state, ...),
        // so we re-dispatch through the same handler.
        const items = (msg as unknown as { items?: ServerMsg[] }).items
        if (Array.isArray(items)) for (const item of items) handleMsg(item)
        break
      }

      case 'ui-pop':
        uiStack.pop()
        if (uiStack.length > 0) showUiPush(uiStack[uiStack.length - 1])
        else if (crtActive) restoreCrt()
        else if (activeMenu) showMenu(activeMenu)
        else hideOverlay()
        break

      case 'ui-state': {
        const raw = msg as unknown as Record<string, unknown>
        const text = raw['text'] as string | undefined
        const body = raw['body'] as string | undefined
        const highlight = raw['highlight'] as string | undefined
        const scroll = raw['scroll'] as number | undefined
        const fromWebtiles = raw['from_webtiles'] === true
        const actions = raw['actions'] as string | undefined
        if (text) {
          const entry: UiPushMsg = { type: 'formatted-scroller', text, ...(highlight ? { highlight } : {}), ...(actions ? { actions } : {}) }
          if (uiStack.length > 0) {
            Object.assign(uiStack[uiStack.length - 1], entry)
            showUiPush(uiStack[uiStack.length - 1])
          } else {
            showTxtPage(text)
          }
        } else if (body !== undefined && uiStack.length > 0) {
          // describe-item / describe-monster swap body in/out when the user
          // toggles `!` (spell-failure details, monster panes, etc.). Server
          // sends a ui-state with the replacement body and keeps the parent
          // push's title, actions, and tile intact, so update body in place.
          uiStack[uiStack.length - 1].body = body
          showUiPush(uiStack[uiStack.length - 1])
        }
        // from_webtiles=true is the server echoing our own
        // formatted_scroller_scroll back — our scroll position is already
        // correct (we set it locally before sending).
        if (scroll !== undefined && !fromWebtiles) scrollOverlayBody(scroll)
        break
      }

      case 'ui-scroller-scroll': {
        // The reference client skips this entirely when the top popup is a
        // formatted-scroller (ui-layouts.js:1066-1073: "formatted scrollers
        // send their own synchronization messages"). The server emits these
        // with a hardcoded from_webtiles=false (ui.cc:1501-1503), so without
        // the popup-type guard we'd ricochet our own scroll position back
        // through this channel.
        if (formattedScrollerActive()) break
        const raw = msg as unknown as Record<string, unknown>
        const scroll = raw['scroll'] as number | undefined
        const fromWebtiles = raw['from_webtiles'] === true
        if (scroll !== undefined && !fromWebtiles) scrollOverlayBody(scroll)
        break
      }

      case 'ui-state-sync': {
        // Server-driven updates to a focused input widget. from_webtiles=true
        // means the server is echoing our own edit back, so skip to avoid
        // clobbering the cursor mid-typing. Handled widgets:
        //   "input"        — msgwin-get-line single text field
        //   "seed"         — seed-selection seed entry
        //   "pregenerate"  — seed-selection checkbox
        //   "btn-*"        — buttons; presence-only, no state to apply
        const m = msg as unknown as { widget_id?: string; text?: string; checked?: boolean; from_webtiles?: boolean; has_focus?: boolean }
        if (m.from_webtiles) break
        if (m.widget_id === 'input') {
          const input = uiOverlay.querySelector<HTMLInputElement>('.input-dialog-field')
          if (!input) break
          if (m.has_focus) input.focus()
          else if (typeof m.text === 'string' && input.value !== m.text) input.value = m.text
        } else if (m.widget_id === 'seed') {
          const input = uiOverlay.querySelector<HTMLInputElement>('.seed-input-field')
          if (!input) break
          if (m.has_focus) input.focus()
          else if (typeof m.text === 'string' && input.value !== m.text) {
            input.value = m.text
            // Keep the revert-anchor aligned with the server so a non-digit
            // edit doesn't snap the field back to empty.
            input.dataset.lastValid = m.text
          }
        } else if (m.widget_id === 'pregenerate') {
          const cb = uiOverlay.querySelector<HTMLInputElement>('.seed-pregen-checkbox')
          if (cb && typeof m.checked === 'boolean') cb.checked = m.checked
        }
        break
      }

      case 'menu': {
        const m = msg as unknown as MenuMsg
        if (m.type === 'crt') showCrt(m.tag)
        else {
          if (m.replace) menuStack.pop()
          menuStack.push(m)
          showMenu(m)
        }
        break
      }

      case 'update_menu': {
        const m = msg as unknown as { more?: string; last_hovered?: number; total_items?: number; title?: { text: string } }
        if (!activeMenu) break
        if (m.more !== undefined) {
          activeMenu.more = m.more
          const footerEl = uiOverlay.querySelector('.overlay-footer')
          if (footerEl) {
            const listEl = uiOverlay.querySelector<HTMLElement>('.overlay-list')
            const pos = listEl ? computeScrollPos(listEl) : 'top'
            footerEl.innerHTML = formatMoreHtml(m.more, pos)
            syncAcceptBtn(formatMore(m.more, pos))
          }
        }
        if (m.total_items !== undefined) {
          activeMenu.total_items = m.total_items
          // Truncate stale entries when paging to a shorter category — the
          // following update_menu_items only splices in the new chunk and
          // would otherwise leave the tail intact. The official client does
          // the same in update_menu (menu.js:822).
          if (activeMenu.items && activeMenu.items.length > m.total_items) {
            activeMenu.items.length = m.total_items
            updateMenuItems(activeMenu)
          }
        }
        if (m.title) {
          activeMenu.title = m.title
          // Don't blow away the active filter input — the title slot is
          // currently the prompt label. We'll re-render the title when the
          // filter closes.
          if (!titlePromptInput) {
            const titleSpan = uiOverlay.querySelector<HTMLElement>('.overlay-title span')
            if (titleSpan) titleSpan.textContent = stripDcss(m.title.text)
          }
        }
        if (m.last_hovered !== undefined) applyServerHover(m.last_hovered)
        break
      }

      case 'menu_scroll': {
        const m = msg as unknown as { first?: number; last_hovered?: number }
        if (m.last_hovered !== undefined) applyServerHover(m.last_hovered)
        break
      }

      case 'update_menu_items': {
        // Per the protocol (cf. official menu.js update_item_range): patch the
        // chunk in place; never truncate. Earlier code special-cased
        // chunk_start === 0 by replacing the whole list, which dropped the
        // unhighlighted entries when the server sent a single-item update to
        // mark the current selection.
        const m = msg as unknown as { chunk_start?: number; items?: MenuItem[] }
        if (activeMenu && m.items) {
          const start = m.chunk_start ?? 0
          const items = activeMenu.items ?? []
          items.splice(start, m.items.length, ...m.items)
          activeMenu.items = items
          updateMenuItems(activeMenu)
        }
        break
      }

      case 'input_mode': {
        const prevInputMode = currentInputMode
        currentInputMode = msg.mode
        if (msg.mode === 1) {  // COMMAND: normal play resumed
          hideMoreBtn()
          disableActivePrompt()
          removeTextInput()
          // Reference only marks on the COMMAND transition, not on every
          // COMMAND-while-COMMAND repeat (game.js set_input_mode early-returns).
          if (prevInputMode !== 1) markLastMsg('cmd')
        }
        // YESNO prompts fire inside any menu that calls yesno() while open:
        // shop purchase (shopping.cc), acquirement (acquire.cc), Nemelex
        // StackFive (decks.cc:708). Menus with their own permanent bar
        // (shop/stash/acquirement) rebuild on every mode change so the bar
        // can swap to ⎋ Y N. Other menus get a bar only for the duration of
        // the YESNO prompt — shown on the entering edge, hidden on the
        // leaving edge.
        if (activeMenu) {
          const tag = activeMenu.tag
          const tagHasBar = tag === 'shop' || tag === 'stash' || tag === 'acquirement'
          const enteringYesno = msg.mode === MOUSE_MODE_YESNO
          const leavingYesno = prevInputMode === MOUSE_MODE_YESNO && !enteringYesno
          if (tagHasBar || enteringYesno || leavingYesno) {
            buildMenuControls(tag, activeMenu.flags)
            if (!tagHasBar) menuControls.style.display = enteringYesno ? '' : 'none'
          }
        }
        break
      }

      case 'title_prompt': {
        // `raw` is used for keycode capture in the macro editor — we don't
        // implement that, so treat it like close (do nothing / dismiss any
        // existing input).
        if (msg.close || msg.raw) closeTitlePrompt()
        else showTitlePrompt(msg.prompt ?? '')
        break
      }

      case 'init_input': {
        // Suppress the init/close pair that piggybacks on title_prompt — see
        // titlePromptInput's declaration.
        if (titlePromptInput) break
        if (msg.type === 'messages') {
          if (inXMode) { exitedXModeForInput = true; exitXMode() }
          showTextInput(msg.prefill ?? '', msg.maxlen ?? 99)
        } else if (msg.type === 'generic' && msg.tag === 'skill_target') {
          // `type:"generic"` fires only for prompts inside a CRT menu, and
          // the only such prompt in DCSS 0.34 is the skill target editor.
          // The numpad sends each keystroke directly to the server, whose
          // line_reader echoes it into the highlighted target cell.
          showNumpadInput(msg.prompt ?? '')
        }
        // Other `type:"generic"` tags are dropped — none are known to fire
        // in normal play. `type:"seed-selection"` uses ui-state-sync widgets,
        // not init_input (see showSeedSelection).
        break
      }

      case 'msgs': {
        if (msg.rollback) {
          let n = msg.rollback
          while (n-- > 0 && msgLog.lastChild) msgLog.lastChild.remove()
        }
        for (const m of msg.messages ?? []) {
          if (!m.text) continue
          if (m.channel === 2 && PROMPT_TRIGGER_RE.test(m.text)) {
            disableActivePrompt()
            const row = makePromptRow(m.text)
            activePromptEl = row
            msgLog.appendChild(row)
            while (msgLog.children.length > 50) msgLog.firstChild?.remove()
            msgLog.scrollTop = msgLog.scrollHeight
          } else {
            appendMessage(m.text, true)
          }
        }
        if (msg.more) showMoreBtn(msg.more_text)
        else if (msg.more === false) hideMoreBtn()
        break
      }

      case 'cursor': {
        const cursorId = (msg as unknown as { id: number }).id
        cursorLoc = msg.loc ?? null
        mapView.setCursor(msg.loc)
        if (cursorId === 2) {
          if (msg.loc && !inXMode) enterXMode()
          else if (!msg.loc && inXMode) exitXMode()
        } else if (!msg.loc && inXMode) {
          exitXMode()
        }
        if (!msg.loc) exitedXModeForInput = false
        break
      }

      case 'close_input':
        if (titlePromptInput) break
        removeTextInput()
        removeNumpadInput()
        if (exitedXModeForInput) { exitedXModeForInput = false; enterXMode() }
        break

      case 'close_menu': {
        menuStack.pop()
        const prev = menuStack[menuStack.length - 1] ?? null
        activeMenu = prev
        menuShift.reset()
        titlePromptInput = null
        if (prev) showMenu(prev)
        else if (uiStack.length > 0) showUiPush(uiStack[uiStack.length - 1])
        else if (crtActive) restoreCrt()
        else hideOverlay()
        break
      }

      case 'close_all_menus':
        uiStack.length = 0
        crtActive = false
        dialogActive = false
        crtTag = undefined
        menuStack.length = 0
        activeMenu = null
        menuShift.reset()
        monsterPanelOpen = false
        titlePromptInput = null
        hideOverlay()
        break

      case 'go_lobby':
      case 'game_ended':
      case 'close':
        onLobby()
        break
    }
  }

  // --- X mode (eXamine level map) ---

  function enterXMode(): void {
    inXMode = true
    msgLog.style.display = 'none'
    hud.style.display = 'none'
    touchControls.enterXMode()
    mapView.setFontScale(X_MODE_SCALE)
    // Zoom mode is left untouched: tiles already had zoom-on (forced at
    // construction by setRenderMode), and the scale shrinks each cell by
    // X_MODE_SCALE so the freed HUD/log area fills with more cells.
    requestAnimationFrame(() => mapView.fitToContainer())
    // Stash-search activation opens an X-mode preview with the destination
    // cursor: swap the results menu out for the full map + d-pad so the
    // player can see where they'd travel and confirm with Enter. Restored
    // by exitXMode when they Esc back to the menu; close_menu / hideOverlay
    // takes care of cleanup if they Enter to travel and the menu closes.
    if (activeMenu?.tag === 'stash') {
      uiOverlay.style.display = 'none'
      menuControls.style.display = 'none'
      mapView.element.style.display = ''
      touchControls.element.style.display = ''
    }
  }

  function exitXMode(): void {
    inXMode = false
    touchControls.exitXMode()
    mapView.setFontScale(1.0)
    requestAnimationFrame(() => mapView.fitToContainer())
    if (activeMenu?.tag === 'stash') {
      // Returning to the stash results menu: keep HUD/msglog hidden (they were
      // hidden before the preview by renderOverlay, and the overlay layout
      // expects them gone), swap map back for overlay + custom controls,
      // re-hide the d-pad.
      uiOverlay.style.display = ''
      menuControls.style.display = ''
      mapView.element.style.display = 'none'
      touchControls.element.style.display = 'none'
    } else {
      hud.style.display = ''
      msgLog.style.display = ''
    }
  }

  // --- ui-push handler ---

  // Decode status icons from msg.flag (low word of t.fg) and merge with
  // any pre-decoded numeric ids in msg.icons. Bitmask tables live in
  // monster-style.ts so the panel and this popup stay in lockstep.
  function appendMonsterStatusOverlays(wrap: HTMLElement, msg: UiPushMsg, scale: number): void {
    appendIconOverlays(wrap, {
      names: loFlagOverlayIcons(msg.flag ?? 0),
      ids: msg.icons,
    }, scale)
  }

  // Map each ui-push variant's tile-bearing fields onto a uniform tile list
  // for the title icon. Returns undefined when the popup carries no tile.
  function deriveTileSpec(msg: UiPushMsg): TileRef[] | undefined {
    if (msg.tiles) return msg.tiles
    if (msg.tile) return Array.isArray(msg.tile) ? msg.tile : [msg.tile]
    if (msg.feats?.[0]?.tile) return [msg.feats[0].tile]
    // describe-monster: doll = body parts (humanoid form), mcache = body + worn
    // equipment with per-piece pixel offsets. Shared with the monster panel
    // via monsterTileSpec so both render the same humanoid composition.
    const monSpec = monsterTileSpec({ fg_idx: msg.fg_idx, doll: msg.doll, mcache: msg.mcache })
    if (monSpec.length > 0) return monSpec
    return undefined
  }

  function showUiPush(msg: UiPushMsg): void {
    if (msg.type === 'newgame-choice') { showNewgameChoice(msg); return }
    if (msg.type === 'newgame-random-combo') { showRandomCombo(msg); return }
    if (msg.type === 'msgwin-get-line') { showInputDialog(msg); return }
    if (msg.type === 'seed-selection') { showSeedSelection(msg); return }

    let titleSrc = msg.title ?? msg.prompt ?? ''
    let rawBody = msg.text ?? msg.body ?? msg.desc ?? ''
    if (msg.type === 'version') {
      rawBody = [msg.information, msg.features, msg.changes].filter(Boolean).join('\n\n')
    }
    if (msg.type === 'describe-god') {
      // describe-god has no `title`/`text` — name is the heading, and the
      // body is split across pane fields (description / favour+powers_list /
      // powers / wrath / extra). Flatten them into one scrollable body.
      titleSrc = msg.name ? `<lightblue>${msg.name}</lightblue>` : ''
      const sections: string[] = []
      if (msg.description) sections.push(msg.description)
      if (msg.favour) sections.push(`<lightblue>Favour:</lightblue> ${msg.favour}`)
      if (msg.powers_list) {
        const lines = msg.powers_list.split('\n').slice(3, -1).filter(s => s.trim())
        if (lines.length) sections.push(`<lightblue>Powers:</lightblue>\n${lines.join('\n')}`)
      }
      if (msg.powers) sections.push(msg.powers)
      if (msg.wrath) sections.push(`<lightblue>Wrath:</lightblue>\n${msg.wrath}`)
      if (msg.extra) sections.push(msg.extra)
      // Altar-only join prompt (ui-layouts.js:350-353). service_fee is non-empty
      // only for Gozag — already pre-formatted with leading space and parens.
      if (msg.is_altar) sections.push(`<cyan>J</cyan>/<cyan>Enter</cyan>: join religion${msg.service_fee ?? ''}`)
      rawBody = sections.join('\n\n')
    }
    if (msg.type === 'describe-monster') {
      // Reference client splits these into separate panes the user cycles
      // with `!` (ui-layouts.js:443). On mobile we append them so the
      // content is visible without an extra interaction. msg.quote arrives
      // as plain text (unlike the body-embedded darkgrey quotes from
      // describe.cc:4001) — render it as-is, preserving the source's
      // original line structure (dialogue, stage directions, attribution).
      const extra: string[] = []
      if (msg.status) extra.push(`<lightblue>Status:</lightblue>\n${msg.status}`)
      if (msg.quote) extra.push(`<lightblue>Quote:</lightblue>\n${msg.quote}`)
      if (extra.length) rawBody = (rawBody ? rawBody + '\n\n' : '') + extra.join('\n\n')
    }
    if (msg.type === 'describe-feature-wide' && msg.feats?.length) {
      const feats = msg.feats
      titleSrc = feats[0].title ?? ''
      rawBody = feats.map((f, i) => {
        const parts: string[] = []
        if (i > 0 && f.title) parts.push(f.title)
        if (f.body && f.body !== f.title) parts.push(f.body)
        if (f.quote) parts.push(f.quote)
        return parts.join('\n\n')
      }).filter(Boolean).join('\n\n')
    }
    const title = stripDcss(titleSrc)
    const spellset = msg.spellset
    // Strip the placeholder when there's no spellset to render in its place;
    // otherwise keep it so we can split the body around it below.
    if (!spellset?.length) rawBody = rawBody.replace(/SPELLSET_PLACEHOLDER/g, '')
    rawBody = propagateDarkgreyColor(rawBody)
    rawBody = rawBody
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^((?:<[^>]+>)*)\s+/, '$1')
      .replace(/\s+((?:<[^>]+>)*)$/, '$1')
      .trim()

    renderOverlay(title, () => {
      const tileSpec = deriveTileSpec(msg)
      if (tileSpec && tileSpec.length > 0) {
        const headerEl = uiOverlay.querySelector('.overlay-title')
        if (headerEl) {
          const tileEl = renderTiles(tileSpec, 2, { expand: true })
          tileEl.classList.add('overlay-title-tile')
          headerEl.insertBefore(tileEl, headerEl.firstChild)
          if (msg.type === 'describe-monster') {
            const halo = fgHaloDngnName(msg.flag ?? 0)
            if (halo) prependDngnLayer(tileEl, halo, 2)
            appendMonsterStatusOverlays(tileEl, msg, 2)
          }
        }
      }
      if (rawBody) {
        const bodyEl = document.createElement('div')
        bodyEl.className = 'overlay-body fg7'
        if (spellset?.length && rawBody.includes('SPELLSET_PLACEHOLDER')) {
          // Reference client splits the body on SPELLSET_PLACEHOLDER and
          // renders the spellset between the halves (ui-layouts.js:24-31).
          // monsters get colour=false so the spell name keeps the default
          // text colour; items pass colour=true to highlight schools.
          const colourSpells = msg.type !== 'describe-monster'
          const onSpell = (letter: string) => conn.send({ msg: 'input', text: letter })
          const parts = rawBody.split('SPELLSET_PLACEHOLDER')
          parts.forEach((part, i) => {
            if (i > 0) {
              for (const book of spellset) {
                bodyEl.appendChild(renderSpellbook(book, colourSpells, onSpell))
              }
            }
            if (part) bodyEl.insertAdjacentHTML('beforeend', renderBodyLines(part, msg.highlight ?? ''))
          })
        } else {
          bodyEl.innerHTML = renderBodyLines(rawBody, msg.highlight ?? '')
        }
        uiOverlay.appendChild(bodyEl)
        // formatted-scroller is a client-owned scroll widget (see the block
        // comment at scrollOverlayBody). Hook the scroll listener so touch
        // swipes and our own page-key handler sync back to the server; honor
        // FS_START_AT_END synchronously (reading scrollHeight forces a
        // layout flush, so the position lands before the first paint).
        if (msg.type === 'formatted-scroller') {
          if (msg.start_at_end) {
            suppressScrollerSync()
            bodyEl.scrollTop = bodyEl.scrollHeight
          }
          attachScrollerListener(bodyEl)
        }
      }
      if (msg.actions) {
        uiOverlay.appendChild(buildActionsBar(msg.actions))
      }
    })
    // A ui-push layered over a shop/stash/acquirement menu (e.g. describe-item
    // after `!`) should keep the menu's bottom row.
    if (activeMenu?.tag === 'shop' || activeMenu?.tag === 'stash' || activeMenu?.tag === 'acquirement') {
      buildMenuControls(activeMenu.tag, activeMenu.flags)
      menuControls.style.display = ''
      touchControls.element.style.display = 'none'
    }
  }

  function showTxtPage(text: string): void {
    const synthetic: UiPushMsg = { type: 'txt-page', text }
    uiStack.push(synthetic)
    showUiPush(synthetic)
  }

  // Menu filter (Ctrl-F → "Search for what? (regex)"). Reference webtiles
  // client (menu.js:668-740) inlines an input field into the menu title and
  // — unlike msgwin-get-line — does NOT echo characters to the server while
  // typing; the whole string is sent as a single text_input on Enter.
  // Matching that here means we don't have to ferry per-key updates back to
  // the server's resumable_line_reader (whose init_input/close_input pair we
  // also suppress in the dispatcher above).
  function showTitlePrompt(prompt: string): void {
    const titleEl = uiOverlay.querySelector<HTMLElement>('.overlay-title')
    if (!titleEl) return
    titleEl.innerHTML = ''
    const promptEl = document.createElement('span')
    promptEl.className = 'menu-filter-prompt'
    promptEl.innerHTML = dcssToHtml(prompt)
    titleEl.appendChild(promptEl)
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'input-dialog-field menu-filter-input'
    input.autocomplete = 'off'
    input.autocapitalize = 'off'
    input.spellcheck = false
    input.inputMode = 'none'
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        conn.send({ msg: 'text_input', text: input.value + '\r' })
        closeTitlePrompt()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        conn.send({ msg: 'key', keycode: 27 })
        closeTitlePrompt()
      }
    })
    titleEl.appendChild(input)
    titlePromptInput = input
    autoOpenKbd()
    requestAnimationFrame(() => input.focus())
  }

  function closeTitlePrompt(): void {
    if (!titlePromptInput) return
    titlePromptInput = null
    const titleEl = uiOverlay.querySelector<HTMLElement>('.overlay-title')
    if (titleEl && activeMenu) {
      titleEl.innerHTML = ''
      const span = document.createElement('span')
      span.textContent = stripDcss(activeMenu.title?.text ?? '')
      titleEl.appendChild(span)
    }
  }

  // ?-/ search prompts ("Describe what?", "Find what?", level travel, ...)
  // arrive as ui-push msgwin-get-line. The server drives the field via
  // ui-state-sync (widget_id "input") and we echo each edit back, so
  // generation_id must match.
  function showInputDialog(msg: UiPushMsg): void {
    const genId = msg.generation_id
    uiOverlay.innerHTML = ''
    uiOverlay.style.display = ''
    mapView.element.style.display = 'none'
    msgLog.style.display = 'none'
    hud.style.display = 'none'
    // Leave touchControls visible — the kbd-overlay is a fixed-position
    // child of it, and `display:none` on the parent would hide the keyboard
    // too. The keyboard covers the d-pad anyway when open.
    touchControls.element.style.display = ''
    menuControls.style.display = 'none'
    menuControls.innerHTML = ''

    const wrap = document.createElement('div')
    wrap.className = 'input-dialog'

    if (msg.prompt) {
      const promptEl = document.createElement('div')
      promptEl.className = 'input-dialog-prompt'
      promptEl.innerHTML = dcssToHtml(msg.prompt)
      wrap.appendChild(promptEl)
    }

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'input-dialog-field'
    input.autocomplete = 'off'
    input.autocapitalize = 'off'
    input.spellcheck = false
    input.inputMode = 'none'

    input.addEventListener('input', () => {
      if (genId === undefined) return
      conn.send({
        msg: 'ui_state_sync',
        widget_id: 'input',
        text: input.value,
        cursor: input.selectionStart ?? input.value.length,
        generation_id: genId,
      })
    })

    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        conn.send({ msg: 'key', keycode: 13 })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        conn.send({ msg: 'key', keycode: 27 })
      }
    })

    wrap.appendChild(input)
    uiOverlay.appendChild(wrap)
    autoOpenKbd()
    requestAnimationFrame(() => input.focus())
  }

  // Custom-seed entry on newgame. The server pushes title/body/footer text
  // and a show_pregen_toggle flag, then drives the seed input and pregen
  // checkbox via ui-state-sync (widget_id "seed" / "pregenerate"). Buttons
  // use hotkeys: Enter=Begin, '-'=Clear, 'd'=Daily — the server's button
  // handlers update the seed input server-side and echo back via sync.
  function showSeedSelection(msg: UiPushMsg): void {
    const genId = msg.generation_id
    uiOverlay.innerHTML = ''
    uiOverlay.style.display = ''
    mapView.element.style.display = 'none'
    msgLog.style.display = 'none'
    hud.style.display = 'none'
    // Keep touchControls visible so the kbd-overlay child stays mounted (see
    // showInputDialog for the same reason).
    touchControls.element.style.display = ''
    menuControls.style.display = 'none'
    menuControls.innerHTML = ''

    const wrap = document.createElement('div')
    wrap.className = 'seed-selection'

    if (msg.title) {
      const header = document.createElement('div')
      header.className = 'seed-header'
      header.innerHTML = dcssToHtml(msg.title)
      wrap.appendChild(header)
    }

    if (msg.body) {
      const bodyText = document.createElement('div')
      bodyText.className = 'seed-body-text fg7'
      bodyText.innerHTML = dcssToHtml(msg.body)
      wrap.appendChild(bodyText)
    }

    const row = document.createElement('div')
    row.className = 'seed-input-row'
    const label = document.createElement('span')
    label.className = 'seed-input-label'
    label.textContent = 'Seed:'
    row.appendChild(label)

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'seed-input-field'
    input.autocomplete = 'off'
    input.autocapitalize = 'off'
    input.spellcheck = false
    input.inputMode = 'numeric'
    input.pattern = '\\d*'
    // Revert non-digit input to the last valid value, matching the reference
    // client's _keyfun_seed_input behaviour. Stored on dataset so the
    // ui-state-sync handler can keep it in sync when the server pre-fills.
    input.dataset.lastValid = ''
    input.addEventListener('input', () => {
      if (!/^\d*$/.test(input.value)) {
        input.value = input.dataset.lastValid ?? ''
        return
      }
      input.dataset.lastValid = input.value
      if (genId === undefined) return
      conn.send({
        msg: 'ui_state_sync',
        widget_id: 'seed',
        text: input.value,
        cursor: input.selectionStart ?? input.value.length,
        generation_id: genId,
      })
    })
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        conn.send({ msg: 'key', keycode: 13 })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        conn.send({ msg: 'key', keycode: 27 })
      }
    })
    row.appendChild(input)

    function makeHotkeyBtn(textHtml: string, keycode: number): HTMLButtonElement {
      const btn = document.createElement('button')
      btn.className = 'seed-btn'
      btn.innerHTML = dcssToHtml(textHtml)
      btn.addEventListener('click', () => {
        conn.send({ msg: 'key', keycode })
        requestAnimationFrame(() => input.focus())
      })
      return btn
    }
    row.appendChild(makeHotkeyBtn('<brown>[-] Clear</brown>', 45))
    row.appendChild(makeHotkeyBtn('<brown>[d] Daily</brown>', 100))
    wrap.appendChild(row)

    if (msg.footer) {
      const footer = document.createElement('div')
      footer.className = 'seed-footer fg7'
      footer.innerHTML = dcssToHtml(msg.footer)
      wrap.appendChild(footer)
    }

    if (msg.show_pregen_toggle) {
      const pregenLabel = document.createElement('label')
      pregenLabel.className = 'seed-pregen'
      const pregen = document.createElement('input')
      pregen.type = 'checkbox'
      pregen.className = 'seed-pregen-checkbox'
      pregen.addEventListener('change', () => {
        if (genId === undefined) return
        conn.send({
          msg: 'ui_state_sync',
          widget_id: 'pregenerate',
          checked: pregen.checked,
          generation_id: genId,
        })
      })
      const txt = document.createElement('span')
      txt.textContent = 'Fully pregenerate the dungeon'
      pregenLabel.append(pregen, txt)
      wrap.appendChild(pregenLabel)
    }

    const bar = document.createElement('div')
    bar.className = 'seed-button-bar'
    const beginBtn = document.createElement('button')
    beginBtn.className = 'seed-btn seed-btn-primary'
    beginBtn.textContent = '[Enter] Begin!'
    beginBtn.addEventListener('click', () => {
      conn.send({ msg: 'key', keycode: 13 })
    })
    bar.appendChild(beginBtn)
    wrap.appendChild(bar)

    uiOverlay.appendChild(wrap)
    autoOpenKbd()
    requestAnimationFrame(() => input.focus())
  }

  function showRandomCombo(msg: UiPushMsg): void {
    const title = stripDcss(msg.prompt ?? msg.title ?? '')
    renderOverlay(title, () => {
      const bodyEl = document.createElement('div')
      bodyEl.className = 'overlay-body fg7'
      bodyEl.textContent = 'Do you want to play this combination?'
      uiOverlay.appendChild(bodyEl)

      const bar = document.createElement('div')
      bar.className = 'overlay-footer overlay-actions'
      const choices: Array<{ key: string; label: string }> = [
        { key: 'Y', label: 'Yes (Y)' },
        { key: 'n', label: 'Reroll (n)' },
        { key: 'q', label: 'Quit (q)' },
      ]
      for (const c of choices) {
        const btn = document.createElement('button')
        btn.className = 'action-btn'
        btn.textContent = c.label
        btn.addEventListener('click', () => {
          conn.send({ msg: 'input', text: c.key })
          view.focus({ preventScroll: true })
        })
        bar.appendChild(btn)
      }
      uiOverlay.appendChild(bar)
    })
  }

  function showNewgameChoice(msg: UiPushMsg): void {
    uiOverlay.innerHTML = ''
    uiOverlay.style.display = ''
    mapView.element.style.display = 'none'
    msgLog.style.display = 'none'
    hud.style.display = 'none'
    touchControls.element.style.display = 'none'
    if (spectating) {
      menuControls.style.display = 'none'
    } else {
      buildMenuControls()
      menuControls.style.display = ''
    }

    const wrap = document.createElement('div')
    wrap.className = 'ngc-wrap'
    uiOverlay.appendChild(wrap)

    const titleHtml = msg.title ?? msg.prompt ?? ''
    if (titleHtml) {
      const titleEl = document.createElement('div')
      titleEl.className = 'overlay-title'
      titleEl.innerHTML = dcssToHtml(titleHtml)
      wrap.appendChild(titleEl)
    }

    // Description panel updated on first tap; second tap on same item confirms
    const descEl = document.createElement('div')
    descEl.className = 'ngc-desc'
    descEl.innerHTML = '<em>Tap to preview, tap again to confirm.</em>'
    let pendingKey: string | null = null
    let pendingBtn: HTMLButtonElement | null = null

    function sendHotkey(hotkey: string | number | undefined): void {
      if (typeof hotkey === 'number') {
        // Non-printable (Bksp=8, Tab=9, Esc=27) must go via {key, keycode};
        // {input, text} is for printable chars only.
        if (hotkey < 32 || hotkey === 127) conn.send({ msg: 'key', keycode: hotkey })
        else conn.send({ msg: 'input', text: String.fromCharCode(hotkey) })
      } else if (hotkey) {
        conn.send({ msg: 'input', text: String(hotkey) })
      }
    }

    function makeBtnHandler(btn: NewgameButton, btnEl: HTMLButtonElement): () => void {
      const keyChar = typeof btn.hotkey === 'number' ? String.fromCharCode(btn.hotkey) : String(btn.hotkey ?? '')
      return () => {
        if (pendingKey === keyChar && pendingBtn === btnEl) {
          sendHotkey(btn.hotkey)
          view.focus({ preventScroll: true })
        } else {
          pendingBtn?.classList.remove('ngc-selected')
          pendingKey = keyChar
          pendingBtn = btnEl
          btnEl.classList.add('ngc-selected')
          const plain = stripDcss(String(btn.labels?.[0] ?? btn.label ?? '')).trim()
          const dashIdx = plain.indexOf(' - ')
          const name = dashIdx >= 0 ? plain.slice(dashIdx + 3) : plain
          const desc = btn.description ?? ''
          descEl.innerHTML =
            `<strong>${escHtml(name)}</strong>${desc ? `<br><span class="ngc-desc-text">${escHtml(desc)}</span>` : ''}<br><em class="ngc-confirm-hint">Tap again to confirm.</em>`
        }
        view.focus({ preventScroll: true })
      }
    }

    function buildGrid(items: NewgameItems, extraClass?: string): HTMLElement {
      const cols = items.width ?? 1
      const buttons = items.buttons ?? []
      const colLabels = items.labels ?? []

      const gridEl = document.createElement('div')
      gridEl.className = extraClass ? `ngc-grid ${extraClass}` : 'ngc-grid'
      gridEl.style.setProperty('--ngc-cols', String(cols))

      // Column header row (y:0 labels)
      if (colLabels.length > 0) {
        for (let c = 0; c < cols; c++) {
          const lbl = colLabels.find(l => l.x === c && l.y === 0)
          const hdr = document.createElement('div')
          hdr.className = 'ngc-col-header'
          if (lbl) hdr.innerHTML = dcssToHtml(lbl.label)
          gridEl.appendChild(hdr)
        }
      }

      // Sort buttons by row then column; fill gaps with empty divs
      const sorted = [...buttons].sort((a, b) => ((a.y ?? 0) - (b.y ?? 0)) || ((a.x ?? 0) - (b.x ?? 0)))
      let curRow = -1
      let curCol = 0

      for (const btn of sorted) {
        const bx = btn.x ?? 0
        const by = btn.y ?? 0
        if (by !== curRow) {
          // Pad rest of previous row
          while (curRow >= 0 && curCol < cols) { gridEl.appendChild(document.createElement('div')); curCol++ }
          curRow = by; curCol = 0
        }
        // Pad columns before this button
        while (curCol < bx) { gridEl.appendChild(document.createElement('div')); curCol++ }

        const labels = btn.labels ?? (btn.label !== undefined ? [btn.label] : [])
        const main = String(labels[0] ?? '').trim()
        const suffix = labels.length >= 2 ? String(labels[1]).trim() : ''
        const btnEl = document.createElement('button')
        btnEl.className = 'ngc-btn'
        if (suffix) {
          // Weapon menu: main label + apt suffix as right-aligned column
          const mainSpan = document.createElement('span')
          mainSpan.className = 'ngc-btn-main'
          mainSpan.innerHTML = dcssToHtml(main)
          const suffixSpan = document.createElement('span')
          suffixSpan.className = 'ngc-btn-suffix'
          suffixSpan.innerHTML = dcssToHtml(suffix)
          btnEl.append(mainSpan, suffixSpan)
        } else {
          btnEl.innerHTML = dcssToHtml(main)
        }
        btnEl.addEventListener('click', makeBtnHandler(btn, btnEl))
        gridEl.appendChild(btnEl)
        curCol++
      }
      return gridEl
    }

    const mainItems = msg['main-items']
    if (mainItems?.buttons?.length) {
      wrap.appendChild(buildGrid(mainItems))
    }

    wrap.appendChild(descEl)

    const subItems = msg['sub-items']
    if (subItems?.buttons?.length) {
      wrap.appendChild(buildGrid(subItems, 'ngc-sub-grid'))
    }

    view.focus({ preventScroll: true })
  }

  // --- CRT handler ---

  function showCrt(tag?: string): void {
    crtActive = true
    crtTag = tag
    crtLines.clear()
    menuShift.reset()
    mountCrtEl()
    if (tag === 'skills') {
      buildMenuControls(tag)
      menuControls.style.display = ''
    }
  }

  function restoreCrt(): void {
    mountCrtEl()
    if (crtTag === 'skills') {
      buildMenuControls(crtTag)
      menuControls.style.display = ''
    }
    renderCrtEl()
  }

  function mountCrtEl(): void {
    autoCloseKbdIfOurs()
    uiOverlay.innerHTML = ''
    uiOverlay.style.display = ''
    mapView.element.style.display = 'none'
    msgLog.style.display = 'none'
    hud.style.display = 'none'
    touchControls.element.style.display = 'none'
    menuControls.style.display = 'none'
    const el = document.createElement('div')
    el.id = 'crt-display'
    uiOverlay.appendChild(el)
    view.focus({ preventScroll: true })
  }

  function renderCrtEl(): void {
    const el = uiOverlay.querySelector('#crt-display')
    if (!el) return
    el.innerHTML = ''
    const maxKey = crtLines.size > 0 ? Math.max(...crtLines.keys()) : 0
    for (let i = 0; i <= maxKey; i++) {
      const line = document.createElement('div')
      line.className = 'crt-line'
      line.innerHTML = crtLines.get(i) ?? ''
      el.appendChild(line)
    }
    if (crtTag === 'skills') updateSkillLetterButtons()
  }

  function updateSkillLetterButtons(): void {
    const lines: string[] = []
    uiOverlay.querySelectorAll<HTMLElement>('.crt-line').forEach(line => {
      lines.push(line.textContent ?? '')
    })
    const letters = extractSkillHotkeys(lines)
    let row = menuControls.querySelector<HTMLElement>('.skill-letter-row')
    if (!row) {
      row = document.createElement('div')
      row.className = 'skill-letter-row'
      menuControls.insertBefore(row, menuControls.firstChild)
    }
    row.innerHTML = ''
    const shiftOn = menuShift.isOn
    for (const letter of letters) {
      const btn = document.createElement('button')
      btn.className = 'menu-ctrl-btn skill-letter-btn'
      btn.textContent = shiftOn && /[a-z]/.test(letter) ? letter.toUpperCase() : letter
      const fire = () => {
        const shiftedNow = menuShift.isOn
        const out = shiftedNow && /[a-z]/.test(letter) ? letter.toUpperCase() : letter
        conn.send({ msg: 'input', text: out })
        menuShift.consume()
      }
      btn.addEventListener('click', () => {
        fire()
        view.focus({ preventScroll: true })
      })
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        fire()
      }, { passive: false })
      row.appendChild(btn)
    }
  }

  function updateCrtLines(lines: Record<string, string>): void {
    for (const [k, v] of Object.entries(lines)) {
      crtLines.set(Number(k), v)
    }
    renderCrtEl()
  }

  // --- menu handler ---

  function glyphHtml(label: string): string {
    if (label === '⎋' || label === '⏎') return `<span class="menu-ctrl-glyph">${label}</span>`
    if (label.startsWith('⏎ ')) return `<span class="menu-ctrl-glyph">⏎</span> ${escHtml(label.slice(2))}`
    if (label.startsWith('⎋ ')) return `<span class="menu-ctrl-glyph">⎋</span> ${escHtml(label.slice(2))}`
    return escHtml(label)
  }

  function syncAcceptBtn(footerText: string): void {
    const btn = menuControls.querySelector<HTMLButtonElement>('[data-dynamic="accept"]')
    if (!btn) return
    const acceptMatch = footerText.match(/accept\s*(\(\d+ chosen\))/i)
    const buyMatch = /\[Enter\]\s+buy\s+marked\s+items/i.test(footerText)
    if (acceptMatch) btn.innerHTML = glyphHtml(`⏎ Accept ${acceptMatch[1]}`)
    else if (buyMatch) btn.innerHTML = glyphHtml('⏎ Buy marked items')
    else btn.innerHTML = glyphHtml('⏎')
  }

  function buildMenuControls(tag?: string, flags?: number): void {
    menuControls.innerHTML = ''
    type BtnDef = { label: string; key?: string; keycode?: number; dynamic?: true; shift?: true }
    // Server keeps the menu open for a (y/N) confirmation (e.g. shop purchase)
    // and signals it via input_mode=YESNO. Swap the row to Y/N so the user
    // has a way to answer without a keyboard.
    const yesnoActive = currentInputMode === MOUSE_MODE_YESNO
    let btns: BtnDef[]
    if (yesnoActive) {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: 'Y', key: 'y' },
        { label: 'N', key: 'n' },
      ]
    } else if (tag === 'shop') {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
        { label: '/', key: '/' },
        { label: '⇧', shift: true },
        { label: '⏎', keycode: 13, dynamic: true },
      ]
    } else if (tag === 'acquirement') {
      // AcquireMenu (acquire.cc): single-select, item hotkeys a-i via row taps.
      // ! cycles acquire/examine mode; selecting an item flips input_mode to
      // YESNO, which the yesnoActive branch above swaps in for confirmation.
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
      ]
    } else if (tag === 'stash') {
      // Stash-search results (Ctrl-F). Tap a row to open the X-mode preview;
      // enterXMode/exitXMode hide/restore this menu around the preview.
      // The three letter-keys mirror the cues the server prints in the menu
      // title:
      //   !  toggle travel/examine target mode
      //   /  cycle sort (alpha / by distance)
      //   =  hide useless & duplicates
      // No accept (⏎) button: with no visible default hover (see
      // menuHoverFromUser) there's no obvious target, and tapping a row
      // already activates it.
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
        { label: '/', key: '/' },
        { label: '=', key: '=' },
      ]
    } else if (tag === 'skills') {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '⇧', shift: true },
        { label: '?',   key: '?' },
        { label: '=',   key: '=' },
        { label: '-',   key: '-' },
        { label: '/',   key: '/' },
        { label: '*',   key: '*' },
        { label: '_',   key: '_' },
        { label: '!',   key: '!' },
      ]
    } else if (flags !== undefined && (flags & MF_MULTISELECT)) {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '⏎', keycode: 13, dynamic: true },
      ]
    } else {
      btns = [{ label: '⎋', keycode: 27 }]
    }
    for (const def of btns) {
      const btn = document.createElement('button')
      btn.className = 'menu-ctrl-btn'
      btn.innerHTML = glyphHtml(def.label)
      if (def.dynamic) btn.dataset.dynamic = 'accept'
      if (def.shift) {
        btn.dataset.shift = 'true'
        applyShiftBtnState(btn)
        btn.addEventListener('click', () => {
          menuShift.tap()
          view.focus({ preventScroll: true })
        })
        btn.addEventListener('touchstart', (e) => {
          e.preventDefault()
          menuShift.tap()
        }, { passive: false })
      } else {
        btn.addEventListener('click', () => {
          if (def.key) conn.send({ msg: 'input', text: def.key })
          else if (def.keycode) conn.send({ msg: 'key', keycode: def.keycode })
          view.focus({ preventScroll: true })
        })
        btn.addEventListener('touchstart', (e) => {
          e.preventDefault()
          if (def.key) conn.send({ msg: 'input', text: def.key })
          else if (def.keycode) conn.send({ msg: 'key', keycode: def.keycode })
        }, { passive: false })
      }
      menuControls.appendChild(btn)
    }
  }

  function applyShiftBtnState(btn: HTMLElement): void {
    btn.classList.toggle('active', menuShift.state === 'once')
    btn.classList.toggle('locked', menuShift.state === 'lock')
  }

  function refreshShiftUI(): void {
    const btn = menuControls.querySelector<HTMLElement>('[data-shift="true"]')
    if (btn) applyShiftBtnState(btn)
    syncMenuShiftLabels()
  }

  function syncMenuShiftLabels(): void {
    // Shop item hotkeys are rendered into .overlay-list rows; skill-letter
    // buttons live in the menu-controls bar. Update both so what the user
    // sees matches what tapping will send.
    const shiftOn = menuShift.isOn
    if (activeMenu?.tag === 'shop') {
      const listEl = uiOverlay.querySelector('.overlay-list')
      listEl?.querySelectorAll<HTMLElement>('.overlay-item .overlay-key').forEach(el => {
        const t = el.textContent ?? ''
        if (t.length === 1 && /[a-zA-Z]/.test(t)) {
          el.textContent = shiftOn ? t.toUpperCase() : t.toLowerCase()
        }
      })
    }
    menuControls.querySelectorAll<HTMLElement>('.skill-letter-btn').forEach(el => {
      const t = el.textContent ?? ''
      if (t.length === 1 && /[a-zA-Z]/.test(t)) {
        el.textContent = shiftOn ? t.toUpperCase() : t.toLowerCase()
      }
    })
  }

  // scroll=false when the caller already positioned the list (paging) and
  // scrollIntoView would fight the manual scroll.
  function highlightHoveredRow(scroll = true): void {
    uiOverlay.querySelectorAll<HTMLElement>('.item-hovered').forEach(el => el.classList.remove('item-hovered'))
    const el = uiOverlay.querySelector<HTMLElement>(`[data-menu-idx="${hoveredMenuIdx}"]`)
    if (el) {
      el.classList.add('item-hovered')
      if (scroll) el.scrollIntoView({ block: 'nearest' })
    }
  }

  // Reflect a server-reported hover (echo of our own menu_hover/menu_scroll,
  // or any server-initiated move). Keeps menuServerHover in sync so the next
  // client-side move computes from the right place.
  //
  // Suppress scrollIntoView when `raw === menuServerHover` — that's the echo
  // of a hover change we just sent, so the caller (pageMenu/jumpMenu) already
  // positioned the list. `block:'nearest'` is *usually* a no-op when the row
  // is in view, but a coalesced lead can be taller than the viewport, in
  // which case 'nearest' would align its bottom and undo the page scroll.
  // Genuine server-initiated moves see `raw !== menuServerHover` and still
  // scroll the row into view.
  function applyServerHover(raw: number): void {
    if (!menuHoverFromUser) return  // see menuHoverFromUser declaration
    const isEcho = raw === menuServerHover
    menuServerHover = raw
    hoveredMenuIdx = raw
    highlightHoveredRow(!isEcho)
  }

  function menuItemSelectable(it: MenuItem | undefined): boolean {
    return !!it && it.level === 2
      && (activeMenu?.tag === 'use_item' || !!(it.hotkeys && it.hotkeys.length))
  }

  // Based on next_hoverable_item, we scan the authoritative server
  // item array (the index space menu_hover expects) for the next
  // selectable entry, honouring MF_WRAP and the "up with no hover does
  // nothing" bound.
  function nextHoverableMenuItem(reverse: boolean, start: number): number {
    const items = activeMenu?.items ?? []
    const n = items.length
    if (n === 0) return -1
    const wrap = ((activeMenu?.flags ?? 0) & MF_WRAP) !== 0
    const maxItems = wrap ? n : reverse ? start : n - Math.max(start, 0)
    if (maxItems <= 0) return -1
    let h = start
    if (reverse && h < 0) h = 0
    h += reverse ? -1 : 1
    for (let tried = 0; tried < maxItems; tried++) {
      if (wrap) h = ((h % n) + n) % n
      h = Math.max(0, Math.min(h, n - 1))
      if (menuItemSelectable(items[h])) return h
      h += reverse ? -1 : 1
    }
    return -1
  }

  function setMenuHover(idx: number, scroll = true): void {
    if (idx < 0) return
    menuHoverFromUser = true
    if (idx === menuServerHover) {
      highlightHoveredRow(scroll)
      return
    }
    menuServerHover = idx
    hoveredMenuIdx = idx
    highlightHoveredRow(scroll)
    // Drive the server's cursor directly instead of letting it cycle_hover
    // off a forwarded arrow key (which is hotkey-blind). Do not also forward
    // the raw key — that would double-move.
    conn.send({ msg: 'menu_hover', hover: idx, mouse: false })
  }

  function cycleMenuHover(reverse: boolean): void {
    const next = nextHoverableMenuItem(reverse, menuServerHover)
    if (next !== -1) setMenuHover(next)
  }

  function menuListEl(): HTMLElement | null {
    return uiOverlay.querySelector<HTMLElement>('.overlay-list')
  }

  const firstSelectableIdx = (): number => nextHoverableMenuItem(false, -1)
  const lastSelectableIdx = (): number =>
    nextHoverableMenuItem(true, activeMenu?.items?.length ?? 0)

  // The rendered rows whose box intersects the list viewport, in DOM order
  // (= server-index order; continuations/headers carry no data-menu-idx).
  function visibleMenuRows(el: HTMLElement): HTMLElement[] {
    const lr = el.getBoundingClientRect()
    return [...el.querySelectorAll<HTMLElement>('[data-menu-idx]')].filter(r => {
      const rr = r.getBoundingClientRect()
      return rr.bottom > lr.top + 1 && rr.top < lr.bottom - 1
    })
  }

  function firstSelectableVisibleIdx(el: HTMLElement): number {
    for (const r of visibleMenuRows(el)) {
      const i = Number(r.dataset.menuIdx)
      if (menuItemSelectable(activeMenu?.items?.[i])) return i
    }
    return -1
  }

  // Webtiles menu paging is client-side; the server only needs the resulting
  // visible range + hover so it can stream item chunks for large/lazy menus
  // (reference update_server_scroll). Harmless no-op for fully-loaded menus.
  function sendMenuScroll(el: HTMLElement): void {
    const vis = visibleMenuRows(el)
    if (vis.length === 0) return
    conn.send({
      msg: 'menu_scroll',
      first: Number(vis[0].dataset.menuIdx),
      last: Number(vis[vis.length - 1].dataset.menuIdx),
      hover: menuServerHover,
    })
  }

  function pageMenu(up: boolean): void {
    const el = menuListEl()
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const delta = Math.max(40, el.clientHeight - 24)  // slight overlap
    el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + (up ? -delta : delta)))
    const target = up && el.scrollTop <= 0 ? firstSelectableIdx()
      : !up && el.scrollTop >= max - 1 ? lastSelectableIdx()
      : firstSelectableVisibleIdx(el)
    if (target >= 0) setMenuHover(target, false)
    sendMenuScroll(el)
  }

  function jumpMenu(toEnd: boolean): void {
    const el = menuListEl()
    if (!el) return
    el.scrollTop = toEnd ? el.scrollHeight : 0
    setMenuHover(toEnd ? lastSelectableIdx() : firstSelectableIdx(), false)
    sendMenuScroll(el)
  }

  // A rendered, arrow-selectable menu overlay is up: arrow input should drive
  // hover client-side (send menu_hover) rather than be forwarded as a raw
  // key. Skipped during the stash X-mode preview — the menu is hidden behind
  // the map and arrows must reach the server to move the cursor.
  function menuNavActive(): boolean {
    return !!activeMenu && !crtActive && !inXMode
      && (((activeMenu.flags ?? 0) & MF_ARROWS_SELECT) !== 0)
      && !!uiOverlay.querySelector('.overlay-list')
  }

  // Returns true if the key was a menu-nav key we handled client-side.
  function handleMenuNavKey(e: KeyboardEvent): boolean {
    if (!menuNavActive()) return false
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); cycleMenuHover(false); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); cycleMenuHover(true); return true }
    if (e.key === 'PageDown') { e.preventDefault(); pageMenu(false); return true }
    if (e.key === 'PageUp') { e.preventDefault(); pageMenu(true); return true }
    if (e.key === 'Home') { e.preventDefault(); jumpMenu(false); return true }
    if (e.key === 'End') { e.preventDefault(); jumpMenu(true); return true }
    return false
  }

  function showMenu(msg: MenuMsg): void {
    if (activeMenu !== msg) {
      hoveredMenuIdx = -1
      menuServerHover = -1
      menuHoverFromUser = false
      menuShift.reset()
    }
    activeMenu = msg
    const title = stripDcss(msg.title?.text ?? '')
    renderOverlay(title, () => {
      renderMenuItems(msg.items ?? [])
      const footerEl = document.createElement('div')
      footerEl.className = 'overlay-footer'
      footerEl.innerHTML = formatMoreHtml(msg.more ?? '', 'top')
      uiOverlay.appendChild(footerEl)
    })
    if (msg.tag === 'shop' || msg.tag === 'stash' || msg.tag === 'acquirement') {
      buildMenuControls(msg.tag, msg.flags)
      menuControls.style.display = ''
      touchControls.element.style.display = 'none'
    }
    syncAcceptBtn(formatMore(msg.more ?? '', 'top'))
    if (msg.more?.includes('XXX')) {
      const listEl = uiOverlay.querySelector<HTMLElement>('.overlay-list')
      const footerEl = uiOverlay.querySelector<HTMLElement>('.overlay-footer')
      if (listEl && footerEl) {
        listEl.addEventListener('scroll', () => {
          if (activeMenu?.more) {
            const pos = computeScrollPos(listEl)
            footerEl.innerHTML = formatMoreHtml(activeMenu.more, pos)
          }
        }, { passive: true })
      }
    }
  }

  function updateMenuItems(msg: MenuMsg): void {
    if (!msg.items) return
    const listEl = uiOverlay.querySelector<HTMLElement>('.overlay-list')
    if (listEl) {
      const savedScrollTop = listEl.scrollTop
      listEl.remove()
      const footer = uiOverlay.querySelector('.overlay-footer')
      const newList = document.createElement('div')
      newList.className = 'overlay-list'
      fillMenuItems(newList, msg.items)
      uiOverlay.insertBefore(newList, footer)
      newList.scrollTop = savedScrollTop
    } else {
      renderMenuItems(msg.items)
    }
    syncMenuShiftLabels()
  }

  function renderMenuItems(items: MenuItem[]): void {
    const listEl = document.createElement('div')
    listEl.className = 'overlay-list'
    fillMenuItems(listEl, items)
    const footer = uiOverlay.querySelector('.overlay-footer')
    uiOverlay.insertBefore(listEl, footer)
    syncMenuShiftLabels()
  }

  // DCSS's "examine visible things" menu (directn.cc _full_describe_menu)
  // pre-wraps each monster's equipment description for an 80-col terminal and
  // emits it as several entries: one hotkeyed lead row plus hotkey-less
  // continuation rows whose text is prefixed with exactly 9 literal spaces
  // (directn.cc:621). Rendering each as its own row double-wraps on a phone
  // and loses the grouping. Fold continuations back into their lead so the
  // whole description is one tappable item that wraps to the live viewport.
  //
  // The ≥6-space threshold is load-bearing, not cosmetic. Inventory
  // (invent.cc:73), spellbook, quiver and mutation menus set
  // `indent_no_hotkeys`, giving every hotkey-less item a *5-space* preface
  // (menu.cc:2355); matching ≥2 would wrongly merge an indented hotkey-less
  // inventory line into the hotkeyed line above it. directn.cc is the only
  // menu emitting the lead+continuation idiom, and its 9-space prefix is the
  // only menu source of ≥6-space leading indent — so ≥6 captures exactly it
  // and nothing else (both the 9 and the 5 are hardcoded literals, stable
  // across versions). Clone the lead before mutating — fillMenuItems re-runs
  // on the same activeMenu.items array on every update_menu_items patch.
  function coalesceMenuItems(items: MenuItem[]): { item: MenuItem; idx: number }[] {
    const out: { item: MenuItem; idx: number }[] = []
    let lead: { item: MenuItem; idx: number } | null = null
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const isItem = item.level !== 0 && item.level !== 1
      const noHotkey = !item.hotkeys || item.hotkeys.length === 0
      const raw = String(item.text ?? '')
      if (lead && isItem && noHotkey && /^\s{6,}\S/.test(raw)) {
        lead.item = { ...lead.item, text: `${lead.item.text ?? ''} ${raw.trim()}` }
        continue
      }
      const entry = { item, idx: i }
      out.push(entry)
      lead = isItem && !noHotkey ? entry : null
    }
    return out
  }

  function fillMenuItems(listEl: HTMLElement, rawItems: MenuItem[]): void {
    const coalesced = coalesceMenuItems(rawItems)
    for (let c = 0; c < coalesced.length; c++) {
      const { item, idx: i } = coalesced[c]
      if (item.level === 0) continue  // separator
      if (item.level === 1) {         // section header
        const hdr = document.createElement('div')
        hdr.className = 'overlay-header'
        if (item.colour != null) hdr.style.color = uiColor(item.colour)
        hdr.innerHTML = dcssToHtml(String(item.text ?? ''))
        listEl.appendChild(hdr)
      } else {                        // level 2: selectable item
        const keycode = item.hotkeys?.[0]
        const keyLabel = keycode != null ? keypressLabel(keycode) : ''
        let rawText = String(item.text ?? '').trimStart()
        // Two prefix shapes to handle:
        //
        //  1) Gods menu (god-menu.cc): " <yellow>A</yellow> - Ashenzari"
        //     — the hotkey is wrapped in a matched colour pair; separator
        //     and name are outside the pair. Strip the whole pair so the
        //     deity name renders in the default menu colour (matching the
        //     upstream client). The wrap colour still drives the hotkey
        //     span via keyColor.
        //
        //  2) Shop rows: "<lightgreen>a - </lightgreen><lightgrey>72 gold
        //     ...</lightgrey>" — the opening tag spans the whole prefix
        //     and is meant to colour the row (affordability). Preserve
        //     that opening tag in the label so the colour carries onto
        //     the rest of the row.
        let separator = '-'
        let keyTagName: string | undefined
        const wrappedHotkey = rawText.match(/^<([a-zA-Z]+)>.<\/\1>\s([-+# $])\s/)
        if (wrappedHotkey) {
          separator = wrappedHotkey[2]
          keyTagName = wrappedHotkey[1].toLowerCase()
          rawText = rawText.replace(/^<[a-zA-Z]+>.<\/[a-zA-Z]+>\s[-+# $]\s/, '')
        } else {
          const stateMatch = rawText.match(/^(?:<[^>]+>)*.\s([-+# $])\s/)
          if (stateMatch) separator = stateMatch[1]
          keyTagName = rawText.match(/^<([a-zA-Z]+)>/)?.[1]?.toLowerCase()
          rawText = rawText.replace(/^((?:<[^>]+>)*).\s[-+# $]\s/, '$1')
        }
        const labelHtml = dcssToHtml(rawText)
        const itemColor = item.colour != null ? uiColor(item.colour) : undefined
        const keyColor = (keyTagName && DCSS_COLOR_MAP[keyTagName]) || itemColor
        const el = makeItemButton(keyLabel, labelHtml, () => {
          // Shop shift-tap: shopping list uses the uppercase letter as a direct
          // keybind (shopping.cc), separate from the arrows-select activate-on-
          // hover path — so route it before the MF_ARROWS_SELECT branch below,
          // which would otherwise preempt it with Space and just mark for
          // purchase.
          if (
            activeMenu?.tag === 'shop'
            && menuShift.isOn
            && keycode != null
            && keycode >= 97 && keycode <= 122
          ) {
            conn.send({ msg: 'key', keycode: keycode - 32 })
            menuShift.consume()
            return
          }
          // ARROWS_SELECT menus expect activation against the current hover,
          // not via row hotkeys: Enter for singleselect, Space for multiselect
          // (upstream menu.js:1066). Move server hover to the tapped row and
          // then send the activation key — leaves server state matching the
          // user's tap target. (For stash search, sending the row's letter
          // would happen to produce the same visible X-mode preview, but the
          // upstream protocol path is more robust.)
          const flags = activeMenu?.flags ?? 0
          if (flags & MF_ARROWS_SELECT) {
            setMenuHover(i, false)
            const activateKey = (flags & MF_MULTISELECT) ? 32 : 13
            conn.send({ msg: 'key', keycode: activateKey })
            menuShift.consume()
            return
          }
          if (keycode == null) return
          conn.send({ msg: 'key', keycode })
          menuShift.consume()
        }, itemColor, separator, keyColor)
        if (item.tiles && item.tiles.length > 0) {
          el.insertBefore(renderTiles(item.tiles), el.firstChild)
        }
        el.dataset.menuIdx = String(i)
        if (separator === '+') el.classList.add('item-selected')
        if (i === hoveredMenuIdx) el.classList.add('item-hovered')
        listEl.appendChild(el)
      }
    }
  }

  // --- Monster panel (client-side overlay) ---

  function openMonsterPanel(): void {
    monsterPanelOpen = true
    renderOverlay('Monsters', () => {
      // Client-only overlay: hide the touch d-pad (its Esc would send Esc to
      // the server, which is not what we want for a local panel) and add an
      // inline close button to the header.
      const headerEl = uiOverlay.querySelector('.overlay-title')
      if (headerEl) {
        const closeBtn = document.createElement('button')
        closeBtn.className = 'overlay-close'
        closeBtn.textContent = '×'
        closeBtn.addEventListener('click', () => closeMonsterPanel())
        headerEl.appendChild(closeBtn)
      }
      const body = document.createElement('div')
      body.className = 'overlay-body fg7'
      body.appendChild(monsterPanel.element)
      uiOverlay.appendChild(body)
    })
    touchControls.element.style.display = 'none'

    monsterPanel.setOnPickCoord((x, y) => {
      if (uiStack.length === 0 && !crtActive && !activeMenu) {
        // Leave the overlay frame up: the server's describe-monster ui-push
        // will land in renderOverlay and swap the body in place, avoiding a
        // brief flash of the bare map between close and re-open. The ui-push
        // handler clears monsterPanelOpen, so the keyboard guard hands off.
        conn.send({ msg: 'click_cell', x, y, button: 3 })
      } else {
        closeMonsterPanel()
      }
    })
    monsterPanel.update(store.getMonsters())
  }

  function closeMonsterPanel(): void {
    if (!monsterPanelOpen) return
    monsterPanelOpen = false
    hideOverlay()  // restores map/hud/msglog/touch via standard restore path
  }

  // --- shared overlay helpers ---

  function renderOverlay(title: string, buildBody: () => void): void {
    autoCloseKbdIfOurs()
    uiOverlay.innerHTML = ''
    uiOverlay.style.display = ''
    mapView.element.style.display = 'none'
    msgLog.style.display = 'none'
    hud.style.display = 'none'
    touchControls.element.style.display = ''
    menuControls.style.display = 'none'
    menuControls.innerHTML = ''

    const headerEl = document.createElement('div')
    // fg15 (white) by default so unstyled titles read brighter than the
    // fg7 (lightgrey) body content; explicit DCSS colour tags override.
    headerEl.className = 'overlay-title fg15'
    const titleSpan = document.createElement('span')
    titleSpan.textContent = title
    headerEl.appendChild(titleSpan)
    uiOverlay.appendChild(headerEl)

    buildBody()
    // No close button: dismissal goes through the touch-controls Esc, which
    // is always reachable for server-driven overlays. Drop the header when it
    // ends up with nothing (no title, no tile inserted by buildBody) so help
    // popups don't render a blank bar.
    if (!title && headerEl.children.length === 1) headerEl.remove()
    view.focus({ preventScroll: true })
  }

  // --- formatted-scroller: client-owned scroll widget ---
  //
  // Per the reference client (ui-layouts.js:613 scroller_handle_key,
  // :720 update_server_scroll, :1066 recv_ui_scroll), the formatted-scroller's
  // scrollbar is owned by the *client*: page/arrow/home/end keys scroll the
  // body locally, the new position is debounced back to the server as
  // `formatted_scroller_scroll`, and server-pushed scrolls with
  // `from_webtiles=true` are skipped (they're the server echoing our own
  // request). `ui-scroller-scroll` messages are ignored entirely when the
  // top popup is a formatted-scroller — the server emits them with a
  // hardcoded `from_webtiles: false` (ui.cc:1501-1503 says "always false,
  // since we do not yet synchronize webtiles client-side scrolls"), so the
  // ui-state pair is the sole valid sync channel here.
  //
  // We follow this model. Passing End/Home/PgUp/PgDn through as raw
  // keycodes doesn't work on phone widths because we wrap differently from
  // the server, so the server-clamped scroll value lands above our real
  // bottom and the user sees a visible jump-back-up.

  const SCROLLER_SYNC_DEBOUNCE_MS = 100

  function formattedScrollerActive(): boolean {
    return uiStack.length > 0
      && uiStack[uiStack.length - 1].type === 'formatted-scroller'
      && !!uiOverlay.querySelector('.overlay-body')
  }

  let scrollerSyncTimer: number | undefined
  function scheduleScrollerSync(): void {
    if (scrollerSyncTimer !== undefined) return
    scrollerSyncTimer = window.setTimeout(flushScrollerSync, SCROLLER_SYNC_DEBOUNCE_MS)
  }
  function flushScrollerSync(): void {
    scrollerSyncTimer = undefined
    if (!formattedScrollerActive()) return
    const el = uiOverlay.querySelector<HTMLElement>('.overlay-body')
    if (!el) return
    // Reference client: `Math.round(scrollTop / line_height)`. The value the
    // server stores is opaque to it (m_scroll is just a saved position; see
    // scroller.cc:166); a wrap-induced drift of a few rows on the server's
    // side is harmless because we never read it back — from_webtiles=true
    // skips the echo.
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 19
    const line = Math.max(0, Math.round(el.scrollTop / lineH))
    conn.send({ msg: 'formatted_scroller_scroll', scroll: line })
  }

  // Programmatic scrollTop assignment fires a scroll event asynchronously.
  // Suppress sync for a short window so a server-driven scrollOverlayBody
  // doesn't bounce its value straight back through formatted_scroller_scroll.
  let scrollerSyncSuppressUntil = 0
  function suppressScrollerSync(): void {
    scrollerSyncSuppressUntil = performance.now() + 50
  }
  function onScrollerScroll(): void {
    if (performance.now() < scrollerSyncSuppressUntil) return
    scheduleScrollerSync()
  }
  function attachScrollerListener(bodyEl: HTMLElement): void {
    bodyEl.addEventListener('scroll', onScrollerScroll, { passive: true })
  }

  // Client-side scroll-key interception. Returns true when handled so the
  // caller stops routing the key further (mirrors handleMenuNavKey).
  function handleScrollerKey(e: KeyboardEvent): boolean {
    if (!formattedScrollerActive()) return false
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false
    const el = uiOverlay.querySelector<HTMLElement>('.overlay-body')
    if (!el) return false
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 19
    const page = Math.max(lineH, el.clientHeight - 2 * lineH)
    switch (e.key) {
      case 'ArrowUp':   el.scrollTop -= lineH; break
      case 'ArrowDown': el.scrollTop += lineH; break
      case 'PageUp': case '<': case '-': case ';':
        el.scrollTop -= page; break
      case 'PageDown': case ' ': case '>': case '+': case "'":
        el.scrollTop += page; break
      case 'Home': el.scrollTop = 0; break
      case 'End':  el.scrollTop = el.scrollHeight; break
      default: return false
    }
    e.preventDefault()
    return true
  }

  // Touch-controls equivalent (the d-pad / macro buttons emit wire keycodes
  // through the connection send path, not DOM key events).
  function handleScrollerKeycode(keycode: number): boolean {
    if (!formattedScrollerActive()) return false
    const el = uiOverlay.querySelector<HTMLElement>('.overlay-body')
    if (!el) return false
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 19
    const page = Math.max(lineH, el.clientHeight - 2 * lineH)
    switch (keycode) {
      case CK_UP:   el.scrollTop -= lineH; return true
      case CK_DOWN: el.scrollTop += lineH; return true
      case CK_PGUP: el.scrollTop -= page; return true
      case CK_PGDN: el.scrollTop += page; return true
      case CK_HOME: el.scrollTop = 0; return true
      case CK_END:  el.scrollTop = el.scrollHeight; return true
    }
    return false
  }

  function scrollOverlayBody(line: number): void {
    const el = uiOverlay.querySelector('.overlay-body') as HTMLElement | null
    if (!el) return
    // Setting scrollTop synchronously (reading scrollHeight/offsetTop forces
    // a layout flush) lands the position before the next paint; an rAF wait
    // would let the user see one paint at the wrong position on a fresh
    // open. Suppress the resulting scroll event so the listener doesn't
    // echo our value back to the server.
    suppressScrollerSync()
    if (line === 2147483647) {
      el.scrollTop = el.scrollHeight
      return
    }
    // The server sends `line` as a source-text line index (count of `\n`s
    // before the section header — see _get_help_section in command.cc, where
    // webtiles-mode line_height is 1). renderBodyLines emits one
    // `.overlay-line` per source line, so the index maps directly. We can't
    // use `line * lineHeight` like the reference client does because long
    // manual lines wrap on a phone-width body, so source lines and rendered
    // rows diverge.
    const lines = el.querySelectorAll<HTMLElement>('.overlay-line')
    const target = lines[line]
    if (target) {
      el.scrollTop = target.offsetTop - el.offsetTop
      return
    }
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 19
    el.scrollTop = Math.round(line * lineH)
  }

  function hideOverlay(): void {
    autoCloseKbdIfOurs()
    uiOverlay.style.display = 'none'
    uiOverlay.innerHTML = ''
    mapView.element.style.display = ''
    menuControls.style.display = 'none'
    menuControls.innerHTML = ''
    if (!inXMode) {
      msgLog.style.display = ''
      hud.style.display = ''
    }
    touchControls.element.style.display = ''
    requestAnimationFrame(() => {
      mapView.fitToContainer()
      view.focus({ preventScroll: true })
    })
  }

  function makeItemButton(key: string, labelHtml: string, onClick: () => void, color?: string, separator = '–', keyColor?: string): HTMLButtonElement {
    const el = document.createElement('button')
    el.className = 'overlay-item'
    const labelStyle = color ? ` style="color:${color}"` : ''
    const keyStyle = keyColor ? ` style="color:${keyColor}"` : ''
    const sepHtml = key
      ? ` <span class="overlay-sep" data-sep="${escHtml(separator)}">${escHtml(separator)}</span> `
      : ''
    el.innerHTML = `<span class="overlay-key"${keyStyle}>${escHtml(key)}</span>${sepHtml}<span class="overlay-label"${labelStyle}>${labelHtml}</span>`
    el.addEventListener('click', () => {
      onClick()
      view.focus({ preventScroll: true })
    })
    return el
  }

  function showMoreBtn(text?: string): void {
    moreBtn.textContent = text || '— more —'
    moreBtn.style.display = ''
  }

  function hideMoreBtn(): void {
    moreBtn.style.display = 'none'
  }

  function disableActivePrompt(): void {
    activePromptEl?.querySelectorAll('button').forEach(b => { (b as HTMLButtonElement).disabled = true })
    activePromptEl = null
  }

  function removeTextInput(): void {
    const row = msgLog.querySelector<HTMLElement>('.game-text-input-row')
    if (!row) return
    row.remove()
    autoCloseKbdIfOurs()
  }

  function removeNumpadInput(): void {
    if (numpadInput.style.display === 'none') return
    numpadInput.style.display = 'none'
    numpadInput.innerHTML = ''
    radiusNumpadActive = false
  }

  // On-screen numpad for numeric `init_input` prompts (e.g. skill targets).
  // Each digit/dot tap sends a printable keystroke to the server, which
  // echoes back via `txt` directly into the highlighted cell — no local
  // input buffer needed. The server's line_reader sits in OVERWRITE mode
  // with the prefill selected, so the first keypress replaces it.
  //
  // `closeAfterDigit` mode services X-mode 'R' (exclusion radius), where
  // the server's getchm() reads exactly one digit and resumes immediately.
  // No prompt is sent for this — we open it client-side after seeing the
  // outbound 'R' (see afterUserSend).
  function showNumpadInput(prompt: string, opts?: { closeAfterDigit?: boolean }): void {
    removeNumpadInput()
    numpadInput.style.display = ''
    radiusNumpadActive = opts?.closeAfterDigit ?? false

    if (prompt) {
      const header = document.createElement('div')
      header.className = 'numpad-prompt'
      header.innerHTML = dcssToHtml(prompt)
      numpadInput.appendChild(header)
    }

    const grid = document.createElement('div')
    grid.className = 'numpad-grid'

    // When radiusNumpadActive, the server is blocked in a getchm()
    // (CMD_MAP_EXCLUDE_RADIUS, viewmap.cc:1101) reading exactly one keystroke.
    // Whatever we send is computed as `key - '0'` and passed to set_exclude();
    // for any non-digit key the resulting negative radius is visibly
    // equivalent to 0 (single cell), because add_exclude_points'
    // radius_iterator gives up for r < 1 while the root cell still gets
    // PD_EXCLUDED. So we just close on any tap and dispatch the button's
    // native message — matches upstream wire behavior exactly.
    function sendChar(ch: string): void {
      conn.send({ msg: 'input', text: ch })
      if (radiusNumpadActive) removeNumpadInput()
    }
    function sendKey(keycode: number): void {
      conn.send({ msg: 'key', keycode })
      if (radiusNumpadActive) removeNumpadInput()
    }

    type Btn = { label: string; kind: 'digit' | 'action' | 'primary'; onTap: () => void }
    // iPhone Numbers-style layout: 7-8-9 across the top, action keys in the
    // right column. Enter spans two rows at the bottom-right (matches the
    // tall return key on iOS); digits/`.`/`−` live on the "key" tier, action
    // keys (⌫, ⎋, ⏎) on a recessed darker tier.
    const btns: Btn[] = [
      { label: '7', kind: 'digit', onTap: () => sendChar('7') },
      { label: '8', kind: 'digit', onTap: () => sendChar('8') },
      { label: '9', kind: 'digit', onTap: () => sendChar('9') },
      { label: '⌫', kind: 'action', onTap: () => sendKey(8) },
      { label: '4', kind: 'digit', onTap: () => sendChar('4') },
      { label: '5', kind: 'digit', onTap: () => sendChar('5') },
      { label: '6', kind: 'digit', onTap: () => sendChar('6') },
      { label: '⎋', kind: 'action', onTap: () => sendKey(27) },
      { label: '1', kind: 'digit', onTap: () => sendChar('1') },
      { label: '2', kind: 'digit', onTap: () => sendChar('2') },
      { label: '3', kind: 'digit', onTap: () => sendChar('3') },
      { label: '⏎', kind: 'primary', onTap: () => sendKey(13) },
      { label: '−', kind: 'digit', onTap: () => sendChar('-') },
      { label: '0', kind: 'digit', onTap: () => sendChar('0') },
      { label: '.', kind: 'digit', onTap: () => sendChar('.') },
    ]
    for (const b of btns) {
      const btn = document.createElement('button')
      btn.className = `numpad-btn numpad-${b.kind}`
      btn.textContent = b.label
      btn.addEventListener('click', () => {
        b.onTap()
        view.focus({ preventScroll: true })
      })
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        b.onTap()
      }, { passive: false })
      grid.appendChild(btn)
    }
    numpadInput.appendChild(grid)
  }

  function showTextInput(prefill: string, maxlen: number): void {
    removeTextInput()
    const row = document.createElement('p')
    row.className = 'game-msg game-text-input-row'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'game-text-input'
    input.inputMode = 'none'
    input.autocapitalize = 'off'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.value = prefill
    input.maxLength = maxlen
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        const text = input.value + '\r'
        removeTextInput()
        conn.send({ msg: 'text_input', text })
        view.focus({ preventScroll: true })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        removeTextInput()
        conn.send({ msg: 'key', keycode: 27 })
        view.focus({ preventScroll: true })
      }
    })
    row.appendChild(input)
    msgLog.appendChild(row)
    msgLog.scrollTop = msgLog.scrollHeight
    requestAnimationFrame(() => input.focus())
    autoOpenKbd()
  }

  function makePromptRow(text: string): HTMLElement {
    const row = document.createElement('p')
    row.className = 'game-msg game-prompt'
    // Carry a prefix-glyph slot like other .game-msg rows so markLastMsg
    // can land turn/cmd markers here too (matches reference, where every
    // .game_message has a .prefix_glyph).
    const mark = document.createElement('span')
    mark.className = 'msg-turn-mark'
    mark.textContent = ' '
    row.appendChild(mark)
    const parsed = parsePromptText(text)
    if (parsed.color) row.style.color = parsed.color
    // Trigger gate is wider than the per-token matcher, so a message can
    // pass the gate without producing any buttons (e.g. the inventory
    // "<w>?</w> for menu" hint sits mid-token). Fall back to rendering
    // the body in one shot through dcssToHtml — that preserves any
    // inline markup the comma/or split would have broken.
    if (!parsed.hasButton) {
      const body = document.createElement('span')
      body.innerHTML = dcssToHtml(parsed.body)
      row.appendChild(body)
      return row
    }
    for (const seg of parsed.segments) {
      if (seg.kind === 'text') {
        const span = document.createElement('span')
        span.innerHTML = dcssToHtml(seg.value)
        row.appendChild(span)
      } else {
        appendActionBtn(row, seg.label, seg.key)
      }
    }
    return row
  }

  function appendActionBtn(row: HTMLElement, label: string, key: string): void {
    const btn = document.createElement('button')
    btn.className = 'action-btn'
    btn.innerHTML = dcssToHtml(label)
    btn.addEventListener('click', () => {
      conn.send({ msg: 'input', text: key })
      view.focus({ preventScroll: true })
    })
    row.appendChild(btn)
  }

  function buildActionsBar(actionsText: string): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'overlay-footer overlay-actions'
    const tokens = actionsText.replace(/\.\s*$/, '').split(/,\s*|\s+or\s+/)
    for (const token of tokens) {
      // ", or " gets split into ", " + "or X" because the comma alternative
      // wins first; drop the vestigial "or " so labels read as plain items.
      const t = token.trim().replace(/^or\s+/, '')
      if (!t) continue
      const keyMatch = t.match(/\((.)\)/)
      if (keyMatch) {
        const key = keyMatch[1]
        const btn = document.createElement('button')
        btn.className = 'action-btn'
        btn.innerHTML = dcssToHtml(t)
        btn.addEventListener('click', () => {
          conn.send({ msg: 'input', text: key })
          view.focus({ preventScroll: true })
        })
        bar.appendChild(btn)
      } else {
        const span = document.createElement('span')
        span.innerHTML = dcssToHtml(t)
        bar.appendChild(span)
      }
    }
    return bar
  }

  // Mirrors the reference's `set_last_prefix_glyph` (messages.js): set the
  // last message's prefix glyph to `_` and tag it `turn` or `cmd` so CSS
  // can color it (lightgrey turn, darkgrey cmd). If both classes land on
  // the same span the `turn` color wins, matching reference rule order.
  function markLastMsg(kind: 'turn' | 'cmd'): void {
    const mark = msgLog.querySelector<HTMLElement>('.game-msg:last-child .msg-turn-mark')
    if (!mark) return
    mark.textContent = '_'
    mark.classList.add(kind)
  }

  function appendMessage(text: string, html = false): void {
    const p = document.createElement('p')
    p.className = 'game-msg'
    const mark = document.createElement('span')
    mark.className = 'msg-turn-mark'
    mark.textContent = ' '
    p.appendChild(mark)
    const content = document.createElement('span')
    if (html) content.innerHTML = dcssToHtml(text)
    else content.textContent = text
    p.appendChild(content)
    msgLog.appendChild(p)
    while (msgLog.children.length > 50) msgLog.firstChild?.remove()
    msgLog.scrollTop = msgLog.scrollHeight
  }

  return view
}

// Convert a numeric keycode to a display label (printable char or symbol)
function keypressLabel(code: number): string {
  if (code >= 32 && code < 127) return String.fromCharCode(code)
  if (code === 8)  return '⌫'
  if (code === 27) return '⎋'
  if (code === 13) return '⏎'
  if (code === 9)  return '⇥'
  return ''
}

// Render a single spellset book as DOM: an optional header line followed
// by one row per spell with its tile, letter, name, damage effect, and
// range string. Mirrors the reference client's _fmt_spells_list (see
// crawl-ref/source/webserver/game_data/static/ui-layouts.js:33).
function renderSpellbook(book: SpellBook, colourSpells: boolean, onSelect: (letter: string) => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'overlay-spellbook'
  if (book.label?.trim()) {
    const label = document.createElement('div')
    label.className = 'overlay-line'
    label.innerHTML = dcssToHtml(book.label.replace(/^\n+/, ''))
    wrap.appendChild(label)
  }
  const list = document.createElement('div')
  list.className = 'overlay-spelllist'
  for (const spell of book.spells) {
    const item = document.createElement('button')
    item.className = 'overlay-spell'
    if (colourSpells && typeof spell.colour === 'number') {
      item.style.color = uiColor(spell.colour)
    }
    item.appendChild(renderTiles([{ t: spell.tile, tex: TEX.GUI }], 1))
    const text = document.createElement('span')
    text.className = 'overlay-spell-name'
    text.textContent = ` ${spell.letter} - ${spell.title}`
    item.appendChild(text)
    if (spell.effect) {
      const eff = document.createElement('span')
      eff.className = 'overlay-spell-effect'
      eff.innerHTML = dcssToHtml(spell.effect)
      item.appendChild(eff)
    }
    if (spell.range_string) {
      const rng = document.createElement('span')
      rng.className = 'overlay-spell-range'
      rng.innerHTML = dcssToHtml(spell.range_string)
      item.appendChild(rng)
    }
    item.addEventListener('click', () => onSelect(spell.letter))
    list.appendChild(item)
  }
  wrap.appendChild(list)
  return wrap
}

// DCSS describe-* bodies mix prose paragraphs with terminal-formatted tables
// (skill grids, resistance rows). Wrap each line individually so prose lines
// soft-wrap at the screen edge while tabular lines preserve their column
// alignment and side-scroll via the body's overflow-x.
// DCSS quotes (describe-spell, describe-feature, describe-item) are emitted
// wrapped in <darkgrey>. The wire format from formatted_string::to_colour_string
// uses opens-only color switches: `<darkgrey>line1\nline2\n...<lightgrey>`
// with no paired close. Because renderBodyLines runs dcssToHtml per source
// line with a fresh stack, only line 1 inherits the color; later lines fall
// back to the default. Walk the body and prepend <darkgrey> to every line of
// each block so per-line rendering colors them all. The next color tag (or
// end of body) terminates the switch.
//
// Preserve original line breaks and indentation. DCSS quote blocks contain
// both verse (poems with deliberately short uneven lines, where breaks carry
// meaning) and prose (80-char hard-wrapped paragraphs). Reflowing one form
// ruins the other, and the original wire layout is the simplest signal of
// which is which — let the body's overflow-x handle the prose case rather
// than guessing.
//
// balanceColorTagsAcrossLines won't do this job: opens-only bodies skip it
// (re-emitting the stack at every newline would blow up the message-log
// popup), and even on paired bodies it treats `<lightgrey>` as a nested push
// rather than a color switch.
function propagateDarkgreyColor(body: string): string {
  let result = ''
  let i = 0
  const OPEN = '<darkgrey>'
  const CLOSE = '</darkgrey>'
  while (i < body.length) {
    const start = body.indexOf(OPEN, i)
    if (start === -1) { result += body.slice(i); break }
    result += body.slice(i, start)
    const innerStart = start + OPEN.length
    // Terminator: explicit close (paired form, rarely seen in wire data) or
    // the next color-tag open (opens-only color switch). Pick whichever
    // comes first; if neither, the block runs to end of body.
    const closeIdx = body.indexOf(CLOSE, innerStart)
    const openMatch = body.slice(innerStart).match(/<\w+>/)
    const nextOpenIdx = openMatch ? innerStart + openMatch.index! : -1
    let innerEnd: number
    let isPaired: boolean
    if (closeIdx !== -1 && (nextOpenIdx === -1 || closeIdx < nextOpenIdx)) {
      innerEnd = closeIdx; isPaired = true
    } else if (nextOpenIdx !== -1) {
      innerEnd = nextOpenIdx; isPaired = false
    } else {
      innerEnd = body.length; isPaired = false
    }
    const inner = body.slice(innerStart, innerEnd)
    if (!inner.includes('\n')) {
      result += isPaired ? `${OPEN}${inner}${CLOSE}` : `${OPEN}${inner}`
      i = isPaired ? innerEnd + CLOSE.length : innerEnd
      continue
    }
    const propagated = inner.split('\n').map(l => `${OPEN}${l}`).join('\n')
    if (isPaired) {
      result += `${propagated}${CLOSE}`
      i = innerEnd + CLOSE.length
    } else {
      result += propagated
      i = innerEnd
    }
  }
  return result
}

function renderBodyLines(rawBody: string, highlight: string): string {
  return balanceColorTagsAcrossLines(rawBody).split('\n').map(line => {
    const stat = tryStatRow(line)
    if (stat) return stat
    const cls = isTabularLine(line) ? 'overlay-line overlay-line--nowrap' : 'overlay-line'
    const html = applyHighlight(dcssToHtml(line), highlight) || '&nbsp;'
    return `<div class="${cls}">${html}</div>`
  }).join('')
}

// renderBodyLines splits the body on `\n` and runs dcssToHtml per line with
// a fresh stack — so a `<darkgrey>quote line 1\nquote line 2</darkgrey>` block
// renders only line 1 in darkgrey, with subsequent lines defaulting. Walk the
// body once and at each newline emit the current open-stack as closes (before
// the \n) and reopens (after the \n), so each line is self-contained.
//
// Skip this for opens-only bodies: the wire format from
// formatted_string::to_colour_string (format.cc:357) emits `<newcolor>` with
// no closing tag — switching color is implicit replace, not nesting. The full
// message-log popup is encoded this way, with ~1900 opens across ~440 lines.
// Stacking those would emit the entire growing stack at every newline, blowing
// up to hundreds of thousands of spans. Opens-only lines also each start with
// an explicit color, so per-line rendering already gets the right color.
function balanceColorTagsAcrossLines(body: string): string {
  if (!body.includes('</')) return body
  const stack: string[] = []
  const out: string[] = []
  for (const token of body.split(/(<\/?[a-zA-Z]+>|\n)/)) {
    if (!token) continue
    if (token === '\n') {
      for (let i = stack.length - 1; i >= 0; i--) out.push(`</${stack[i]}>`)
      out.push('\n')
      for (const tag of stack) out.push(`<${tag}>`)
      continue
    }
    const close = token.match(/^<\/([a-zA-Z]+)>$/)
    const open = token.match(/^<([a-zA-Z]+)>$/)
    if (close && stack.length > 0) stack.pop()
    else if (open && open[1] in DCSS_COLOR_MAP) stack.push(open[1])
    out.push(token)
  }
  return out.join('')
}

// Detect a stat-row line — one whose entire content is fixed-width
// `<color>label: value   </color>` blocks with whitespace padding (the
// "Max HP / Will / AC / EV" and "Class / Size / Int" rows in describe-
// monster). Reformat as a flex row of compact chips so all stats fit on
// a phone screen instead of overflowing the 80-char column layout.
function tryStatRow(line: string): string | null {
  const blocks: { color: string; text: string }[] = []
  let lastEnd = 0
  const re = /<(\w+)>([^<]*)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (line.slice(lastEnd, m.index).trim()) return null
    const inner = m[2].trim()
    if (!inner.includes(':')) return null
    blocks.push({ color: m[1], text: inner })
    lastEnd = m.index + m[0].length
  }
  if (line.slice(lastEnd).trim()) return null
  if (blocks.length < 2) return null
  const html = blocks
    .map(b => `<span class="overlay-stat">${dcssToHtml(`<${b.color}>${b.text}</${b.color}>`)}</span>`)
    .join('')
  return `<div class="overlay-line overlay-stat-row">${html}</div>`
}

function isTabularLine(line: string): boolean {
  const stripped = line.replace(/<[^>]+>/g, '')
  if (/^\s*-{3,}[\s-]*$/.test(stripped)) return true
  if (/\S {3,}\S/.test(stripped)) return true
  // Key-help row: line begins with a colour-wrapped key followed by " : "
  // (e.g. "<white>Shift-Dir.<lightgrey> : Move the cursor..."). The intra-
  // line gap can be just one space when the key string consumed its
  // padding, so the \S {3,}\S check above misses it. DCSS's wire format
  // uses opens-only color switches (not paired closes), so the second tag
  // matches either form.
  if (/^<\w+>[^<]+<\/?\w+>\s*:\s/.test(line)) return true
  // Right-column-only continuation from column_composer: when the left
  // column is empty the row is ~40-42 leading spaces + right-column content
  // (column 0 width is 40 in targeting help, 42 in the main keyhelp). The
  // threshold sits above the manual's deepest prose indent (28 leading
  // spaces, the cover-page banner; species sub-bullets use 10) so prose
  // paragraphs keep wrapping.
  if (/^ {30,}\S/.test(stripped)) return true
  return false
}

function applyHighlight(html: string, pattern: string): string {
  if (!pattern) return html
  try {
    const re = new RegExp(`[^\n]*(${pattern})[^\n]*\n?`, 'g')
    return html.replace(re, (line) => `<span class="crt-highlight">${line}</span>`)
  } catch { return html }
}

function stripDcss(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

function formatMore(raw: string, scrollPos = 'top'): string {
  return stripDcss(raw).replace(/XXX/g, scrollPos).trim()
}

function formatMoreHtml(raw: string, scrollPos = 'top'): string {
  return dcssToHtml(raw.replace(/XXX/g, scrollPos))
}

function computeScrollPos(el: HTMLElement): string {
  const { scrollTop, scrollHeight, clientHeight } = el
  if (scrollTop <= 0) return 'top'
  if (scrollTop + clientHeight >= scrollHeight - 1) return 'bot'
  return `${Math.round(scrollTop / (scrollHeight - clientHeight) * 100)}%`
}
