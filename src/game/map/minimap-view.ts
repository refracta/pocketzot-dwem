// Read-only level minimap: one coloured rect per known cell, keyed by the
// per-cell `mf` (map feature) value the server sends with every map delta.
// Same idea as the reference client's minimap.js, but rendered on demand as
// a tap-to-dismiss overlay instead of an always-on panel.
//
// `mf` values follow the map_feature enum ordering in crawl's map-feature.h.
// That header — NOT the server-loaded enums.js — is the wire truth: the
// MF_* table in enums.js is stale in both 0.34 and trunk (it stops at
// MF_PORTAL, missing the transporter/explore-horizon tail added in 0.21),
// while live captures show the binary sending mf:26 (MF_EXPLORE_HORIZON).
// The enum is append-only in practice (indices 0–23 have matched the
// years-old enums.js forever), so a bundled table is safe across versions;
// unknown future values simply paint nothing.
import type { MapStore } from './map-store'

export const MF_UNSEEN = 0
export const MF_PLAYER = 21

// Colours indexed by mf value. Defaults are crawl's own tile_*_col option
// defaults (initfile.cc), except brightened MF_ITEM and MF_MONS_HOSTILE —
// the upstream #005544/#660000 are near-invisible at phone dot sizes.
//
// Note the MF_MONS_* wire values only occur for *detected-but-unseen*
// monsters and firewood plants: get_cell_map_feature (map-knowledge.cc)
// never classifies a visible monster's cell, so upstream's minimap shows no
// live monsters at all. We go further: paint() overlays the store's visible
// monster index with per-attitude colours (see attColor) — on a phone the
// viewport crops wide-LOS races' sight radius, so in-LOS-but-off-screen
// monsters are exactly what the minimap is for.
export const MF_COLORS: readonly string[] = [
  '#000000', // MF_UNSEEN
  '#333333', // MF_FLOOR
  '#666666', // MF_WALL
  '#222266', // MF_MAP_FLOOR (magic-mapped, not seen)
  '#444499', // MF_MAP_WALL
  '#775544', // MF_DOOR
  '#00b58a', // MF_ITEM (brightened from #005544)
  '#3dbb3d', // MF_MONS_FRIENDLY
  '#b8b83a', // MF_MONS_PEACEFUL
  '#b8b83a', // MF_MONS_NEUTRAL
  '#e03030', // MF_MONS_HOSTILE (detected/invisible marker)
  '#446633', // MF_MONS_NO_EXP (plants/fungi)
  '#00ffff', // MF_STAIR_UP (cyan)
  '#ff00ff', // MF_STAIR_DOWN
  '#ff7788', // MF_STAIR_BRANCH
  '#997700', // MF_FEATURE (altars, fountains, …)
  '#114455', // MF_WATER
  '#552211', // MF_LAVA
  '#aa6644', // MF_TRAP
  '#552266', // MF_EXCL_ROOT
  '#552266', // MF_EXCL
  '#ffffff', // MF_PLAYER
  '#001122', // MF_DEEP_WATER
  '#ffdd00', // MF_PORTAL
  '#0000ff', // MF_TRANSPORTER
  '#5200aa', // MF_TRANSPORTER_LANDING
  '#6b301b', // MF_EXPLORE_HORIZON (autoexplore frontier)
]

// tile_window_col default: the you-are-here viewport rectangle.
const WINDOW_COLOR = '#558855'

// Visible-monster overlay colour by attitude (MonsterInfo.att: 0=hostile,
// 1–3 = neutral tiers, 4=friendly). Matches the MF_MONS_* palette entries.
export function attColor(att: number | undefined): string {
  if (att === 4) return MF_COLORS[7]
  if (att === undefined || att === 0) return MF_COLORS[10]
  return MF_COLORS[8]
}

export interface ViewRect { x: number; y: number; w: number; h: number }

// One explored cell of padding around the crop so the map doesn't touch the
// canvas edge.
const MARGIN = 1
// Device-px-per-cell bounds: ≥2 keeps single-cell features (stairs) visible,
// ≤10 stops a barely-explored level from blowing up into giant blobs.
const MIN_CELL_PX = 2
const MAX_CELL_PX = 10

export class MinimapView {
  readonly element: HTMLElement
  private canvas: HTMLCanvasElement

  // Crop/scale state, kept as first-class fields (not paint() locals) so a
  // future pan gesture can run the pixel↔dungeon transform in reverse:
  // dungeon (x,y) ↔ canvas device px ((x-originX)*cellPx, (y-originY)*cellPx).
  originX = 0
  originY = 0
  cellPx = 0

  constructor(private readonly store: MapStore) {
    this.element = document.createElement('div')
    this.element.className = 'minimap-lens'
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'minimap-canvas'
    this.element.appendChild(this.canvas)
  }

