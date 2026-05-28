// `groupMonsters` is ported from Dungeon Crawl Stone Soup,
// webserver/game_data/static/monster_list.js (group_monsters / can_combine).
// DCSS is Copyright 1997–2025 Linley Henzell, the dev team, and
// contributors; GPL-2.0-or-later. Reused under the "or later" option as
// part of this AGPL-3.0-or-later work. See ATTRIBUTION.md and LICENSE.

import type { Cell, MapStore, MonsterCell } from '../map/map-store'
import { escHtml } from '../dcss-colors'
import { decodeColor } from '../map/colors'
import {
  ATTITUDE_CLASSES, MDAM_COLORS, UNUSUAL_COLOR, decodeFgThreatTier, decodeMdam,
  fgHaloDngnName, fgOverlayIcons, fgTileIndex,
  filterAndSortMonsters, monsterSort, nameColor, threatColor,
} from './monster-style'
import {
  appendIconOverlays, appendTiles, monsterTileSpec,
  prependDngnIndex, prependDngnLayer,
} from '../tiles/tile-view'
import { tileLoader } from '../tiles/tile-loader'
import { bgLo } from '../map/cell-flags'
import { getPref, setPref } from '../../prefs'

// Up to MAX_ROWS top-sorted groups are listed. When more groups exist, a
// small ".ml-corner-more" chip is anchored at the panel's bottom-right
// corner sharing the last row's line — see updateCornerMore().
const MAX_ROWS = 5
const MAX_GLYPHS = 6  // matches reference monster_list.js displayed_monsters
// 32px native tile cell × 0.625 = 20px slot — fits the row's ~18px text
// line-height without forcing a row-height bump that would crowd vertical
// space on a phone. Six slots wide = 120px, comfortably inside the panel's
// max-width on a 360px screen.
const TILE_SCALE = 0.625

function groupMonsters(sorted: MonsterCell[]): MonsterCell[][] {
  const groups: MonsterCell[][] = []
  for (const entry of sorted) {
    const last = groups[groups.length - 1]
    if (last && monsterSort(last[0].mon, entry.mon) === 0) {
      last.push(entry)
    } else {
      groups.push([entry])
    }
  }
  return groups
}

interface RowCache { el: HTMLElement; sig: string }

// Visual inputs shared by all three render paths (ASCII expanded, tile
// expanded, collapsed). label is kept raw — ASCII builder escapes at
// render time; tile builder uses textContent which auto-escapes.
interface RowData {
  hasBar: boolean
  barColor: string
  color: string
  label: string
  hpColor: string
  memberCells: (Cell | undefined)[]
}

export class MonsterListView {
  readonly element: HTMLElement
  private mode: 'ascii' | 'tiles' = 'ascii'
  // Position-indexed row cache (rows[i] = row at group index i). Lets us
  // skip rebuilding a row when its signature is unchanged — sprite paint is
  // async (one microtask per .tile), so wiping and rebuilding would produce
  // a blank-frame flicker even with cached atlases.
  //
  // Why positional and not keyed by monster identity: two groups can sort
  // apart on a field outside the prior `att|type|name|clientid` cache key.
  private rows: RowCache[] = []
  private cornerMoreEl: HTMLElement | null = null
  private lastMonsters: ReadonlyMap<string, MonsterCell> | null = null
  // Sticky across map updates, encounter cycles, empty-view intervals,
  // and page reloads (persisted via prefs.ts → localStorage). Only the
  // user's toggle tap flips it. Chevron follows spatial-motion
  // convention to match the virtual-keyboard button: ▴ when expanded
  // (tap collapses upward), ▾ when collapsed (tap expands downward).
  private collapsed = getPref('monsterListCollapsed')
  private readonly toggleEl: HTMLElement

  constructor(private readonly store: MapStore) {
    this.element = document.createElement('div')
    this.element.id = 'monster-list'

    this.toggleEl = document.createElement('div')
    this.toggleEl.className = 'ml-toggle'
    this.toggleEl.textContent = '▴'
    this.toggleEl.addEventListener('click', (e) => {
      // Panel-level click (game-view.ts) opens the full monster panel on
      // tap-anywhere; stop here so the chevron only toggles.
      e.stopPropagation()
      this.collapsed = !this.collapsed
      setPref('monsterListCollapsed', this.collapsed)
      if (this.lastMonsters) this.update(this.lastMonsters)
    })
  }

