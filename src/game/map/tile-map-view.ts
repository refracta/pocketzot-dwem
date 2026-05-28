// Portions of this file are ported from Dungeon Crawl Stone Soup,
// webserver/game_data/static/cell_renderer.js (do_render_cell,
// draw_background, draw_foreground). DCSS is Copyright 1997–2025
// Linley Henzell, the dev team, and contributors; GPL-2.0-or-later.
// Reused under the "or later" option as part of this AGPL-3.0-or-later
// work. See ATTRIBUTION.md and LICENSE.

import type { Cell, MapStore } from './map-store'
import { decodeColor, DEFAULT_FG, flashColor } from './colors'
import { tileLoader, TEX } from '../tiles/tile-loader'
import {
  FG_TILE_ID_MASK,
  FG_ATTITUDE_MASK, FG_PET, FG_GD_NEUTRAL, FG_NEUTRAL,
  FG_S_UNDER, FG_FLYING,
  FG_BEHAVIOUR_MASK, FG_STAB, FG_MAY_STAB, FG_FLEEING, FG_PARALYSED,
  FG_NET, FG_WEB,
  FG_MDAM_LO_MASK, FG_MDAM_LIGHT_LO, FG_MDAM_MOD_LO, FG_MDAM_HEAVY_LO, FG_MDAM_HI_BIT,
  FG_GHOST,
  FG_POISON_MASK_HI, FG_POISON, FG_MORE_POISON, FG_MAX_POISON,
  FG_THREAT_MASK_HI, FG_THREAT_TRIVIAL, FG_THREAT_EASY, FG_THREAT_TOUGH, FG_THREAT_NASTY, FG_THREAT_UNUSUAL,
  BG_TILE_ID_MASK,
  BG_MM_UNSEEN, BG_UNSEEN, BG_TRAV_EXCL, BG_EXCL_CTR, BG_OOR, BG_WATER,
  BG_NEW_STAIR, BG_NEW_TRANSPORTER,
  BG_CURSOR_MASK, BG_CURSOR1, BG_CURSOR2, BG_CURSOR3, BG_TUT_CURSOR,
  BG_KRAKEN_NW, BG_KRAKEN_NE, BG_KRAKEN_SE,
  BG_RAMPAGE_HI,
  bgLo, bgHi,
} from './cell-flags'

// Tile-mode minimum viewport. Square because tile cells are square; 21×21
// is roughly the smallest cell count where a phone-sized container still
// gives readable sprites without the player feeling boxed in. fitToContainer
// expands beyond this in 2-cell increments (one per side) on whichever axis
// has slack, so portrait phones grow vertically and landscape grows
// horizontally without off-center shifts.
const NORMAL_AXIS = 21
// Square zoom viewport. DCSS LOS radius is 7, so 15×15 covers all visible
// cells; 17×17 adds a one-cell border. Same symmetric slack-fill applies on
// top, so zoom still uses freed space — just with a smaller floor.
const ZOOM_AXIS = 17

// Authored cell size of every DCSS sprite atlas. Per-tile {ox,oy,w,h} positions
// the sprite inside this 32×32 logical box; we scale the whole box to cellPx.
const ATLAS_CELL = 32

// Mask out the upper TILE_FLAG bits (MDAM/STAB/etc.) before looking up a tile
// id. Reference defines TILE_FLAG_MASK = 0xffff but uses ~0x7fff for the fg
// dispatch — the low 15–16 bits are the tile id either way at the scale we
// care about. Stay conservative.
const TILE_ID_MASK = 0xffff

// Textures we preload before flipping `ready` on. Player atlas is needed for
// doll/mcache (humanoid composition + player avatar).
const PRELOAD_TEX = [
  TEX.FLOOR, TEX.WALL, TEX.FEAT, TEX.PLAYER, TEX.MAIN, TEX.ICONS,
] as const

// Halo enum values for cell.halo (see enums.js).
const HALO_RANGE = 1
const HALO_UMBRA_FIRST = 2
const HALO_UMBRA_LAST = 5

// fg flag decoder. Bits packed into one or two 32-bit words; the server sends
// `fg: [lo, hi]` when MDAM/threat/poison/etc. push the bitset past 32 bits.
// Reference layout: crawl-ref/source/webserver/game_data/static/enums.js:139-205.
//
// `>>> 0` coerces to uint32 so high-bit masks (0x80000000, 0xC0000000, etc.)
// compare correctly — bitwise `&` in JS returns int32, which would make
// `(lo & 0xC0000000) === 0xC0000000` test `-1073741824 === 3221225472` and
// fail. Coerced both sides land in the same positive range.
interface DecodedFg {
  value: number
  PET: boolean; GD_NEUTRAL: boolean; NEUTRAL: boolean
  S_UNDER: boolean; FLYING: boolean
  STAB: boolean; MAY_STAB: boolean; FLEEING: boolean; PARALYSED: boolean
  NET: boolean; WEB: boolean
  POISON: boolean; MORE_POISON: boolean; MAX_POISON: boolean
  TRIVIAL: boolean; EASY: boolean; TOUGH: boolean; NASTY: boolean; UNUSUAL: boolean
  GHOST: boolean
  MDAM_LIGHT: boolean; MDAM_MOD: boolean; MDAM_HEAVY: boolean; MDAM_SEV: boolean; MDAM_ADEAD: boolean
}
function decodeFg(fg: number | number[] | undefined): DecodedFg {
  const loRaw = fg === undefined ? 0 : (typeof fg === 'number' ? fg : (fg[0] ?? 0))
  const hiRaw = fg === undefined ? 0 : (typeof fg === 'number' ? 0 : (fg[1] ?? 0))
  const lo = loRaw >>> 0
  const hi = hiRaw >>> 0
  const attitude = lo & FG_ATTITUDE_MASK
  const behavior = lo & FG_BEHAVIOUR_MASK
  const poison = hi & FG_POISON_MASK_HI
  const threat = (hi & FG_THREAT_MASK_HI) >>> 0
  const mdamLo = (lo & FG_MDAM_LO_MASK) >>> 0
  const mdamHi = hi & FG_MDAM_HI_BIT
  return {
    value: lo & FG_TILE_ID_MASK,
    PET: attitude === FG_PET,
    GD_NEUTRAL: attitude === FG_GD_NEUTRAL,
    NEUTRAL: attitude === FG_NEUTRAL,
    S_UNDER: (lo & FG_S_UNDER) !== 0,
    FLYING: (lo & FG_FLYING) !== 0,
    STAB: behavior === FG_STAB,
    MAY_STAB: behavior === FG_MAY_STAB,
    FLEEING: behavior === FG_FLEEING,
    PARALYSED: behavior === FG_PARALYSED,
    NET: (lo & FG_NET) !== 0,
    WEB: (lo & FG_WEB) !== 0,
    POISON: poison === FG_POISON,
    MORE_POISON: poison === FG_MORE_POISON,
    MAX_POISON: poison === FG_MAX_POISON,
    GHOST: (hi & FG_GHOST) !== 0,
    TRIVIAL: threat === FG_THREAT_TRIVIAL,
    EASY: threat === FG_THREAT_EASY,
    TOUGH: threat === FG_THREAT_TOUGH,
    NASTY: threat === FG_THREAT_NASTY,
    UNUSUAL: threat === FG_THREAT_UNUSUAL,
    MDAM_LIGHT: mdamLo === FG_MDAM_LIGHT_LO && mdamHi === 0,
    MDAM_MOD: mdamLo === FG_MDAM_MOD_LO && mdamHi === 0,
    MDAM_HEAVY: mdamLo === FG_MDAM_HEAVY_LO && mdamHi === 0,
    MDAM_SEV: mdamLo === 0 && mdamHi === FG_MDAM_HI_BIT,
    MDAM_ADEAD: mdamLo === FG_MDAM_HEAVY_LO && mdamHi === FG_MDAM_HI_BIT,
  }
}

