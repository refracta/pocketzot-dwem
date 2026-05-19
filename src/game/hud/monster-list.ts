// `groupMonsters` is ported from Dungeon Crawl Stone Soup,
// webserver/game_data/static/monster_list.js (group_monsters / can_combine).
// DCSS is Copyright 1997–2025 Linley Henzell, the dev team, and
// contributors; GPL-2.0-or-later. Reused under the "or later" option as
// part of this AGPL-3.0-or-later work. See ATTRIBUTION.md and LICENSE.

import type { MonsterCell } from '../map/map-store'
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

// Up to MAX_ROWS top-sorted groups are listed. When more groups exist, a
// short ml-more strip is appended below them (centered chevron) — not a
// full row, so the panel only grows slightly past its MAX_ROWS height.
const MAX_ROWS = 6
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

export class MonsterListView {
  readonly element: HTMLElement
  private mode: 'ascii' | 'tiles' = 'ascii'
  // Row-keyed cache so repeated `map` messages don't rebuild tile-stack DOM
  // every turn — sprite paint is async (one microtask per .tile), so wiping
  // and rebuilding would produce a blank-frame flicker even with cached
  // atlases.
  private rows = new Map<string, RowCache>()
  private moreEl: HTMLElement | null = null
  private lastMonsters: ReadonlyMap<string, MonsterCell> | null = null

  constructor() {
    this.element = document.createElement('div')
    this.element.id = 'monster-list'
  }

  // Called by game-view when the map render mode flips. Resets the DOM and
  // replays from the last monster snapshot so the new mode renders the same
  // entities without waiting for the next `map` message.
  setRenderMode(mode: 'ascii' | 'tiles'): void {
    if (mode === this.mode) return
    this.mode = mode
    this.rows.clear()
    this.moreEl = null
    this.element.innerHTML = ''
    if (this.lastMonsters) this.update(this.lastMonsters)
  }

  update(monsterCells: ReadonlyMap<string, MonsterCell>): void {
    this.lastMonsters = monsterCells
    const groups = groupMonsters(filterAndSortMonsters(monsterCells))
    const rowCount = Math.min(groups.length, MAX_ROWS)

    // Scan all groups, not just the visible ones — a hostile pushed off the
    // bottom of the panel by truncation still constitutes ambient danger
    // and should trigger the red outline.
    let hasHostile = false
    for (const g of groups) {
      if (ATTITUDE_CLASSES[g[0].mon.att ?? 0] === 'hostile') { hasHostile = true; break }
    }
    this.element.classList.toggle('has-hostile', hasHostile)

    // Tile path requires the loader to be configured (atlases known). If we
    // haven't received `game_client` yet, fall back to ASCII rather than
    // paint empty squares; game-view re-runs update() once the loader is
    // ready, swapping the rows to sprites.
    const useTiles = this.mode === 'tiles' && tileLoader.configured
    if (useTiles) {
      this.renderTiles(groups, rowCount)
    } else {
      this.rows.clear()
      this.moreEl = null
      this.renderAscii(groups, rowCount)
    }
  }

  clear(): void {
    this.rows.clear()
    this.moreEl = null
    this.lastMonsters = null
    this.element.innerHTML = ''
    this.element.classList.remove('has-hostile')
  }

  private renderAscii(groups: MonsterCell[][], rows: number): void {
    let html = ''
    for (let i = 0; i < rows; i++) {
      const group = groups[i]
      const leader = group[0]
      const mon = leader.mon
      const att = mon.att ?? 0
      const threat = mon.threat ?? 0
      const isNamed = 'clientid' in mon
      const isNasty = threat === 3
      // UNUSUAL is read from the leader's fg high bits; it indicates the
      // monster carries items unusual for its species (worth examining).
      // Reference renderer paints a magenta tile-border in place of the
      // threat-color border for these — we mirror that on the gutter bar.
      const isUnusual = decodeFgThreatTier(leader.fg) === 'unusual'
      const color = nameColor(att, threat)

      // Row highlight: named, unnamed-nasty, or unusual-items get a left
      // gutter bar rendered by .ml-bar::before in the panel's left padding.
      const hasBar = isNamed || isNasty || isUnusual
      const barColor = isUnusual ? UNUSUAL_COLOR : threatColor(threat)
      const rowCls = hasBar ? 'ml-row ml-bar' : 'ml-row'
      const rowStyle = hasBar ? `--bar-color:${barColor}` : ''

      // Render up to MAX_GLYPHS individual glyph spans, each with its own col byte
      // so per-monster status backgrounds (sleeping=blue, wandering=brown, etc.)
      // are visible even when the group is mixed.
      const showCount = Math.min(group.length, MAX_GLYPHS)
      const glyphSpans: string[] = []
      for (let g = 0; g < showCount; g++) {
        const mc = group[g]
        const dec = decodeColor(mc.col)
        const style = dec.bg ? `background:${dec.bg};color:${dec.fg}` : `color:${dec.fg}`
        glyphSpans.push(`<span class="ml-glyph" style="${style}">${escHtml(mc.g)}</span>`)
      }
      const glyphsHtml = `<span class="ml-glyphs">${glyphSpans.join('')}</span>`

      // Health indicator (single monsters only, matches reference)
      let hpSpan = ''
      if (group.length === 1) {
        const mdam = decodeMdam(leader.fg)
        const hpColor = MDAM_COLORS[mdam] ?? MDAM_COLORS.uninjured
        hpSpan = `<span class="ml-hp" style="background:${hpColor}"></span>`
      }

      const label = group.length > 1
        ? `${group.length} ${escHtml(mon.plural ?? mon.name ?? '?')}`
        : escHtml(mon.name ?? '?')

      html += `<div class="${rowCls}"${rowStyle ? ` style="${rowStyle}"` : ''}>`
        + glyphsHtml
        + hpSpan
        + `<span class="ml-name" style="color:${color}">${label}</span>`
        + `</div>`

      if (i === rows - 1 && rows < groups.length) {
        html += `<div class="ml-more">▾ +${groups.length - rows}</div>`
      }
    }
    this.element.innerHTML = html
  }