  // Repaint from the store. maxCssW/maxCssH bound the canvas CSS size;
  // viewRect (dungeon coords) draws the you-are-here rectangle when given.
  // Full repaint per call — worst case ~5600 cells, far below jank territory
  // for an on-demand overlay.
  paint(viewRect: ViewRect | null, maxCssW: number, maxCssH: number): void {
    const bounds = this.store.mfBounds()
    if (!bounds || maxCssW <= 0 || maxCssH <= 0) return

    // The bordered minimap region: explored bounds plus breathing margin.
    // Cell scale is chosen from this crop alone, so the map renders as large
    // as the lens allows regardless of what the canvas grows to below.
    const crop = {
      left: bounds.left - MARGIN, top: bounds.top - MARGIN,
      right: bounds.right + MARGIN, bottom: bounds.bottom + MARGIN,
    }
    const cropW = crop.right - crop.left + 1
    const cropH = crop.bottom - crop.top + 1

    // Integer device pixels per cell for crisp edges; CSS size derived back
    // from the device size so the bitmap maps 1:1 onto physical pixels.
    const dpr = window.devicePixelRatio || 1
    this.cellPx = Math.max(MIN_CELL_PX, Math.min(
      MAX_CELL_PX * Math.ceil(dpr),
      Math.floor(Math.min(maxCssW * dpr / cropW, maxCssH * dpr / cropH)),
    ))

    // Early in a level the viewport rectangle is bigger than everything
    // explored. Rather than clip it at the border (confusing) or shrink the
    // map to fit it (the reference's approach — wastes the screen), grow the
    // canvas into the surrounding darkness, as far as the lens allows, so
    // the rectangle draws fully OUTSIDE the bordered region.
    const region = { ...crop }
    if (viewRect) {
      const maxCellsW = Math.floor(maxCssW * dpr / this.cellPx)
      const maxCellsH = Math.floor(maxCssH * dpr / this.cellPx)
      const grow = (want: number, avail: number) => Math.max(0, Math.min(want, avail))
      let availW = maxCellsW - cropW
      region.left -= grow(crop.left - viewRect.x, availW)
      availW = maxCellsW - (region.right - region.left + 1)
      region.right += grow(viewRect.x + viewRect.w - 1 - crop.right, availW)
      let availH = maxCellsH - cropH
      region.top -= grow(crop.top - viewRect.y, availH)
      availH = maxCellsH - (region.bottom - region.top + 1)
      region.bottom += grow(viewRect.y + viewRect.h - 1 - crop.bottom, availH)
    }
    this.originX = region.left
    this.originY = region.top

    // Assigning canvas.width/height clears AND reallocates the backing
    // store even when the value is unchanged — and per-move repaints almost
    // never change the size. Guard both, and the style mirror, so a routine
    // step costs draws only, no realloc / layout write.
    const bw = (region.right - region.left + 1) * this.cellPx
    const bh = (region.bottom - region.top + 1) * this.cellPx
    if (this.canvas.width !== bw) this.canvas.width = bw
    if (this.canvas.height !== bh) this.canvas.height = bh
    const cssW = `${bw / dpr}px`
    const cssH = `${bh / dpr}px`
    if (this.canvas.style.width !== cssW) this.canvas.style.width = cssW
    if (this.canvas.style.height !== cssH) this.canvas.style.height = cssH

    // Crop/scale state above is set even when 2d contexts are unavailable
    // (happy-dom tests); only the drawing below needs a real canvas.
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.store.forEachCell((x, y, cell) => {
      const color = cell.mf ? MF_COLORS[cell.mf] : undefined
      if (!color) return
      ctx.fillStyle = color
      ctx.fillRect((x - this.originX) * this.cellPx, (y - this.originY) * this.cellPx,
                   this.cellPx, this.cellPx)
    })

    // Visible monsters, over terrain: the store's monster index holds
    // exactly the in-FOV displayable set (out-of-FOV cells are dropped from
    // it on every merge), so this is LOS-truthful like the main view.
    for (const mc of this.store.getMonsters().values()) {
      ctx.fillStyle = attColor(mc.mon.att)
      ctx.fillRect((mc.x - this.originX) * this.cellPx, (mc.y - this.originY) * this.cellPx,
                   this.cellPx, this.cellPx)
    }

    if (viewRect) {
      ctx.strokeStyle = WINDOW_COLOR
      ctx.lineWidth = Math.max(1, Math.round(dpr))
      ctx.strokeRect((viewRect.x - this.originX) * this.cellPx + 0.5,
                     (viewRect.y - this.originY) * this.cellPx + 0.5,
                     viewRect.w * this.cellPx - 1,
                     viewRect.h * this.cellPx - 1)
    }

    // Player last, over the viewport stroke: white cell plus a thin outline
    // ring so it stays findable even beside bright features. Skipped when no
    // cell exists at playerPos — a fresh game may briefly have no (or a
    // placeholder 0,0) position before the first real player.pos arrives.
    const p = this.store.playerPos
    if (!this.store.get(p.x, p.y)) return
    const px = (p.x - this.originX) * this.cellPx
    const py = (p.y - this.originY) * this.cellPx
    ctx.fillStyle = MF_COLORS[MF_PLAYER]
    ctx.fillRect(px, py, this.cellPx, this.cellPx)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = Math.max(1, Math.round(dpr))
    ctx.strokeRect(px - this.cellPx + 0.5, py - this.cellPx + 0.5,
                   this.cellPx * 3 - 1, this.cellPx * 3 - 1)
  }
}