interface DecodedBg {
  value: number
  MM_UNSEEN: boolean; UNSEEN: boolean
  TRAV_EXCL: boolean; EXCL_CTR: boolean; OOR: boolean
  WATER: boolean
  NEW_STAIR: boolean; NEW_TRANSPORTER: boolean
  CURSOR1: boolean; CURSOR2: boolean; CURSOR3: boolean; TUT_CURSOR: boolean
  KRAKEN_NW: boolean; KRAKEN_NE: boolean; KRAKEN_SE: boolean; KRAKEN_SW: boolean
  // ELDRITCH_* aren't present in the v0.34 bg flag table (enums.js only
  // defines KRAKEN_*), but cell_renderer dispatches them too — leave fields
  // here returning false so the draw code branches uniformly.
  ELDRITCH_NW: boolean; ELDRITCH_NE: boolean; ELDRITCH_SE: boolean; ELDRITCH_SW: boolean
  // RAMPAGE marks rampage-target cells (winged-boot icon overlay). Lives in
  // the bg hi word, so a cell with RAMPAGE arrives as `bg: [lo, hi]` — see
  // BG_RAMPAGE_HI / bgLo / bgHi in cell-flags.ts.
  RAMPAGE: boolean
}
function decodeBg(bg: number | number[] | undefined): DecodedBg {
  // bg arrives as `number` or `[lo, hi]`; see bgLo/bgHi in cell-flags.ts for
  // the rationale (hi-word flags like RAMPAGE would silently wipe the dngn
  // tile id if coerced through `& 0xFFFF`).
  const lo = bgLo(bg)
  const hi = bgHi(bg)
  const cursor = lo & BG_CURSOR_MASK
  return {
    value: lo & BG_TILE_ID_MASK,
    MM_UNSEEN: (lo & BG_MM_UNSEEN) !== 0,
    UNSEEN: (lo & BG_UNSEEN) !== 0,
    TRAV_EXCL: (lo & BG_TRAV_EXCL) !== 0,
    EXCL_CTR: (lo & BG_EXCL_CTR) !== 0,
    OOR: (lo & BG_OOR) !== 0,
    WATER: (lo & BG_WATER) !== 0,
    NEW_STAIR: (lo & BG_NEW_STAIR) !== 0,
    NEW_TRANSPORTER: (lo & BG_NEW_TRANSPORTER) !== 0,
    CURSOR1: cursor === BG_CURSOR1,
    CURSOR2: cursor === BG_CURSOR2,
    CURSOR3: cursor === BG_CURSOR3,
    TUT_CURSOR: (lo & BG_TUT_CURSOR) !== 0,
    KRAKEN_NW: (lo & BG_KRAKEN_NW) !== 0,
    KRAKEN_NE: (lo & BG_KRAKEN_NE) !== 0,
    KRAKEN_SE: (lo & BG_KRAKEN_SE) !== 0,
    // KRAKEN_SW lives in the hi word per enums.js but v0.34 never sends one;
    // ELDRITCH_* aren't defined in 0.34's bg flag table at all. Fields kept
    // returning false so the draw branches in drawCell stay uniform.
    KRAKEN_SW: false,
    ELDRITCH_NW: false, ELDRITCH_NE: false, ELDRITCH_SE: false, ELDRITCH_SW: false,
    RAMPAGE: (hi & BG_RAMPAGE_HI) !== 0,
  }
}

