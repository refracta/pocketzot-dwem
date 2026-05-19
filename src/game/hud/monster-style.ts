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
  const lo = (Array.isArray(fg) ? (fg[0] ?? 0) : fg) >>> 0
  const hi = (Array.isArray(fg) ? (fg[1] ?? 0) : 0) >>> 0
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
  const lo = (Array.isArray(fg) ? (fg[0] ?? 0) : fg) >>> 0
  const hi = (Array.isArray(fg) ? (fg[1] ?? 0) : 0) >>> 0
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

// FG packed-tile → icon-name tables. Used by the monster panel (reads
// t.fg as [lo, hi]) and the describe-monster popup in game-view.ts (single
// 32-bit msg.flag, no poison high-word). Values are tile-constant names in
// `tileinfo-icons`; callers resolve numeric ids at runtime via
// tileLoader.getModule('icons').
export const ATTITUDE_ICONS: Record<number, string> = {
  [FG_PET]: 'FRIENDLY',
  [FG_GD_NEUTRAL]: 'GOOD_NEUTRAL',
  [FG_NEUTRAL]: 'NEUTRAL',
}
// Parallel attitude → dngn-atlas halo tile. The reference's draw_background
// stamps these big coloured rings (HALO_FRIENDLY etc., from feat.png) under
// the foreground sprite for any visible non-hostile cell — separate from the
// small ATTITUDE_ICONS gem drawn on top.
export const ATTITUDE_HALO_DNGN: Record<number, string> = {
  [FG_PET]: 'HALO_FRIENDLY',
  [FG_GD_NEUTRAL]: 'HALO_GD_NEUTRAL',
  [FG_NEUTRAL]: 'HALO_NEUTRAL',
}
export const BEHAVIOUR_ICONS: Record<number, string> = {
  [FG_STAB]: 'STAB_BRAND',
  [FG_MAY_STAB]: 'UNAWARE',
  [FG_FLEEING]: 'FLEEING',
  [FG_PARALYSED]: 'PARALYSED',
}
export const PLAIN_FLAG_ICONS: Array<[number, string]> = [
  [FG_S_UNDER, 'SOMETHING_UNDER'],
  [FG_NET, 'TRAP_NET'],
  [FG_WEB, 'TRAP_WEB'],
]
export const POISON_ICONS: Record<number, string> = {
  [FG_POISON]: 'POISON',
  [FG_MORE_POISON]: 'MORE_POISON',
  [FG_MAX_POISON]: 'MAX_POISON',
}

// Decodes overlay icon-constant names from the low 32 bits of t.fg.
// Used by both the monster panel (lo word of t.fg) and the describe-
// monster popup (msg.flag — same bit layout, single word, no poison).
export function loFlagOverlayIcons(lo: number): string[] {
  const out: string[] = []
  const att = ATTITUDE_ICONS[lo & FG_ATTITUDE_MASK]
  if (att) out.push(att)
  const beh = BEHAVIOUR_ICONS[lo & FG_BEHAVIOUR_MASK]
  if (beh) out.push(beh)
  for (const [bit, name] of PLAIN_FLAG_ICONS) if (lo & bit) out.push(name)
  return out
}

// Full t.fg overlay decode: low-word flags plus poison from the high word.
// Poison only ships in the [lo, hi] two-word form, which is why the
// describe-monster popup (single-word msg.flag) uses loFlagOverlayIcons
// directly instead of this.
export function fgOverlayIcons(fg: number | number[] | undefined): string[] {
  if (fg === undefined) return []
  const lo = Array.isArray(fg) ? (fg[0] ?? 0) : fg
  const hi = Array.isArray(fg) ? (fg[1] ?? 0) : 0
  const out = loFlagOverlayIcons(lo)
  const pois = POISON_ICONS[hi & FG_POISON_MASK_HI]
  if (pois) out.push(pois)
  return out
}

// Selects the dngn halo tile name (HALO_FRIENDLY / HALO_GD_NEUTRAL /
// HALO_NEUTRAL) for a monster's attitude bits. Used as a base layer
// underneath the doll/sprite to mirror cell_renderer.js draw_background.
// Accepts t.fg in either single-word (msg.flag) or [lo, hi] form.
export function fgHaloDngnName(fg: number | number[] | undefined): string | undefined {
  if (fg === undefined) return undefined
  const lo = Array.isArray(fg) ? (fg[0] ?? 0) : fg
  return ATTITUDE_HALO_DNGN[lo & FG_ATTITUDE_MASK]
}

// FG tile id is packed in the low 16 bits of fg.lo (per enums.js fg_flags.mask).
export function fgTileIndex(fg: number | number[] | undefined): number {
  if (fg === undefined) return 0
  const lo = Array.isArray(fg) ? (fg[0] ?? 0) : fg
  return lo & FG_TILE_ID_MASK
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
  if (fg === undefined) return undefined
  const hi = (Array.isArray(fg) ? (fg[1] ?? 0) : 0) >>> 0
  // `>>> 0` re-coerces to uint32 — without it, NASTY (0x80000000) and
  // UNUSUAL (0xE0000000) compare as negative int32 and silently miss.
  const masked = (hi & FG_THREAT_MASK_HI) >>> 0
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