  // Called by game-view when the map render mode flips. Resets the DOM and
  // replays from the last monster snapshot so the new mode renders the same
  // entities without waiting for the next `map` message.
  setRenderMode(mode: 'ascii' | 'tiles'): void {
    if (mode === this.mode) return
    this.mode = mode
    this.rows.length = 0
    this.cornerMoreEl = null
    this.element.innerHTML = ''
    // Clear defensively — `update()` re-asserts this from groups when it
    // runs, but if lastMonsters is null (mode swap before any monsters
    // arrived) the class would otherwise persist from the prior mode's
    // last render.
    this.element.classList.remove('has-hostile')
    if (this.lastMonsters) this.update(this.lastMonsters)
  }

  update(monsterCells: ReadonlyMap<string, MonsterCell>): void {
    this.lastMonsters = monsterCells
    const groups = groupMonsters(filterAndSortMonsters(monsterCells))

    // Empty view: tear down DOM so #monster-list:empty hides the panel.
    // The collapsed flag is NOT reset here — the user's chosen mode
    // persists across encounter cycles, so re-encountering monsters
    // returns to whichever mode the user last selected.
    if (groups.length === 0) {
      this.rows.length = 0
      this.cornerMoreEl = null
      this.element.innerHTML = ''
      this.element.classList.remove('has-hostile')
      return
    }

    // Scan all groups, not just the visible ones — a hostile pushed off the
    // bottom of the panel by truncation still constitutes ambient danger
    // and should trigger the red outline.
    let hasHostile = false
    for (const g of groups) {
      if (ATTITUDE_CLASSES[g[0].mon.att ?? 0] === 'hostile') { hasHostile = true; break }
    }
    this.element.classList.toggle('has-hostile', hasHostile)

    let overflow = 0
    if (this.collapsed) {
      // Wipe the expanded-mode caches: a re-expand needs to rebuild from
      // scratch since the DOM no longer holds the cached tile rows.
      this.rows.length = 0
      this.cornerMoreEl = null
      this.renderCollapsed(groups)
    } else {
      const rowCount = Math.min(groups.length, MAX_ROWS)
      // Count hidden *monsters*, not hidden groups, so the chip is a
      // threat-density signal consistent with the collapsed view's
      // "+N" suffix. A single hidden 12-monster group reads as
      // "…+12" rather than "…+1".
      for (let i = rowCount; i < groups.length; i++) overflow += groups[i].length
      // Tile path requires the loader to be configured (atlases known). If
      // we haven't received `game_client` yet, fall back to ASCII rather
      // than paint empty squares; game-view re-runs update() once the
      // loader is ready, swapping the rows to sprites.
      const useTiles = this.mode === 'tiles' && tileLoader.configured
      if (useTiles) {
        this.renderTiles(groups, rowCount)
      } else {
        this.rows.length = 0
        this.cornerMoreEl = null
        this.renderAscii(groups, rowCount)
      }
    }

    // Toggle + corner overflow are both absolute-positioned. Re-append
    // them every render so innerHTML-based rebuilds in the ASCII /
    // collapsed paths don't leave them orphaned; passing overflow=0
    // when collapsed detaches any leftover corner indicator. Skip the
    // toggle when there's only one group: collapsed and expanded would
    // render the same single row (extras=0 suppresses the "+N more"
    // suffix), so the chevron would be a no-op tap target.
    if (groups.length > 1) {
      this.toggleEl.textContent = this.collapsed ? '▾' : '▴'
      this.element.appendChild(this.toggleEl)
    } else {
      this.toggleEl.remove()
    }
    this.updateCornerMore(overflow)
  }