// Tile renderer. Same public API as MapView, but each cell is a stack of
// sprites drawn to a single <canvas>. Viewport floors at 21×21 (non-zoom)
// or 17×17 (zoom) and expands symmetrically into available slack in 2-cell
// increments. X-mode hides the HUD/log to give the map more room but does
// not shrink cells — the freed area is absorbed by the same slack-fill.
// Falls back to ASCII glyphs (also drawn on the canvas) until the tile
// atlases finish loading.
export class TileMapView {
  private container: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private store: MapStore
  private viewportW = NORMAL_AXIS
  private viewportH = NORMAL_AXIS
  private zoomMode = false
  // Multiplier on cellPx — mirrors MapView.fontScale. X-mode sets this to
  // <1 to shrink cells and let the symmetric slack-fill add more of them.
  // Named `renderScale` internally; setFontScale() stores into it for API
  // parity with the ASCII view.
  private renderScale = 1.0
  private viewCenter = { x: 0, y: 0 }
  private cursorLoc: { x: number; y: number } | null = null
  // CSS pixel size of one rendered cell — a float, picked to fill the binding
  // axis exactly. The backing canvas always renders at ATLAS_CELL per cell
  // (native atlas resolution); the canvas is then CSS-scaled to this size,
  // with `image-rendering: pixelated` keeping the upscale nearest-neighbor.
  // Doing the scale once at the canvas level (rather than per-tile inside
  // paintTile) means no sub-pixel seams between adjacent sprites and lets us
  // drop the round-to-even-pixels constraint that previously left ~9 px of
  // dead space on each side of the binding axis.
  private cellPx = 16
  // Flipped true once every PRELOAD_TEX atlas + tileinfo + tileinfo-dngn has
  // loaded. Until then we draw ASCII glyphs on the canvas — same shape, lets
  // the user see the map while ~10 MB of atlas downloads.
  private ready = false
  // Guards against duplicate preload runs when the loader is reconfigured
  // mid-session (shouldn't happen, but the configure() call is idempotent
  // only when args match exactly).
  private preloadStarted = false
  // Named tile ids from the tileinfo modules, resolved after preload. Empty
  // until `ready` flips true. Per-cell paint looks them up by name
  // (this.dngn.SANCTUARY, this.icons.MESH, …) so the code reads like the
  // reference's `dngn.X` / `icons.X` dispatches. We bulk-copy every numeric
  // export (1000+ entries) rather than maintain an allow-list — it's only a
  // few KB and keeps us robust against renamed constants between versions.
  private dngn: Record<string, number> = {}
  private icons: Record<string, number> = {}
  // Per-tile-run variant count from tileinfo-dngn. Used to pick an animation
  // frame for blood/mold/liquefaction via `cell.flv.s % tileCount(id)`.
  private tileCount: ((id: number) => number) | null = null
  // Range thresholds from tileinfo-dngn / tileinfo-main. ov[] entries route
  // by id-range (floor underlays, dngn overlays, main-atlas zaps). bg.value
  // thresholds also gate blood-on-walls vs blood-on-floor.
  private dngnUnseen = 0
  private dngnFirstTransparent = 0
  private floorMax = 0
  private wallMax = 0
  private featMax = 0
  private dngnMax = 0
  private mainMax = 0

  constructor(store: MapStore) {
    this.store = store
    this.container = document.createElement('div')
    this.container.id = 'map-grid'
    this.container.classList.add('map-tile')
    this.container.setAttribute('aria-label', 'Dungeon map')

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'map-tile-canvas'
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = false
    this.container.appendChild(this.canvas)

    // Kick off preload if the loader is already configured; otherwise the
    // game-view game_client handler will call preloadAtlases() after
    // tileLoader.configure() runs.
    if (tileLoader.configured) void this.preloadAtlases()
  }

  // Public so game-view can call after tileLoader.configure() in the
  // game_client handler — the TileMapView is constructed before that fires
  // when the user has tile mode persisted.
  async preloadAtlases(): Promise<void> {
    if (this.preloadStarted) return
    if (!tileLoader.configured) return
    this.preloadStarted = true
    try {
      const [, , , , , , dngnMod, iconsMod, mainMod] = await Promise.all([
        ...PRELOAD_TEX.map((t) => tileLoader.ensureLoaded(t)),
        // tileinfo-dngn is the floor/wall/feat dispatch meta-module; it
        // re-exports every floor/wall/feat name (SANCTUARY, KRAKEN_OVERLAY_NW,
        // …) plus the range thresholds (FLOOR_MAX, WALL_MAX, …).
        tileLoader.getModule('dngn'),
        tileLoader.getModule('icons'),
        tileLoader.getModule('main'),
      ])
      for (const [k, v] of Object.entries(dngnMod as Record<string, unknown>)) {
        if (typeof v === 'number') this.dngn[k] = v
      }
      for (const [k, v] of Object.entries(iconsMod as Record<string, unknown>)) {
        if (typeof v === 'number') this.icons[k] = v
      }
      const tc = (dngnMod as Record<string, unknown>).tile_count
      if (typeof tc === 'function') this.tileCount = tc as (id: number) => number
      this.dngnUnseen = this.dngn.DNGN_UNSEEN ?? 0
      this.dngnFirstTransparent = this.dngn.DNGN_FIRST_TRANSPARENT ?? 0
      this.floorMax = this.dngn.FLOOR_MAX ?? 0
      this.wallMax = this.dngn.WALL_MAX ?? 0
      this.featMax = this.dngn.FEAT_MAX ?? 0
      this.dngnMax = this.dngn.DNGN_MAX ?? 0
      this.mainMax = ((mainMod as Record<string, unknown>).MAIN_MAX as number) ?? 0
      this.ready = true
      // Schedule a fit+paint on the next frame rather than painting now.
      // Two races make a direct fullRender unsafe on first load:
      //   (a) preload can resolve before the initial ResizeObserver callback
      //       fires (possible when atlases come from HTTP cache on a warm
      //       reload), leaving cellPx/viewportW/H at their constructor
      //       defaults and the canvas at its default 300×150 backing-store;
      //       a fullRender at that point clips off most of the map.
      //   (b) the `map` messages that arrive during preload all hit ASCII
      //       fallback and the next non-clear/non-vgrdc map is render(dirty),
      //       which never repaints the cells that were drawn as fallback.
      // rAF guarantees layout has settled and gives fitToContainer a real
      // container size; the explicit fullRender afterwards covers the case
      // where the size didn't change and setViewportSize early-exited.
      requestAnimationFrame(() => { this.fitToContainer(); this.fullRender() })
    } catch (err) {
      console.warn('TileMapView atlas preload failed:', err)
    }
  }

  get element(): HTMLElement { return this.container }

