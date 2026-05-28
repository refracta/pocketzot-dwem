import type { MapStore } from './map-store'
import { decodeColor, DEFAULT_BG, flashColor } from './colors'

const NORMAL_W = 33
const NORMAL_H = 21
// Zoom mode shrinks the binding-axis minimum so the font has to grow to fit
// fewer cells. 17 keeps LOS (radius 7 ⇒ 15 cells) plus a one-cell border.
const ZOOM_MIN_AXIS = 17
const ZOOM_REDUCTION = 8

// Renders a dynamic viewport window of the map as a grid of <span> elements.
// Each span holds one character and a CSS color. Only dirty cells are updated on redraw.
export class MapView {
  private container: HTMLElement
  private spans: HTMLSpanElement[][] = []
  private store: MapStore
  private viewportW = NORMAL_W
  private viewportH = NORMAL_H
  private fontScale = 1.0
  private zoomMode = false
  // Absolute viewport center (matches vgrdc from server). In normal play equals playerPos.
  private viewCenter = { x: 0, y: 0 }
  private cursorLoc: { x: number; y: number } | null = null
  private cursorSpan: HTMLSpanElement | null = null

  constructor(store: MapStore) {
    this.store = store
    this.container = document.createElement('pre')
    this.container.id = 'map-grid'
    this.container.setAttribute('aria-label', 'Dungeon map')
    this.buildGrid()
  }

  get element(): HTMLElement {
    return this.container
  }

  // Set the absolute viewport center (from vgrdc or playerPos). Returns
  // true if the center actually moved — the server resends vgrdc on every
  // map message (even when nothing panned), so callers gate fullRender on
  // this to keep the dirty-render path live in steady state.
  setViewCenter(c: { x: number; y: number }): boolean {
    const changed = c.x !== this.viewCenter.x || c.y !== this.viewCenter.y
    this.viewCenter = { ...c }
    return changed
  }

  // Multiplier applied to the chosen font size in fitToContainer. Smaller
  // scale ⇒ smaller glyphs ⇒ viewport expansion fits more cells. Caller is
  // expected to invoke fitToContainer() next, matching setViewCenter's pattern.
  setFontScale(scale: number): void {
    this.fontScale = scale
  }

  // User-toggled zoom. When true and fontScale === 1, fitToContainer shrinks
  // both axis minimums (to ZOOM_MIN_AXIS) and raises the font-size cap so
  // glyphs scale up. X-mode sets fontScale ≠ 1 and bypasses zoom so its
  // sizing is unchanged. Caller is expected to invoke fitToContainer() next,
  // matching setFontScale().
  setZoomMode(on: boolean): void {
    this.zoomMode = on
  }

  isZoomMode(): boolean {
    return this.zoomMode
  }

  // Pick font size + viewport dimensions together to fill the container.
  // Font is sized so a minimum viewport fits (33×21 normally; reduced on the
  // binding axis when zoomMode is on); viewport then expands in whichever
  // dimension has spare room so no screen area is wasted.
  fitToContainer(): void {
    const rect = this.container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    // Reset inline font-size so each run measures against the CSS default.
    // Without this, prior runs' inline fontSize feeds back into the probe
    // measurement; sub-pixel rounding of `width: 1ch` differs across font
    // sizes (notably in Safari), producing a cycle where the computed font
    // shifts between two or three values across successive resize ticks.
    this.container.style.fontSize = ''

    const cs = getComputedStyle(this.container)
    const baseFs = parseFloat(cs.fontSize)
    if (!baseFs) return

    // Measure char width with a long probe to amortize sub-pixel rounding.
    // (#map-grid span has width:1ch, so we use a div to escape that rule.)
    const probe = document.createElement('div')
    probe.textContent = '0'.repeat(100)
    probe.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;width:max-content'
    this.container.appendChild(probe)
    const charWPerFs = Math.max(0.1, probe.getBoundingClientRect().width / 100) / baseFs
    probe.remove()

    // Read the line-height multiplier from the CSS custom property directly.
    // getComputedStyle().lineHeight returns the resolved pixel value in Chrome
    // but the unitless number in Safari (per CSSOM spec for `<number>` line-height),
    // so parseFloat()/currentFs gives different answers across browsers.
    const lineHPerFs = parseFloat(cs.getPropertyValue('--map-line-height')) || 0.9

    // Subtract padding read from computed style — hardcoding desyncs from CSS.
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const availW = rect.width - padX
    const availH = rect.height - padY
    if (availW <= 0 || availH <= 0) return

    // Font size that fits the minimum viewport (binding dimension wins).
    // In zoom mode (and only when no X-mode scale override is in effect),
    // shrink BOTH axis minimums to ZOOM_MIN_AXIS and raise the font-size cap.
    // Reducing only the binding axis is insufficient on compact layouts (e.g.
    // the in-game numpad + HUD + log squeeze the map so heightFsBase exceeds
    // the normal 36px cap, leaving font and viewport unchanged across modes);
    // we also need a higher cap so the font can actually grow past 36.
    // ZOOM_MIN_AXIS=17 still fits LOS (radius 7 ⇒ 15 cells) plus a one-cell
    // border on both axes.
    const isZoom = this.zoomMode && this.fontScale === 1.0
    const minW = isZoom ? Math.max(ZOOM_MIN_AXIS, NORMAL_W - ZOOM_REDUCTION) : NORMAL_W
    const minH = isZoom ? Math.max(ZOOM_MIN_AXIS, NORMAL_H - ZOOM_REDUCTION) : NORMAL_H
    const widthFs = availW / (minW * charWPerFs)
    const heightFs = availH / (minH * lineHPerFs)
    const maxFs = isZoom ? 64 : 36
    const fontSize = Math.max(10, Math.min(maxFs, Math.min(widthFs, heightFs))) * this.fontScale
    this.container.style.fontSize = fontSize + 'px'

    // Expand viewport in the slack dimension to fill the container.
    // Hysteresis: only shrink the dimension if the current value genuinely
    // overflows the new container by more than half a cell. A tiny 1–2px
    // resize that crosses an integer boundary in floor(avail/cell) would
    // otherwise drop a row/column to make the rendered grid fit cleanly,
    // when in practice the overflow would just clip a few pixels off the
    // edge — far less disruptive than losing a whole row.
    const charW = fontSize * charWPerFs
    const lineH = fontSize * lineHPerFs
    const fitH = Math.floor(availH / lineH)
    const fitW = Math.floor(availW / charW)
    const keepH = this.viewportH > fitH && this.viewportH * lineH - availH < lineH / 2
    const keepW = this.viewportW > fitW && this.viewportW * charW - availW < charW / 2
    const h = Math.max(minH, keepH ? this.viewportH : fitH)
    const w = Math.max(minW, keepW ? this.viewportW : fitW)

    this.setViewportSize(w, h)
  }

