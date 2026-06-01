// Portions of this file are ported from Dungeon Crawl Stone Soup:
// webserver/game_data/static/cell_renderer.js (the draw_background
// attitude-halo slice) and monster_list.js (monster_sort, is_excluded).
// DCSS is Copyright 1997–2025 Linley Henzell, the dev team, and
// contributors; GPL-2.0-or-later. Reused under the "or later" option as
// part of this AGPL-3.0-or-later work. See ATTRIBUTION.md and LICENSE.

import type { MonsterInfo } from '../../ws/types'
import type { MonsterCell } from '../map/map-store'
import { DCSS_COLOR_MAP } from '../dcss-colors'
import {
  FG_TILE_ID_MASK,
  FG_ATTITUDE_MASK, FG_PET, FG_GD_NEUTRAL, FG_NEUTRAL,
  FG_BEHAVIOUR_MASK, FG_STAB, FG_MAY_STAB, FG_FLEEING, FG_PARALYSED,
  FG_S_UNDER, FG_NET, FG_WEB,
  FG_MDAM_LO_MASK, FG_MDAM_LIGHT_LO, FG_MDAM_MOD_LO, FG_MDAM_HEAVY_LO, FG_MDAM_HI_BIT,
  FG_POISON_MASK_HI, FG_POISON, FG_MORE_POISON, FG_MAX_POISON,
  FG_THREAT_MASK_HI, FG_THREAT_TRIVIAL, FG_THREAT_EASY, FG_THREAT_TOUGH, FG_THREAT_NASTY, FG_THREAT_UNUSUAL,
  fgLo, fgHi,
} from '../map/cell-flags'

// attitude index → class label (mirrors reference monster_list.js)
export const ATTITUDE_CLASSES = ['hostile', 'neutral', 'good_neutral', 'good_neutral', 'friendly'] as const

// Name text colors matching reference style.css (--color-N → DCSS_UI_COLOR palette)
export const THREAT_COLORS = [
  DCSS_COLOR_MAP.darkgrey,    // trivial
  DCSS_COLOR_MAP.lightgrey,   // easy
  DCSS_COLOR_MAP.yellow,      // tough
  DCSS_COLOR_MAP.lightred,    // nasty
] as const
export const FRIENDLY_COLOR = DCSS_COLOR_MAP.green
export const NEUTRAL_COLOR  = DCSS_COLOR_MAP.brown
// "Carries unusual items" cue — matches the magenta THREAT_UNUSUAL tile-border
// the reference renderer stamps under monsters with `has_unusual_items()`.
export const UNUSUAL_COLOR  = DCSS_COLOR_MAP.lightmagenta

// Health indicator colors matching reference style.css
export const MDAM_COLORS: Record<string, string> = {
  uninjured:          DCSS_COLOR_MAP.green,
  lightly_damaged:    DCSS_COLOR_MAP.green,
  moderately_damaged: DCSS_COLOR_MAP.brown,
  heavily_damaged:    DCSS_COLOR_MAP.brown,
  severely_damaged:   DCSS_COLOR_MAP.magenta,
  almost_dead:        DCSS_COLOR_MAP.red,
}

// 6-tier damage scale — used for the monster panel's vertical health bar.
// Index 0 = uninjured (full bar), 5 = almost_dead (almost-empty).
export const MDAM_TIERS = [
  'uninjured', 'lightly_damaged', 'moderately_damaged',
  'heavily_damaged', 'severely_damaged', 'almost_dead',
] as const

export function mdamTier(name: string): number {
  const i = MDAM_TIERS.indexOf(name as typeof MDAM_TIERS[number])
  return i < 0 ? 0 : i
}

// Decodes MDAM damage level from t.fg. fg can be a plain number or [lo, hi]
// two-word encoding (hi needed for severely_damaged / almost_dead). State
// table for the (loMasked, hiMasked) pair is in cell-flags.ts.
export function decodeMdam(fg: number | number[] | undefined): string {
  if (fg === undefined) return 'uninjured'
  const lo = fgLo(fg)
  const hi = fgHi(fg)
  // `& MASK` returns int32, which compares as negative against the positive
  // Number literal `0x80000000` / `0xC0000000`; re-coerce to uint32.
  const loMasked = (lo & FG_MDAM_LO_MASK) >>> 0
  const hiMasked = hi & FG_MDAM_HI_BIT
  if (hiMasked === FG_MDAM_HI_BIT) {
    return loMasked === FG_MDAM_HEAVY_LO ? 'almost_dead' : 'severely_damaged'
  }
  if (loMasked === FG_MDAM_LIGHT_LO) return 'lightly_damaged'
  if (loMasked === FG_MDAM_MOD_LO) return 'moderately_damaged'
  if (loMasked === FG_MDAM_HEAVY_LO) return 'heavily_damaged'
  return 'uninjured'
}