  // Returns true if the center actually moved — see MapView.setViewCenter for
  // the rationale (vgrdc is resent on every map message in steady state).
  setViewCenter(c: { x: number; y: number }): boolean {
    const changed = c.x !== this.viewCenter.x || c.y !== this.viewCenter.y
    this.viewCenter = { ...c }
    return changed
  }
  // Mirrors MapView.setFontScale. Stored as a multiplier on cellPx, applied
  // in fitToContainer. X-mode calls this with 0.7 to zoom out (smaller cells
  // ⇒ more of them fit, courtesy of the symmetric slack-fill); back to 1.0
  // on exit. Caller is expected to invoke fitToContainer() next.
  setFontScale(scale: number): void { this.renderScale = scale }
  setZoomMode(on: boolean): void { this.zoomMode = on }
  isZoomMode(): boolean { return this.zoomMode }

  fitToContainer(): void {
    const rect = this.container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const cs = getComputedStyle(this.container)
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const availW = rect.width - padX
    const availH = rect.height - padY
    if (availW <= 0 || availH <= 0) return

    // Minimum viewport floor: 21×21 normal, 17×17 zoom. Cell size is picked
    // so this floor fits the binding axis; the slack axis (and any extra
    // space the binding axis happens to have) then grows in increments of 2
    // cells — one per side — so the player stays centered. X-mode flows
    // through the same code: HUD/log are hidden by game-view, availH grows,
    // and the renderScale<1 (set via setFontScale) shrinks each cell so the
    // slack-fill turns the freed area into still more cells.
    const baseAxis = this.zoomMode ? ZOOM_AXIS : NORMAL_AXIS

    // Float cell size — fills the binding axis exactly. The backing canvas
    // renders at ATLAS_CELL per cell and CSS scales to this size, so we don't
    // have to round to whole (or even) pixels to keep sprites aligned.
    // renderScale (X-mode) shrinks the result further; clamp stays in [8,96]
    // so tiny containers can't underflow.
    const baseCell = Math.min(availW / baseAxis, availH / baseAxis)
    const cell = Math.max(8, Math.min(96, baseCell * this.renderScale))
    this.cellPx = cell

    const fitW = Math.floor(availW / cell)
    const fitH = Math.floor(availH / cell)
    const extraW = Math.max(0, Math.floor((fitW - baseAxis) / 2) * 2)
    const extraH = Math.max(0, Math.floor((fitH - baseAxis) / 2) * 2)
    this.setViewportSize(baseAxis + extraW, baseAxis + extraH)
  }

  setViewportSize(w: number, h: number): void {
    const cssW = w * this.cellPx
    const cssH = h * this.cellPx
    const same = w === this.viewportW && h === this.viewportH
      && this.canvas.style.width === `${cssW}px`
    if (!same) {
      this.viewportW = w
      this.viewportH = h
      // Backing store at native atlas resolution. CSS scales it up/down to the
      // float display size; `image-rendering: pixelated` keeps the scale
      // nearest-neighbor so we don't need a DPR multiplier on the backing.
      this.canvas.width = w * ATLAS_CELL
      this.canvas.height = h * ATLAS_CELL
      this.canvas.style.width = `${cssW}px`
      this.canvas.style.height = `${cssH}px`
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.imageSmoothingEnabled = false
      this.fullRender()
    }
  }

  resetViewportSize(): void {
    const axis = this.zoomMode ? ZOOM_AXIS : NORMAL_AXIS
    this.setViewportSize(axis, axis)
  }

  render(dirty?: Set<string>): void {
    const offX = this.viewCenter.x - Math.floor(this.viewportW / 2)
    const offY = this.viewCenter.y - Math.floor(this.viewportH / 2)
    if (dirty) {
      // Iterate dirty cells directly; skip those outside the viewport.
      // See MapView.render for the rationale.
      for (const key of dirty) {
        const comma = key.indexOf(',')
        const mx = +key.slice(0, comma)
        const my = +key.slice(comma + 1)
        const col = mx - offX
        const row = my - offY
        if (col < 0 || col >= this.viewportW || row < 0 || row >= this.viewportH) continue
        this.drawCell(col, row, mx, my)
      }
      return
    }
    for (let row = 0; row < this.viewportH; row++) {
      for (let col = 0; col < this.viewportW; col++) {
        this.drawCell(col, row, offX + col, offY + row)
      }
    }
  }