  // Compute visual inputs from a group: threat-bar gate, name color,
  // HP-bar color, label, and the live cells for each displayed member.
  // Read col/fg LIVE from the store rather than relying on MonsterCell —
  // mon-less cell deltas (e.g. sleep→wake) don't refresh MonsterCell, so
  // a snapshot would keep stale status backgrounds after monsters activate.
  //
  // Whole-bar gate: the bar signals "watch out" (named unique, top-tier
  // threat, or unusual loadout). None of those are actionable on an ally,
  // and DCSS gives nearly every individuated monster a clientid (spectrals,
  // zombies, bound souls), so an isNamed-only path would leak the bar onto
  // ally rows. Suppress for everything non-hostile.
  //
  // UNUSUAL is read from the leader's fg high bits; reference renderer
  // paints a magenta tile-border in place of the threat-color border for
  // these and we mirror that on the gutter bar.
  private rowData(group: MonsterCell[]): RowData {
    const mon = group[0].mon
    const att = mon.att ?? 0
    const threat = mon.threat ?? 0

    const showCount = Math.min(group.length, MAX_GLYPHS)
    const memberCells = group.slice(0, showCount).map((m) => this.store.get(m.x, m.y))
    const leaderFg = memberCells[0]?.fg

    const isHostile = ATTITUDE_CLASSES[att] === 'hostile'
    const isNamed = 'clientid' in mon
    const isNasty = threat === 3
    const isUnusual = decodeFgThreatTier(leaderFg) === 'unusual'

    const hasBar = isHostile && (isNamed || isNasty || isUnusual)
    const barColor = isUnusual ? UNUSUAL_COLOR : threatColor(threat)
    const color = nameColor(att, threat)
    const hpColor = group.length === 1
      ? (MDAM_COLORS[decodeMdam(leaderFg)] ?? MDAM_COLORS.uninjured)
      : ''
    const label = group.length > 1
      ? `${group.length} ${mon.plural ?? mon.name ?? '?'}`
      : (mon.name ?? '?')

    return { hasBar, barColor, color, label, hpColor, memberCells }
  }

  private buildAsciiRow(group: MonsterCell[], extraClass?: string, suffix?: string): string {
    const d = this.rowData(group)
    const baseCls = d.hasBar ? 'ml-row ml-bar' : 'ml-row'
    const rowCls = extraClass ? `${baseCls} ${extraClass}` : baseCls
    const rowStyle = d.hasBar ? `--bar-color:${d.barColor}` : ''

    const glyphSpans: string[] = []
    for (let g = 0; g < d.memberCells.length; g++) {
      const col = d.memberCells[g]?.col ?? 7
      const dec = decodeColor(col)
      const style = dec.bg ? `background:${dec.bg};color:${dec.fg}` : `color:${dec.fg}`
      glyphSpans.push(`<span class="ml-glyph" style="${style}">${escHtml(group[g].g)}</span>`)
    }
    const glyphsHtml = `<span class="ml-glyphs">${glyphSpans.join('')}</span>`

    const hpSpan = d.hpColor
      ? `<span class="ml-hp" style="background:${d.hpColor}"></span>`
      : ''
    const suffixHtml = suffix
      ? `<span class="ml-collapsed-more">${suffix}</span>`
      : ''

    return `<div class="${rowCls}"${rowStyle ? ` style="${rowStyle}"` : ''}>`
      + glyphsHtml
      + hpSpan
      + `<span class="ml-name" style="color:${d.color}">${escHtml(d.label)}</span>`
      + suffixHtml
      + `</div>`
  }

  private renderAscii(groups: MonsterCell[][], rows: number): void {
    let html = ''
    for (let i = 0; i < rows; i++) html += this.buildAsciiRow(groups[i])
    this.element.innerHTML = html
  }

  // Single-line collapsed rendition: render the top-priority group's row
  // (glyphs + HP + name + threat-gutter bar) exactly as the expanded
  // view's first row would, then append a "+N" inline suffix where N is
  // the count of monsters NOT in the top group. When N === 0 the suffix
  // is omitted. Both modes share rowData with the expanded renderers,
  // so visual presentation stays identical between collapsed and
  // expanded first rows.
  private renderCollapsed(groups: MonsterCell[][]): void {
    const top = groups[0]
    let total = 0
    for (const g of groups) total += g.length
    const suffix = total > top.length ? `+${total - top.length}` : undefined
    const useTiles = this.mode === 'tiles' && tileLoader.configured

    if (useTiles) {
      const row = this.buildTileRow({ ...this.rowData(top), extraClass: 'ml-collapsed', suffix })
      this.element.innerHTML = ''
      this.element.appendChild(row)
    } else {
      this.element.innerHTML = this.buildAsciiRow(top, 'ml-collapsed', suffix)
    }
  }