// Decodes monster condition flags from t.fg into short status names.
// These are the only MB_ flags expressed as tile flags in the WebTiles protocol;
// flags like MB_ALLY_TARGET / MB_ABJURABLE are not transmitted via t.fg.
export function decodeFgStatuses(fg: number | number[] | undefined): string[] {
  if (fg === undefined) return []
  const lo = fgLo(fg)
  const hi = fgHi(fg)
  const out: string[] = []

  const beh = lo & FG_BEHAVIOUR_MASK
  if (beh === FG_STAB) out.push('asleep')
  else if (beh === FG_MAY_STAB) out.push('wandering')
  else if (beh === FG_FLEEING) out.push('fleeing')
  else if (beh === FG_PARALYSED) out.push('paralysed')

  if (lo & FG_NET) out.push('caught')
  if (lo & FG_WEB) out.push('webbed')

  const poison = hi & FG_POISON_MASK_HI
  if (poison === FG_POISON) out.push('poisoned')
  else if (poison === FG_MORE_POISON) out.push('very poisoned')
  else if (poison === FG_MAX_POISON) out.push('extremely poisoned')

  return out
}

// Attitude → dngn-atlas halo tile. The reference's draw_background stamps
// these big coloured rings (HALO_FRIENDLY etc., from feat.png) under the
// foreground sprite for any visible non-hostile cell — separate from the
// small attitude gem buildStatusOverlays draws on top.
export const ATTITUDE_HALO_DNGN: Record<number, string> = {
  [FG_PET]: 'HALO_FRIENDLY',
  [FG_GD_NEUTRAL]: 'HALO_GD_NEUTRAL',
  [FG_NEUTRAL]: 'HALO_NEUTRAL',
}

// A status icon to overlay on a monster sprite: either a named tile-constant
// (resolved against tileinfo-icons by the caller) or a raw numeric id from
// cell.icons, plus the cell-space pixel offset draw_foreground would place it at.
export interface IconOverlay { name?: string; id?: number; xofs: number; yofs: number }
export interface StatusOverlays { overlays: IconOverlay[]; statusShift: number }

// Lo-word bits that produce a status overlay (trap/under markers + attitude +
// behaviour). Lets buildStatusOverlays test "any status at all?" in one mask
// for its allocation-free fast path. Poison lives in the hi word, checked
// separately. Shared result for the no-status case — callers only read it.
const STATUS_LO_BITS = FG_NET | FG_WEB | FG_S_UNDER | FG_ATTITUDE_MASK | FG_BEHAVIOUR_MASK
const EMPTY_STATUS_OVERLAYS: StatusOverlays = { overlays: [], statusShift: 0 }

// Cheap, allocation-free predicate: could this (fg, icons) pair produce any
// status overlay at all? The single source of truth for the empty case —
// buildStatusOverlays' fast path uses it to skip allocating, and
// appendIconOverlays uses it to skip the async icons-module load for the
// (common) status-free monster before paying a Promise. includeMdam surfaces
// always pass, since MDAM is decoded on the slow path.
export function mayHaveStatusOverlays(
  fg: number | number[] | undefined,
  icons: readonly number[],
  opts: { includeMdam?: boolean } = {},
): boolean {
  if (opts.includeMdam) return true
  return (fgLo(fg) & STATUS_LO_BITS) !== 0
    || (fgHi(fg) & FG_POISON_MASK_HI) !== 0
    || icons.length > 0
}

// MDAM damage tier → icons tile-constant name; absent (→ undefined) when uninjured.
const MDAM_ICON_NAMES: Record<string, string> = {
  lightly_damaged: 'MDAM_LIGHTLY_DAMAGED',
  moderately_damaged: 'MDAM_MODERATELY_DAMAGED',
  heavily_damaged: 'MDAM_HEAVILY_DAMAGED',
  severely_damaged: 'MDAM_SEVERELY_DAMAGED',
  almost_dead: 'MDAM_ALMOST_DEAD',
}
export function mdamIconName(fg: number | number[] | undefined): string | undefined {
  return MDAM_ICON_NAMES[decodeMdam(fg)]
}