  fullRender(): void {
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, this.viewportW * ATLAS_CELL, this.viewportH * ATLAS_CELL)
    this.render()
  }

  setCursor(loc?: { x: number; y: number }): void {
    const prev = this.cursorLoc
    const next = loc ?? null
    if ((prev?.x ?? null) === (next?.x ?? null) && (prev?.y ?? null) === (next?.y ?? null)) return
    this.cursorLoc = next
    // Repaint the old cell (clears the previous cursor sprite) and the new
    // cell (paints the new one). drawCell layers the cursor on top when
    // (mx,my) === cursorLoc — see paintCursorIfHere.
    const offX = this.viewCenter.x - Math.floor(this.viewportW / 2)
    const offY = this.viewCenter.y - Math.floor(this.viewportH / 2)
    const redraw = (p: { x: number; y: number } | null): void => {
      if (!p) return
      const col = p.x - offX
      const row = p.y - offY
      if (col < 0 || col >= this.viewportW || row < 0 || row >= this.viewportH) return
      this.drawCell(col, row, p.x, p.y)
    }
    redraw(prev)
    redraw(next)
  }

  private drawCell(col: number, row: number, mx: number, my: number): void {
    const px = col * ATLAS_CELL
    const py = row * ATLAS_CELL
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(px, py, ATLAS_CELL, ATLAS_CELL)

    const cell = this.store.get(mx, my)
    if (!cell) {
      this.paintCursorIfHere(mx, my, px, py)
      return
    }

    if (!this.ready) {
      this.drawAsciiFallback(cell, px, py)
      this.paintCursorIfHere(mx, my, px, py)
      return
    }

    const fg = decodeFg(cell.fg)
    const bg = decodeBg(cell.t_bg)
    const inWater = bg.WATER && !fg.FLYING

    // The order below mirrors cell_renderer.js do_render_cell + draw_background
    // + draw_foreground (in that overall sequence). Section comments cite the
    // line ranges in the reference for traceability.

    // ── draw_background (cell_renderer.js:665-859) ─────────────────────────

    // Base tile (transparent-feature → draw floor underneath; mangrove tree
    // → render with shallow water underneath; otherwise plain bg).
    if (cell.mangrove_water && bg.value > this.dngnUnseen) {
      this.paintDngn(this.dngn.DNGN_SHALLOW_WATER ?? 0, px, py)
    } else if (bg.value >= this.dngnFirstTransparent) {
      if (cell.flv?.f) this.paintDngn(cell.flv.f, px, py)
      // Floor overlays from cell.ov that fall in the floor-id range — these
      // sit beneath the transparent feature (e.g. crystal walls with floor
      // showing through).
      if (cell.ov) {
        for (const o of cell.ov) {
          if (o && o <= this.floorMax) this.paintDngn(o, px, py)
        }
      }
    }

    // Blood beneath feature tiles (when bg is a feature ≥ WALL_MAX).
    if (bg.value > this.wallMax) this.drawBloodOverlay(cell, px, py, false)

    // Main bg tile. When mangrove_water is set the reference (cell_renderer.js
    // `draw_background`, mangrove_water branch) paints the mangrove twice —
    // top half α=1.0, bottom half α=0.3 — so the shallow water laid down above
    // shows through the trunk's lower portion. Without the split the trees
    // look opaque on dry ground instead of standing in the swamp.
    if (bg.value > 0) {
      if (cell.mangrove_water) {
        this.withWaterSplit(true, py, 1.0, 0.3, () => this.paintDngn(bg.value, px, py))
      } else {
        this.paintDngn(bg.value, px, py)
      }
    }

    if (bg.value > this.dngnUnseen) {
      // Blood on top of walls (the WALL_BLOOD_* / WALL_OLD_BLOOD variants).
      if (bg.value <= this.wallMax) {
        this.drawBloodOverlay(cell, px, py, bg.value > this.floorMax)
      }

      // cell.ov[] dngn overlays, with RAY drawn last to handle alpha ordering.
      let rayId = 0
      if (cell.ov) {
        for (const o of cell.ov) {
          if (o > this.dngnMax) continue
          if (o === this.dngn.RAY || o === this.dngn.RAY_MULTI || o === this.dngn.RAY_OUT_OF_RANGE) {
            rayId = o
          } else if (o && (bg.value < this.dngnFirstTransparent || o > this.floorMax)) {
            this.paintDngn(o, px, py)
          }
        }
      }
      if (rayId) this.paintDngn(rayId, px, py)

      if (!bg.UNSEEN) {
        // Kraken/Eldritch tentacle direction markers (4 corners).
        if (bg.KRAKEN_NW) this.paintDngnName('KRAKEN_OVERLAY_NW', px, py)
        else if (bg.ELDRITCH_NW) this.paintDngnName('ELDRITCH_OVERLAY_NW', px, py)
        if (bg.KRAKEN_NE) this.paintDngnName('KRAKEN_OVERLAY_NE', px, py)
        else if (bg.ELDRITCH_NE) this.paintDngnName('ELDRITCH_OVERLAY_NE', px, py)
        if (bg.KRAKEN_SE) this.paintDngnName('KRAKEN_OVERLAY_SE', px, py)
        else if (bg.ELDRITCH_SE) this.paintDngnName('ELDRITCH_OVERLAY_SE', px, py)
        if (bg.KRAKEN_SW) this.paintDngnName('KRAKEN_OVERLAY_SW', px, py)
        else if (bg.ELDRITCH_SW) this.paintDngnName('ELDRITCH_OVERLAY_SW', px, py)

        // Auras / spell radii / divine effects.
        if (cell.sanctuary) this.paintDngnName('SANCTUARY', px, py)
        if (cell.blasphemy) this.paintDngnName('BLASPHEMY', px, py)
        if (cell.has_bfb_corpse) this.paintDngnName('BLOOD_FOR_BLOOD', px, py)
        if (cell.silenced) this.paintDngnName('SILENCED', px, py)
        if (cell.halo === HALO_RANGE) this.paintDngnName('HALO_RANGE', px, py)
        if (cell.halo !== undefined && cell.halo >= HALO_UMBRA_FIRST && cell.halo <= HALO_UMBRA_LAST) {
          const base = this.dngn.UMBRA
          if (base !== undefined) this.paintDngn(base + cell.halo - HALO_UMBRA_FIRST, px, py)
        }
        if (cell.orb_glow) {
          const base = this.dngn.ORB_GLOW
          if (base !== undefined) this.paintDngn(base + cell.orb_glow - 1, px, py)
        }
        if (cell.quad_glow) this.paintDngnName('QUAD_GLOW', px, py)
        if (cell.disjunct) {
          const base = this.dngn.DISJUNCT
          if (base !== undefined) this.paintDngn(base + cell.disjunct - 1, px, py)
        }
        if (cell.awakened_forest) this.paintIcon('BERSERK', px, py)

        // Attitude halos (ring under the monster).
        if (fg.PET) this.paintDngnName('HALO_FRIENDLY', px, py)
        else if (fg.GD_NEUTRAL) this.paintDngnName('HALO_GD_NEUTRAL', px, py)
        else if (fg.NEUTRAL) this.paintDngnName('HALO_NEUTRAL', px, py)

        // Threat-level stars (ghost variants are distinct).
        if (fg.GHOST) {
          if (fg.TRIVIAL) this.paintDngnName('THREAT_GHOST_TRIVIAL', px, py)
          else if (fg.EASY) this.paintDngnName('THREAT_GHOST_EASY', px, py)
          else if (fg.TOUGH) this.paintDngnName('THREAT_GHOST_TOUGH', px, py)
          else if (fg.NASTY) this.paintDngnName('THREAT_GHOST_NASTY', px, py)
          else if (fg.UNUSUAL) this.paintDngnName('THREAT_UNUSUAL', px, py)
        } else {
          if (fg.TRIVIAL) this.paintDngnName('THREAT_TRIVIAL', px, py)
          else if (fg.EASY) this.paintDngnName('THREAT_EASY', px, py)
          else if (fg.TOUGH) this.paintDngnName('THREAT_TOUGH', px, py)
          else if (fg.NASTY) this.paintDngnName('THREAT_NASTY', px, py)
          else if (fg.UNUSUAL) this.paintDngnName('THREAT_UNUSUAL', px, py)
        }

        if (cell.highlighted_summoner) this.paintDngnName('HALO_SUMMONER', px, py)
      }

      // Travel exclusion background ring (NOT gated by !bg.UNSEEN per the
      // reference — drawn whether or not the cell is in FOV).
      if (bg.EXCL_CTR) this.paintDngnName('TRAVEL_EXCLUSION_CENTRE_BG', px, py)
      else if (bg.TRAV_EXCL) this.paintDngnName('TRAVEL_EXCLUSION_BG', px, py)
    }

    // ── after draw_background (do_render_cell:260-456) ─────────────────────

    const cloudId = cell.cloud && cell.cloud > 0 ? cell.cloud & TILE_ID_MASK : 0

    // Cloud underlay. When an actor is present, draw the cloud half-opaque so
    // the actor shows through; when no actor, draw fully opaque. The reference
    // also splits this for water (less alpha submerged) — same idea.
    if (cloudId) {
      if (fg.value > 0) {
        this.withWaterSplit(inWater, py, 0.6, 0.2, () => this.paintTile(TEX.MAIN, cloudId, px, py))
      } else {
        this.paintTile(TEX.MAIN, cloudId, px, py)
      }
    }

    // Doll/mcache OR fg main tile. Water-clipped split-alpha when the actor is
    // standing in liquid; otherwise plain (with a slight dim for translucent
    // actors via cell.trans).
    const hasDoll = cell.doll && cell.doll.length > 0
    const hasMcache = cell.mcache && cell.mcache.length > 0
    const drawActor = (): void => {
      if (hasDoll || hasMcache) {
        if (cell.doll) {
          const offsetMap = hasMcache
            ? new Map<number, [number, number]>((cell.mcache as Array<[number, number, number]>).map(([t, x, y]) => [t, [x, y]]))
            : undefined
          for (const [t, ymax] of cell.doll) {
            // Doll parts carry a y-clip (`ymax`, in cell-relative atlas pixels)
            // so the renderer can crop the body sprite for non-humanoid
            // races whose lower half is supplied by the base tile rather than
            // legs — `TilesFramework::send_doll` in tileweb.cc writes 18 for
            // any part flagged TILEP_FLAG_CUT_BOTTOM (naga/armataur torso,
            // merfolk/djinni torso, some helms; see `tilep_calc_flags` in
            // tilepick-p.cc). Without honoring ymax the torso paints all the
            // way to y=32 and overlaps the snake base, leaving a doubled belly
            // across the bottom half of the cell.
            const off = offsetMap?.get(t)
            this.paintTile(TEX.PLAYER, t & TILE_ID_MASK, px, py, off?.[0] ?? 0, off?.[1] ?? 0, ymax)
          }
        }
        if (cell.mcache) {
          for (const [t, xofs, yofs] of cell.mcache) {
            this.paintTile(TEX.PLAYER, t & TILE_ID_MASK, px, py, xofs, yofs)
          }
        }
      } else if (fg.value > 0) {
        if (cell.base) this.paintTile(TEX.MAIN, cell.base & TILE_ID_MASK, px, py)
        this.paintTile(TEX.MAIN, fg.value, px, py)
        // Parchment overlays for two-sided scrolls. Skip in v1 — needs the
        // PARCHMENT_LOW/HIGH range from tileinfo-main, and the underlying
        // sprite is already rendered above.
      }
    }
    if (inWater) {
      this.withWaterSplit(true, py, cell.trans ? 0.5 : 1.0, cell.trans ? 0.1 : 0.3, drawActor)
    } else if (cell.trans) {
      this.withAlpha(0.55, drawActor)
    } else {
      drawActor()
    }

    // Cloud overlay (drawn after the actor when one is present, so the cloud
    // partially obscures the actor).
    if (cloudId && fg.value > 0) {
      this.withWaterSplit(inWater, py, 0.4, 0.8, () => this.paintTile(TEX.MAIN, cloudId, px, py))
    }

    // ── draw_foreground (cell_renderer.js:898-1090) ────────────────────────

    // Trap markers / item-underneath indicator.
    if (fg.NET) this.paintIcon('TRAP_NET', px, py)
    if (fg.WEB) this.paintIcon('TRAP_WEB', px, py)
    if (fg.S_UNDER) this.paintIcon('SOMETHING_UNDER', px, py)

    // Attitude indicator (small overlay, distinct from the halo).
    if (fg.PET) this.paintIcon('FRIENDLY', px, py)
    else if (fg.GD_NEUTRAL) this.paintIcon('GOOD_NEUTRAL', px, py)
    else if (fg.NEUTRAL) this.paintIcon('NEUTRAL', px, py)

    // Behavior status (mutually exclusive; status_shift accumulates so the
    // next status icons (poison, cell.icons) stack to the left).
    let status_shift = 0
    if (fg.PARALYSED) { this.paintIcon('PARALYSED', px, py); status_shift += 12 }
    else if (fg.STAB) { this.paintIcon('STAB_BRAND', px, py); status_shift += 12 }
    else if (fg.MAY_STAB) { this.paintIcon('UNAWARE', px, py); status_shift += 7 }
    else if (fg.FLEEING) { this.paintIcon('FLEEING', px, py); status_shift += 3 }

    if (fg.POISON) { this.paintIcon('POISON', px, py, -status_shift, 0); status_shift += 5 }
    else if (fg.MORE_POISON) { this.paintIcon('MORE_POISON', px, py, -status_shift, 0); status_shift += 5 }
    else if (fg.MAX_POISON) { this.paintIcon('MAX_POISON', px, py, -status_shift, 0); status_shift += 5 }

    // Server-supplied generic status icons (HASTE, CONFUSED, summoning, etc.).
    if (cell.icons) {
      for (const id of cell.icons) {
        if (id > 0) {
          this.paintTile(TEX.ICONS, id & TILE_ID_MASK, px, py, -status_shift, 0)
          status_shift += 5
        }
      }
    }

    // Main-atlas overlays from cell.ov (zaps/effects, drawn on top of clouds).
    if (cell.ov) {
      for (const o of cell.ov) {
        if (o > this.featMax && o < this.mainMax) this.paintTile(TEX.MAIN, o, px, py)
      }
    }

    // FOV/range meshes (replaces the simple dim overlay).
    const hasContent = bg.value > 0 || fg.value > 0
    if (bg.UNSEEN && hasContent) this.paintIcon('MESH', px, py)
    if (bg.OOR && hasContent) this.paintIcon('OOR_MESH', px, py)
    if (bg.MM_UNSEEN && hasContent) this.paintIcon('MAGIC_MAP_MESH', px, py)

    // Rampage-target marker (winged-boot icon). Reference draws it after the
    // mesh overlays and before NEW_STAIR — cell_renderer.js `draw_foreground`.
    if (bg.RAMPAGE) this.paintIcon('RAMPAGE', px, py)

    if (bg.NEW_STAIR && status_shift === 0) this.paintIcon('NEW_STAIR', px, py)
    if (bg.NEW_TRANSPORTER && status_shift === 0) this.paintIcon('NEW_TRANSPORTER', px, py)

    // Travel-exclusion foreground ring (only renders on memorised-but-unseen
    // cells — visible counterpart lives in the background layer).
    if (bg.EXCL_CTR && bg.UNSEEN) this.paintIcon('TRAVEL_EXCLUSION_CENTRE_FG', px, py)
    else if (bg.TRAV_EXCL && bg.UNSEEN) this.paintIcon('TRAVEL_EXCLUSION_FG', px, py)

    // Cursor stack (cell_renderer.js:1037-1053). Only CURSOR3 — the green
    // autopickup outline — actually fires in v0.34 WebTiles; the examine /
    // tutorial / map cursors arrive as {msg:"cursor"} and are routed through
    // paintCursorIfHere at the bottom of this function (mirrors render_cursors
    // in cell_renderer.js). The other three branches here mirror the reference
    // bg-flag dispatch in case a future protocol revision sets them on the wire
    // (same dead-branch pattern as KRAKEN_SW / ELDRITCH_* in decodeBg).
    if (bg.TUT_CURSOR) this.paintIcon('TUTORIAL_CURSOR', px, py)
    else if (bg.CURSOR1) this.paintIcon('CURSOR', px, py)
    else if (bg.CURSOR2) this.paintIcon('CURSOR2', px, py)
    else if (bg.CURSOR3) this.paintIcon('CURSOR3', px, py)

    // Travel-trail breadcrumbs. Nibbles index into TRAVEL_PATH_FROM/TO runs.
    if (cell.travel_trail) {
      const fromN = cell.travel_trail & 0xF
      const toN = (cell.travel_trail & 0xF0) >> 4
      const fromBase = this.icons.TRAVEL_PATH_FROM
      const toBase = this.icons.TRAVEL_PATH_TO
      if (fromN && fromBase !== undefined) this.paintTile(TEX.ICONS, fromBase + fromN - 1, px, py)
      if (toN && toBase !== undefined) this.paintTile(TEX.ICONS, toBase + toN - 1, px, py)
    }

    // MDAM damage bar (5 levels).
    if (fg.MDAM_LIGHT) this.paintIcon('MDAM_LIGHTLY_DAMAGED', px, py)
    else if (fg.MDAM_MOD) this.paintIcon('MDAM_MODERATELY_DAMAGED', px, py)
    else if (fg.MDAM_HEAVY) this.paintIcon('MDAM_HEAVILY_DAMAGED', px, py)
    else if (fg.MDAM_SEV) this.paintIcon('MDAM_SEVERELY_DAMAGED', px, py)
    else if (fg.MDAM_ADEAD) this.paintIcon('MDAM_ALMOST_DEAD', px, py)

    // Flash (damage flash, spell impact, sanctuary, blind, …). Last so it
    // tints everything below.
    const flash = flashColor(cell.flc, cell.fla)
    if (flash) {
      this.ctx.fillStyle = flash
      this.ctx.fillRect(px, py, ATLAS_CELL, ATLAS_CELL)
    }

    this.paintCursorIfHere(mx, my, px, py)
  }

  // Reference's draw_blood_overlay (cell_renderer.js:628-663). Picks one of
  // liquefied / bloody and draws the animation frame selected by cell.flv.s.
  // is_wall switches between BLOOD (floor) and WALL_BLOOD_S / WALL_OLD_BLOOD
  // (wall variants). The reference also has moldy / glowing_mold branches
  // here, but FPROP_MOLD / FPROP_GLOW_MOLD are defined-but-unused in 0.34 and
  // tileweb.cc never emits the fields — so those cases were dropped.
  private drawBloodOverlay(cell: Cell, px: number, py: number, isWall: boolean): void {
    const s = cell.flv?.s ?? 0
    let baseName: string | null = null
    let bloodRotShift = 0  // additional offset for rotated wall-blood tiles
    if (cell.liquefied && !isWall) {
      baseName = 'LIQUEFACTION'
    } else if (cell.bloody) {
      if (isWall) {
        baseName = cell.old_blood ? 'WALL_OLD_BLOOD' : 'WALL_BLOOD_S'
        const baseId = this.dngn[baseName]
        if (baseId !== undefined) {
          bloodRotShift = (this.tileCount ? this.tileCount(baseId) : 1) * (cell.blood_rotation ?? 0)
        }
      } else {
        baseName = 'BLOOD'
      }
    }
    if (!baseName) return
    const baseId = this.dngn[baseName]
    if (baseId === undefined) return
    const variants = this.tileCount ? this.tileCount(baseId) : 1
    const offset = variants > 0 ? s % variants : 0
    this.paintDngn(baseId + bloodRotShift + offset, px, py)
  }

  // Run `fn` with a global alpha applied, then restore. Equivalent to the
  // ctx.save/globalAlpha/restore dances the reference uses for translucent
  // sprites.
  private withAlpha(alpha: number, fn: () => void): void {
    this.ctx.save()
    try {
      this.ctx.globalAlpha = alpha
      fn()
    } finally {
      this.ctx.restore()
    }
  }

  // Render `fn` twice with the canvas clipped above/below the cell's water
  // line: once at `topAlpha` for the non-submerged half, once at `botAlpha`
  // for the submerged half. The reference uses water_level=20 in atlas-pixel
  // units (out of 32) — i.e. roughly the lower 12 px are "underwater".
  // When `split` is false this collapses to a single full-cell paint at the
  // top alpha — useful for cloud rendering above land.
  private withWaterSplit(
    split: boolean,
    py: number,
    topAlpha: number,
    botAlpha: number,
    fn: () => void,
  ): void {
    if (!split) {
      this.withAlpha(topAlpha, fn)
      return
    }
    // All drawing happens in atlas-pixel space (1 cell = ATLAS_CELL px on the
    // backing canvas); CSS scales the whole canvas. water_level = 20 of 32 in
    // the reference, so the clip line sits 20 px down from the cell top.
    const waterPx = 20
    const cssW = this.viewportW * ATLAS_CELL
    const cssH = this.viewportH * ATLAS_CELL
    // non-submerged half (above the water line)
    this.ctx.save()
    try {
      this.ctx.globalAlpha = topAlpha
      this.ctx.beginPath()
      this.ctx.rect(0, 0, cssW, py + waterPx)
      this.ctx.clip()
      fn()
    } finally {
      this.ctx.restore()
    }
    // submerged half (below the water line)
    this.ctx.save()
    try {
      this.ctx.globalAlpha = botAlpha
      this.ctx.beginPath()
      this.ctx.rect(0, py + waterPx, cssW, cssH - (py + waterPx))
      this.ctx.clip()
      fn()
    } finally {
      this.ctx.restore()
    }
  }

  // Draws a tile dispatched via tileinfo-dngn (HALO_*, THREAT_*, SANCTUARY,
  // KRAKEN_OVERLAY_NW, etc. — tileinfo-dngn routes them to floor/wall/feat
  // per id-range).
  private paintDngn(id: number, px: number, py: number): void {
    const tex = tileLoader.getDngnTexSync(id)
    if (tex !== null) this.paintTile(tex, id, px, py)
  }

  // Looked-up-by-name version of paintDngn. No-op if the name isn't in the
  // resolved table (some constants like ELDRITCH_OVERLAY_* don't exist in
  // older tilesets).
  private paintDngnName(name: string, px: number, py: number): void {
    const id = this.dngn[name]
    if (id !== undefined) this.paintDngn(id, px, py)
  }

  private paintIcon(name: string, px: number, py: number, xofs = 0, yofs = 0): void {
    const id = this.icons[name]
    if (id !== undefined) this.paintTile(TEX.ICONS, id, px, py, xofs, yofs)
  }

  private drawAsciiFallback(cell: Cell, px: number, py: number): void {
    const c = decodeColor(cell.col)
    if (c.bg) {
      this.ctx.fillStyle = c.bg
      this.ctx.fillRect(px, py, ATLAS_CELL, ATLAS_CELL)
    }
    this.ctx.fillStyle = c.fg || DEFAULT_FG
    const fontPx = Math.floor(ATLAS_CELL * 0.95)
    this.ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`
    this.ctx.textBaseline = 'middle'
    this.ctx.textAlign = 'center'
    this.ctx.fillText(cell.g || ' ', px + ATLAS_CELL / 2, py + ATLAS_CELL / 2)
    const flash = flashColor(cell.flc, cell.fla)
    if (flash) {
      this.ctx.fillStyle = flash
      this.ctx.fillRect(px, py, ATLAS_CELL, ATLAS_CELL)
    }
  }

  private paintTile(
    tex: number, id: number,
    px: number, py: number,
    xofs = 0, yofs = 0,
    ymax = 0,
  ): void {
    const s = tileLoader.getSync(tex, id)
    if (!s) return
    // We draw in atlas-pixel space (1 cell = ATLAS_CELL px), so sprite offsets
    // and sizes pass through unscaled — the canvas itself is CSS-scaled to the
    // display size, which keeps tile edges aligned.
    //
    // `ymax` is a cell-relative clip line (in atlas pixels, 0..ATLAS_CELL); 0
    // means no clip. When set, only the top `ymax - dyTop` rows of the sprite
    // are taken from the atlas — matches the `y_max` clamp in cell_renderer.js
    // `draw_tile` and the doll-part CUT_BOTTOM mechanic used for naga/merfolk
    // torsos. Mirrors the reference behavior of reducing both source and
    // destination height by the same amount, never letting the lower edge of
    // the sprite spill below the clip line.
    const dyTop = s.oy + yofs
    let h = s.h
    if (ymax > 0 && ymax < dyTop + s.h) {
      if (ymax <= dyTop) return
      h = ymax - dyTop
    }
    this.ctx.drawImage(s.img, s.sx, s.sy, s.w, h, px + s.ox + xofs, py + dyTop, s.w, h)
  }

  // Mirrors cell_renderer.js render_cursors (line 171): if this cell is the
  // active examine/map cursor location, draw the CURSOR icon on top. The
  // sprite is rltiles/misc/cursor.png — four yellow corner brackets, drawn
  // from the icons atlas. Called at the tail of every drawCell path so the
  // cursor layers correctly over empty cells, ASCII-fallback cells, and the
  // full tile stack.
  //
  // When the icons atlas hasn't preloaded yet (this.ready=false), the
  // paintIcon call no-ops; we draw a plain yellow outline via canvas strokes
  // as a fallback so the user can still tell where the cursor is during the
  // ~1-2 s preload window.
  private paintCursorIfHere(mx: number, my: number, px: number, py: number): void {
    if (!this.cursorLoc) return
    if (this.cursorLoc.x !== mx || this.cursorLoc.y !== my) return
    if (this.ready && this.icons.CURSOR !== undefined) {
      this.paintIcon('CURSOR', px, py)
      return
    }
    this.ctx.save()
    try {
      this.ctx.strokeStyle = '#fce94f'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(px + 1, py + 1, ATLAS_CELL - 2, ATLAS_CELL - 2)
    } finally {
      this.ctx.restore()
    }
  }
}
