import type { MapStore, MonsterCell } from '../map/map-store'
import { decodeColor } from '../map/colors'
import { bgFlags } from '../map/flag-decode'
import { appendTiles, appendIconOverlays, monsterTileSpec, prependDngnIndex, prependDngnLayer } from '../tiles/tile-view'
import type { TileLoader } from '../tiles/tile-loader'
import {
  MDAM_COLORS,
  decodeMdam, mdamTier,
  decodeFgStatuses,
  fgHaloDngnName, fgThreatDngnName, fgTileIndex,
  filterAndSortMonsters, nameColor,
} from './monster-style'

// Sprite scale on the row's left edge. The base tile is 32x32 logical px;
// scale 1.5 lines up with the row's 48px height defined in .mp-tile / .mp-row.
const TILE_SCALE = 1.5

export class MonsterPanelView {
  readonly element: HTMLElement
  private onPickCoord: ((x: number, y: number) => void) | null = null
  // Per-version tile loader; null until game-view supplies it. The tile-view
  // helpers no-op on null, so rows render glyph-only until then.
  private loader: TileLoader | null = null

  constructor(private readonly store: MapStore) {
    this.element = document.createElement('div')
    this.element.className = 'mp-list'
  }

  setOnPickCoord(cb: (x: number, y: number) => void): void {
    this.onPickCoord = cb
  }

  setLoader(loader: TileLoader): void {
    this.loader = loader
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

    for (const mc of list) this.renderRow(mc)
  }

  private renderRow(mc: MonsterCell): void {
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
    // col read live from the cell, not snapshotted on MonsterCell: mon-less
    // cell deltas (e.g. sleep→wake) won't refresh MonsterCell, so a snapshot
    // would keep stale status backgrounds after the monster activated.
    const c = decodeColor(cell?.col ?? 7)
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
    if (baseSpec.length > 0) appendTiles(this.loader, tileEl, baseSpec, TILE_SCALE)
    if (cell?.highlighted_summoner) prependDngnLayer(this.loader, tileEl, 'HALO_SUMMONER', TILE_SCALE)
    const threatWash = fgThreatDngnName(cell?.fg)
    if (threatWash) prependDngnLayer(this.loader, tileEl, threatWash, TILE_SCALE)
    const halo = fgHaloDngnName(cell?.fg)
    if (halo) prependDngnLayer(this.loader, tileEl, halo, TILE_SCALE)
    // Order matters: each prepend slots in at index 0, so the floor (called
    // last) ends up at the bottom of the DOM stack, halo above it, threat
    // wash above that, summoner ring above that, sprite on top — same
    // bottom-up order as the map.
    if (cell?.t_bg !== undefined) prependDngnIndex(this.loader, tileEl, bgFlags(cell.t_bg).value, TILE_SCALE)

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
    // Damage shows as the mp-hp bar above, so no MDAM overlay (includeMdam off).
    // appendIconOverlays self-defers on the icons tileinfo module, so layering
    // it here per row is equivalent to a separate second pass.
    appendIconOverlays(this.loader, tileEl, cell?.fg, cell?.icons ?? [], TILE_SCALE)
  }
}