  private renderTiles(groups: MonsterCell[][], rows: number): void {
    const newKeys: string[] = []
    for (let i = 0; i < rows; i++) {
      const group = groups[i]
      const leader = group[0]
      const mon = leader.mon
      const att = mon.att ?? 0
      const threat = mon.threat ?? 0
      const isNamed = 'clientid' in mon
      const isNasty = threat === 3
      const isUnusual = decodeFgThreatTier(leader.fg) === 'unusual'
      const color = nameColor(att, threat)
      const hasBar = isNamed || isNasty || isUnusual
      const barColor = isUnusual ? UNUSUAL_COLOR : threatColor(threat)

      // Per-group identity. monsterSort only collapses entries with matching
      // (att, avghp, type, named-status, name, clientid), so two distinct
      // groups can't share this key. Named monsters carry clientid for
      // uniqueness.
      const clientid = (mon as { clientid?: number }).clientid
      const key = `${att}|${mon.type ?? ''}|${mon.name ?? ''}|${clientid ?? ''}`
      newKeys.push(key)

      const showCount = Math.min(group.length, MAX_GLYPHS)
      const members = group.slice(0, showCount)

      const hpColor = group.length === 1
        ? (MDAM_COLORS[decodeMdam(leader.fg)] ?? MDAM_COLORS.uninjured)
        : ''

      const label = group.length > 1
        ? `${group.length} ${mon.plural ?? mon.name ?? '?'}`
        : (mon.name ?? '?')

      // Signature covers every visual input. JSON.stringify is overkill for
      // small numeric tuples but trivially cheap for ~6 entries × 8 fields,
      // and avoids hand-rolled hashing bugs.
      const memberSig = members.map((m) => [m.fg ?? 0, m.t_bg ?? 0, m.doll ?? null, m.mcache ?? null, m.icons ?? null])
      const sig = JSON.stringify([hasBar, barColor, color, label, hpColor, memberSig])

      const cached = this.rows.get(key)
      let el: HTMLElement
      if (cached && cached.sig === sig) {
        el = cached.el
      } else {
        // Detach the previous element for this key before inserting the
        // replacement — otherwise insertBefore(newEl, oldEl) would leave the
        // stale row in the DOM as a sibling, and the cleanup loop wouldn't
        // catch it because the key is still in newKeys.
        if (cached) cached.el.remove()
        el = this.buildTileRow({ hasBar, barColor, color, label, hpColor, members })
        this.rows.set(key, { el, sig })
      }

      const existing = this.element.children[i]
      if (existing !== el) this.element.insertBefore(el, existing ?? null)
    }

    // Drop rows that no longer appear in the sorted group list.
    for (const key of [...this.rows.keys()]) {
      if (!newKeys.includes(key)) {
        const entry = this.rows.get(key)!
        entry.el.remove()
        this.rows.delete(key)
      }
    }

    // "More" indicator. Reuses one element across renders so identity stays
    // stable when the truncation state doesn't change.
    if (rows < groups.length) {
      if (!this.moreEl) {
        this.moreEl = document.createElement('div')
        this.moreEl.className = 'ml-more'
      }
      // textContent updated every render so the count tracks group changes.
      this.moreEl.textContent = `▾ +${groups.length - rows}`
      const expectedIdx = rows
      if (this.element.children[expectedIdx] !== this.moreEl) {
        this.element.insertBefore(this.moreEl, this.element.children[expectedIdx] ?? null)
      }
    } else if (this.moreEl) {
      this.moreEl.remove()
      this.moreEl = null
    }
  }

  private buildTileRow(opts: {
    hasBar: boolean
    barColor: string
    color: string
    label: string
    hpColor: string
    members: MonsterCell[]
  }): HTMLElement {
    const row = document.createElement('div')
    row.className = opts.hasBar ? 'ml-row ml-tile-row ml-bar' : 'ml-row ml-tile-row'
    if (opts.hasBar) row.style.setProperty('--bar-color', opts.barColor)

    const glyphs = document.createElement('span')
    glyphs.className = 'ml-glyphs ml-glyphs-tiles'
    for (const mc of opts.members) {
      const stack = document.createElement('span')
      stack.className = 'ml-tile tile-stack'

      // Layer order matches MonsterPanelView.renderRow: monster sprite on
      // top, halo below it, floor at the bottom. prependDngn* slots in at
      // index 0 of the DOM (so order calls = bottom-up paint order).
      const baseSpec = monsterTileSpec({
        fg_idx: fgTileIndex(mc.fg),
        doll: mc.doll,
        mcache: mc.mcache,
      })
      if (baseSpec.length > 0) appendTiles(stack, baseSpec, TILE_SCALE)
      const halo = fgHaloDngnName(mc.fg)
      if (halo) prependDngnLayer(stack, halo, TILE_SCALE)
      if (mc.t_bg !== undefined) prependDngnIndex(stack, mc.t_bg & 0xFFFF, TILE_SCALE)

      const iconNames = fgOverlayIcons(mc.fg)
      const iconIds = mc.icons ?? []
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

    return row
  }
}