  private renderTiles(groups: MonsterCell[][], rows: number): void {
    // Invariant: empty cache → fresh DOM. Without this wipe, transitioning
    // from collapsed (which leaves a single .ml-collapsed row) back to
    // expanded would stack the new tile rows below the stale collapsed
    // row, since the incremental insert path only manages this.rows[].
    if (this.rows.length === 0) {
      this.element.innerHTML = ''
      this.cornerMoreEl = null
    }
    for (let i = 0; i < rows; i++) {
      const d = this.rowData(groups[i])
      // Signature covers every visual input. JSON.stringify is overkill
      // for small numeric tuples but trivially cheap for ~6 entries × 8
      // fields, and avoids hand-rolled hashing bugs.
      const memberSig = d.memberCells.map((c) => [c?.fg ?? 0, c?.t_bg ?? 0, c?.doll ?? null, c?.mcache ?? null, c?.icons ?? null])
      const sig = JSON.stringify([d.hasBar, d.barColor, d.color, d.label, d.hpColor, memberSig])

      const cached = this.rows[i]
      if (cached && cached.sig === sig) continue
      const el = this.buildTileRow(d)
      if (cached) {
        cached.el.replaceWith(el)
      } else {
        // DOM order is irrelevant for the overflow indicator (absolute
        // positioned in the corner) and the toggle (top-right), so just
        // append. update() re-appends both after rendering so they end
        // up after the rows regardless.
        this.element.appendChild(el)
      }
      this.rows[i] = { el, sig }
    }

    // Trim rows past the new count — the visible group list shrank.
    while (this.rows.length > rows) {
      const dropped = this.rows.pop()
      dropped?.el.remove()
    }
  }

  // Overflow indicator anchored to the panel's bottom-right corner,
  // sharing a line with the last row. Expanded-only — the collapsed view
  // carries its own inline +N. Reuses one element across renders so
  // identity is stable when the count just changes. Row-level padding
  // on .ml-row reserves the clearance for the chip; no panel class
  // toggling needed.
  private updateCornerMore(overflow: number): void {
    if (overflow > 0) {
      if (!this.cornerMoreEl) {
        this.cornerMoreEl = document.createElement('div')
        this.cornerMoreEl.className = 'ml-corner-more'
      }
      this.cornerMoreEl.textContent = `+${overflow}`
      this.element.appendChild(this.cornerMoreEl)
    } else if (this.cornerMoreEl) {
      this.cornerMoreEl.remove()
      this.cornerMoreEl = null
    }
  }

  private buildTileRow(opts: RowData & { extraClass?: string; suffix?: string }): HTMLElement {
    const row = document.createElement('div')
    const base = opts.hasBar ? 'ml-row ml-tile-row ml-bar' : 'ml-row ml-tile-row'
    row.className = opts.extraClass ? `${base} ${opts.extraClass}` : base
    if (opts.hasBar) row.style.setProperty('--bar-color', opts.barColor)

    const glyphs = document.createElement('span')
    glyphs.className = 'ml-glyphs ml-glyphs-tiles'
    for (const cell of opts.memberCells) {
      const stack = document.createElement('span')
      stack.className = 'ml-tile tile-stack'

      // Layer order matches MonsterPanelView.renderRow: monster sprite on
      // top, halo below it, floor at the bottom. prependDngn* slots in at
      // index 0 of the DOM (so order calls = bottom-up paint order).
      const baseSpec = monsterTileSpec({
        fg_idx: fgTileIndex(cell?.fg),
        doll: cell?.doll,
        mcache: cell?.mcache,
      })
      if (baseSpec.length > 0) appendTiles(stack, baseSpec, TILE_SCALE)
      const halo = fgHaloDngnName(cell?.fg)
      if (halo) prependDngnLayer(stack, halo, TILE_SCALE)
      if (cell?.t_bg !== undefined) prependDngnIndex(stack, bgLo(cell.t_bg) & 0xFFFF, TILE_SCALE)

      const iconNames = fgOverlayIcons(cell?.fg)
      const iconIds = cell?.icons ?? []
      if (iconNames.length > 0 || iconIds.length > 0) {
        appendIconOverlays(stack, { names: iconNames, ids: iconIds }, TILE_SCALE)
      }

      glyphs.appendChild(stack)
    }
    row.appendChild(glyphs)

    if (opts.hpColor) {
      const hp = document.createElement('span')
      hp.className = 'ml-hp'
      hp.style.background = opts.hpColor
      row.appendChild(hp)
    }

    const name = document.createElement('span')
    name.className = 'ml-name'
    name.style.color = opts.color
    name.textContent = opts.label
    row.appendChild(name)

    if (opts.suffix) {
      const more = document.createElement('span')
      more.className = 'ml-collapsed-more'
      more.textContent = opts.suffix
      row.appendChild(more)
    }

    return row
  }
}
