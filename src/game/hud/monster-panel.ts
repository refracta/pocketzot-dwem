import type { MapStore, MonsterCell } from '../map/map-store'
import { decodeColor } from '../map/colors'
import { bgLo } from '../map/cell-flags'
import { appendTiles, appendIconOverlays, monsterTileSpec, prependDngnIndex, prependDngnLayer } from '../tiles/tile-view'
import {
  MDAM_COLORS,
  decodeMdam, mdamTier,
  decodeFgStatuses,
  fgHaloDngnName, fgOverlayIcons, fgTileIndex,
  filterAndSortMonsters, nameColor,
} from './monster-style'

// Sprite scale on the row's left edge. The base tile is 32x32 logical px;
// scale 1.5 lines up with the row's 48px height defined in .mp-tile / .mp-row.
const TILE_SCALE = 1.5

interface RowEntry {
  cell: MonsterCell
  tileEl: HTMLElement
  iconNames: string[]
  iconIds: number[]
}

export class MonsterPanelView {
  readonly element: HTMLElement
  private onPickCoord: ((x: number, y: number) => void) | null = null

  constructor(private readonly store: MapStore) {
    this.element = document.createElement('div')
    this.element.className = 'mp-list'
  }

  setOnPickCoord(cb: (x: number, y: number) => void): void {
    this.onPickCoord = cb
  }

  update(monsterCells: ReadonlyMap<string, MonsterCell>): void {
    const list = filterAndSortMonsters(monsterCells)

    this.element.innerHTML = ''
    if (list.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'mp-empty'
      empty.textContent = 'No monsters in view.'
      this.element.appendChild(empty)
      return
    }

    const entries: RowEntry[] = []
    let anyOverlay = false
    for (const mc of list) {
      const entry = this.renderRow(mc)
      entries.push(entry)
      if (entry.iconNames.length > 0 || entry.iconIds.length > 0) anyOverlay = true
    }
    if (anyOverlay) this.applyOverlays(entries)
  }

  private renderRow(mc: MonsterCell): RowEntry {
    const mon = mc.mon
    const att = mon.att ?? 0
    const threat = mon.threat ?? 0
    const color = nameColor(att, threat)
    const cell = this.store.get(mc.x, mc.y)

    const row = document.createElement('div')
    row.className = 'mp-row'

    const glyphEl = document.createElement('div')
    glyphEl.className = 'mp-glyph'
    glyphEl.textContent = mc.g || ' '
    const c = decodeColor(mc.col)
    glyphEl.style.color = c.fg
    if (c.bg) glyphEl.style.background = c.bg
    row.appendChild(glyphEl)

    const tileEl = document.createElement('div')
    tileEl.className = 'tile-stack mp-tile'
    row.appendChild(tileEl)
    const baseSpec = monsterTileSpec({
      fg_idx: fgTileIndex(cell?.fg),
      doll: cell?.doll,
      mcache: cell?.mcache,
    })
    if (baseSpec.length > 0) appendTiles(tileEl, baseSpec, TILE_SCALE)
    const halo = fgHaloDngnName(cell?.fg)
    if (halo) prependDngnLayer(tileEl, halo, TILE_SCALE)
    // Order matters: each prepend slots in at index 0, so the floor (called
    // last) ends up at the bottom of the DOM stack, halo above, sprite on top.
    if (cell?.t_bg !== undefined) prependDngnIndex(tileEl, bgLo(cell.t_bg) & 0xFFFF, TILE_SCALE)

    const mdam = decodeMdam(cell?.fg)
    const tier = mdamTier(mdam)
    const bar = document.createElement('div')
    bar.className = 'mp-hp-bar'
    const fill = document.createElement('div')
    fill.className = 'mp-hp-fill'
    const fillPct = Math.max(0, Math.min(100, Math.round((6 - tier) / 6 * 100)))
    fill.style.height = `${fillPct}%`
    fill.style.background = MDAM_COLORS[mdam] ?? MDAM_COLORS.uninjured
    bar.appendChild(fill)
    row.appendChild(bar)

    const nameEl = document.createElement('div')
    nameEl.className = 'mp-name'
    nameEl.style.color = color
    nameEl.textContent = mon.name ?? '?'
    const statuses = decodeFgStatuses(cell?.fg)
    if (statuses.length > 0) {
      const statusEl = document.createElement('span')
      statusEl.className = 'mp-status'
      statusEl.textContent = ` (${statuses.join(', ')})`
      nameEl.appendChild(statusEl)
    }
    row.appendChild(nameEl)

    row.addEventListener('click', () => {
      this.onPickCoord?.(mc.x, mc.y)
    })

    this.element.appendChild(row)
    return {
      cell: mc, tileEl,
      iconNames: fgOverlayIcons(cell?.fg),
      iconIds: cell?.icons ?? [],
    }
  }

  private applyOverlays(entries: RowEntry[]): void {
    for (const e of entries) {
      if (e.iconNames.length === 0 && e.iconIds.length === 0) continue
      appendIconOverlays(e.tileEl, { names: e.iconNames, ids: e.iconIds }, TILE_SCALE)
    }
  }
}