// Single source of truth for "which monster-status icons to draw, in what
// order, at what offset" — a faithful port of cell_renderer.js draw_foreground
// (the status-icon slice, lines 944-1090). Consumed by every surface that
// renders a monster sprite: the canvas map (tile-map-view), the HUD monster
// list, the touch monster panel, and the describe-monster popup. The surfaces
// differ only in the final paint primitive (canvas vs DOM tile); the decision
// lives here exactly once.
//
// `fg` may be a single word (msg.flag — hi == 0, so no poison and no
// severe-or-worse MDAM, exactly as the reference's single-word desc.flag) or
// the [lo, hi] cell form. `sizeMap` is the id→width table from
// buildStatusIconSizeMap (icon-sizes.ts): cell.icons with width < 0 (absent)
// are skipped, width 0 pins the icon at its authored spot, width > 0 fans the
// stack left by that much. Returns the trailing statusShift so the map can gate
// NEW_STAIR / NEW_TRANSPORTER (drawn only when no status icon occupies the corner).
export function buildStatusOverlays(
  fg: number | number[] | undefined,
  icons: readonly number[],
  sizeMap: ReadonlyMap<number, number>,
  opts: { includeMdam?: boolean } = {},
): StatusOverlays {
  const lo = fgLo(fg)
  const hi = fgHi(fg)

  // Fast path: most map cells carry no status bits and no server icons. The
  // canvas map calls this once per rendered cell, so bail before allocating an
  // overlays array + result object in the empty case. (includeMdam surfaces —
  // the describe popup — are rare and skip the fast path so MDAM still decodes.)
  if (!mayHaveStatusOverlays(fg, icons, opts)) return EMPTY_STATUS_OVERLAYS

  const overlays: IconOverlay[] = []

  // Trap / item-underneath markers and attitude gem: fixed authored positions.
  if (lo & FG_NET) overlays.push({ name: 'TRAP_NET', xofs: 0, yofs: 0 })
  if (lo & FG_WEB) overlays.push({ name: 'TRAP_WEB', xofs: 0, yofs: 0 })
  if (lo & FG_S_UNDER) overlays.push({ name: 'SOMETHING_UNDER', xofs: 0, yofs: 0 })

  const att = lo & FG_ATTITUDE_MASK
  if (att === FG_PET) overlays.push({ name: 'FRIENDLY', xofs: 0, yofs: 0 })
  else if (att === FG_GD_NEUTRAL) overlays.push({ name: 'GOOD_NEUTRAL', xofs: 0, yofs: 0 })
  else if (att === FG_NEUTRAL) overlays.push({ name: 'NEUTRAL', xofs: 0, yofs: 0 })

  // Behaviour icon at the corner; bumps status_shift so poison / cell.icons
  // fan to its left. The +12/+7/+3 constants are literals in draw_foreground.
  let shift = 0
  const beh = lo & FG_BEHAVIOUR_MASK
  if (beh === FG_PARALYSED) { overlays.push({ name: 'PARALYSED', xofs: 0, yofs: 0 }); shift += 12 }
  else if (beh === FG_STAB) { overlays.push({ name: 'STAB_BRAND', xofs: 0, yofs: 0 }); shift += 12 }
  else if (beh === FG_MAY_STAB) { overlays.push({ name: 'UNAWARE', xofs: 0, yofs: 0 }); shift += 7 }
  else if (beh === FG_FLEEING) { overlays.push({ name: 'FLEEING', xofs: 0, yofs: 0 }); shift += 3 }

  // `-shift || 0` avoids a -0 xofs when nothing has shifted yet (paints the
  // same, but keeps the overlay data canonical).
  const poison = hi & FG_POISON_MASK_HI
  if (poison === FG_POISON) { overlays.push({ name: 'POISON', xofs: -shift || 0, yofs: 0 }); shift += 5 }
  else if (poison === FG_MORE_POISON) { overlays.push({ name: 'MORE_POISON', xofs: -shift || 0, yofs: 0 }); shift += 5 }
  else if (poison === FG_MAX_POISON) { overlays.push({ name: 'MAX_POISON', xofs: -shift || 0, yofs: 0 }); shift += 5 }

  // Server-supplied status icons, sized via the per-icon width table
  // (draw_icon_type): width < 0 → skip, 0 → fixed position, > 0 → fan then advance.
  for (const id of icons) {
    if (id <= 0) continue
    const w = sizeMap.get(id) ?? -1
    if (w < 0) continue
    if (w === 0) { overlays.push({ id, xofs: 0, yofs: 0 }); continue }
    overlays.push({ id, xofs: -shift || 0, yofs: 0 })
    shift += w
  }

  if (opts.includeMdam) {
    const mdam = mdamIconName(fg)
    if (mdam) overlays.push({ name: mdam, xofs: 0, yofs: 0 })
  }

  return { overlays, statusShift: shift }
}

// Resolve an IconOverlay to its numeric icons-atlas tile id: a named overlay
// looks the tile-constant up in the icons module; a raw-id overlay passes
// through. Returns undefined for an unknown name or a non-positive id. The one
// place the canvas map and the DOM tile path agree on overlay→id dispatch.
export function resolveOverlayId(o: IconOverlay, icons: { [k: string]: unknown }): number | undefined {
  const id = o.name !== undefined ? icons[o.name] : o.id
  return typeof id === 'number' && id > 0 ? id : undefined
}