  setViewportSize(w: number, h: number): void {
    if (w === this.viewportW && h === this.viewportH) return
    this.viewportW = w
    this.viewportH = h
    this.buildGrid()
    this.fullRender()
  }

  resetViewportSize(): void {
    this.setViewportSize(NORMAL_W, NORMAL_H)
  }

  // Re-render the viewport centered on viewCenter.
  render(dirty?: Set<string>): void {
    const offX = this.viewCenter.x - Math.floor(this.viewportW / 2)
    const offY = this.viewCenter.y - Math.floor(this.viewportH / 2)

    if (dirty) {
      // Dirty path: iterate just the changed cells. Skipping the full viewport
      // sweep matters when only a handful of cells actually changed (a few
      // monsters moving) but the viewport is ~700 cells. Cells outside the
      // viewport are still in `dirty` (the dungeon changed off-screen) — we
      // bounds-check and skip those.
      for (const key of dirty) {
        const comma = key.indexOf(',')
        const mx = +key.slice(0, comma)
        const my = +key.slice(comma + 1)
        const col = mx - offX
        const row = my - offY
        if (col < 0 || col >= this.viewportW || row < 0 || row >= this.viewportH) continue
        this.#paintSpan(col, row, mx, my)
      }
      return
    }

    for (let row = 0; row < this.viewportH; row++) {
      for (let col = 0; col < this.viewportW; col++) {
        this.#paintSpan(col, row, offX + col, offY + row)
      }
    }
  }

  #paintSpan(col: number, row: number, mx: number, my: number): void {
    const span = this.spans[row][col]
    const cell = this.store.get(mx, my)
    if (cell) {
      const c = decodeColor(cell.col)
      span.textContent = cell.g || ' '
      span.style.color = c.fg
      span.style.backgroundColor = c.bg ?? ''
      // Flash overlay (damage flash, spell impact, blind, sanctuary, etc.).
      // Inset box-shadow paints on top of the background but below the
      // glyph text, so the flash tint layers over any HILITE bg without
      // hiding the cell character.
      const flash = flashColor(cell.flc, cell.fla)
      span.style.boxShadow = flash ? `inset 0 0 0 999px ${flash}` : ''
    } else {
      span.textContent = ' '
      span.style.color = DEFAULT_BG
      span.style.backgroundColor = ''
      span.style.boxShadow = ''
    }
  }

  // Full redraw — called when viewport center or map changes.
  fullRender(): void {
    this.render()
    this.updateCursorSpan()
  }

  // Show or hide the examine cursor.
  // cursor.loc is absolute dungeon coords (same coordinate space as vgrdc/playerPos).
  setCursor(loc?: { x: number; y: number }): void {
    this.cursorLoc = loc ?? null
    this.updateCursorSpan()
  }

  private updateCursorSpan(): void {
    if (this.cursorSpan) { this.cursorSpan.classList.remove('map-cursor'); this.cursorSpan = null }
    if (!this.cursorLoc) return
    const offX = this.viewCenter.x - Math.floor(this.viewportW / 2)
    const offY = this.viewCenter.y - Math.floor(this.viewportH / 2)
    const col = this.cursorLoc.x - offX
    const row = this.cursorLoc.y - offY
    const span = this.spans[row]?.[col]
    if (span) { this.cursorSpan = span; span.classList.add('map-cursor') }
  }

  private buildGrid(): void {
    this.container.textContent = ''
    this.spans = []
    for (let row = 0; row < this.viewportH; row++) {
      const rowDiv = document.createElement('div')
      const rowSpans: HTMLSpanElement[] = []

      for (let col = 0; col < this.viewportW; col++) {
        const span = document.createElement('span')
        span.textContent = ' '
        rowDiv.appendChild(span)
        rowSpans.push(span)
      }

      this.container.appendChild(rowDiv)
      this.spans.push(rowSpans)
    }
  }
}