// Selects the dngn halo tile name (HALO_FRIENDLY / HALO_GD_NEUTRAL /
// HALO_NEUTRAL) for a monster's attitude bits. Used as a base layer
// underneath the doll/sprite to mirror cell_renderer.js draw_background.
// Accepts t.fg in either single-word (msg.flag) or [lo, hi] form.
export function fgHaloDngnName(fg: number | number[] | undefined): string | undefined {
  return ATTITUDE_HALO_DNGN[fgLo(fg) & FG_ATTITUDE_MASK]
}

// FG tile id is packed in the low 16 bits of fg.lo (per enums.js fg_flags.mask).
export function fgTileIndex(fg: number | number[] | undefined): number {
  return fgLo(fg) & FG_TILE_ID_MASK
}

export function nameColor(att: number, threat: number): string {
  const cls = ATTITUDE_CLASSES[att] ?? 'hostile'
  if (cls === 'friendly')  return FRIENDLY_COLOR
  if (cls !== 'hostile')   return NEUTRAL_COLOR
  return THREAT_COLORS[threat] ?? THREAT_COLORS[3]
}

export function threatColor(threat: number): string {
  return THREAT_COLORS[threat] ?? THREAT_COLORS[3]
}

// fg threat-tier bits (enums.js fg_flags 5-way exclusive group, hi word).
// See cell-flags.ts for the bit layout; UNUSUAL is the TOUGH | NASTY
// combination, set instead of a threat tier when the monster carries items
// unusual for its species — reference renderer paints a magenta border in
// place of the threat-color border.
export type FgThreatTier = 'trivial' | 'easy' | 'tough' | 'nasty' | 'unusual'
export function decodeFgThreatTier(fg: number | number[] | undefined): FgThreatTier | undefined {
  // fgHi already uint32-coerces, so NASTY (0x80000000) / UNUSUAL (0xE0000000)
  // mask correctly instead of comparing as negative int32.
  const masked = (fgHi(fg) & FG_THREAT_MASK_HI) >>> 0
  if (masked === FG_THREAT_TRIVIAL) return 'trivial'
  if (masked === FG_THREAT_EASY) return 'easy'
  if (masked === FG_THREAT_TOUGH) return 'tough'
  if (masked === FG_THREAT_NASTY) return 'nasty'
  if (masked === FG_THREAT_UNUSUAL) return 'unusual'
  return undefined
}

export function isExcluded(mon: MonsterInfo): boolean {
  if (!mon.name) return true  // sparse delta — no name means unknown
  return !!(mon.typedata?.no_exp &&
    mon.name !== 'active ballistomycete' &&
    !mon.name?.match(/tentacle$/))
}

// Mirrors monster_info::less_than / reference monster_sort() byte-for-byte.
// Deliberately uses bare `<` / `>` so undefined fields fall through to the
// next key (NaN comparisons are both false), matching the reference instead
// of coercing missing values to 0.
export function monsterSort(m1: MonsterInfo, m2: MonsterInfo): number {
  const a1 = m1.att as number, a2 = m2.att as number
  if (a1 < a2) return -1
  if (a1 > a2) return 1

  const hp1 = m1.typedata?.avghp as number, hp2 = m2.typedata?.avghp as number
  if (hp1 > hp2) return -1
  if (hp1 < hp2) return 1

  const t1 = m1.type as number, t2 = m2.type as number
  if (t1 < t2) return 1
  if (t1 > t2) return -1

  const hasOwn = Object.prototype.hasOwnProperty
  const named1 = hasOwn.call(m1, 'clientid')
  const named2 = hasOwn.call(m2, 'clientid')
  if (named1 || named2) {
    if (!named2) return -1
    if (!named1) return 1
    if ((m1.clientid as number) < (m2.clientid as number)) return -1
    return 1
  }

  const n1 = m1.name as string, n2 = m2.name as string
  if (n1 < n2) return 1
  if (n1 > n2) return -1
  return 0
}

// Shared filter+sort for the HUD list and touch panel — map-store already
// drops non-display monsters at merge time, so isExcluded is mostly a safety
// net for sparse-delta entries that slip through.
export function filterAndSortMonsters(monsters: ReadonlyMap<string, MonsterCell>): MonsterCell[] {
  const list: MonsterCell[] = []
  for (const mc of monsters.values()) {
    if (!isExcluded(mc.mon)) list.push(mc)
  }
  list.sort((a, b) => monsterSort(a.mon, b.mon))
  return list
}
