// Portions of this file are ported from Dungeon Crawl Stone Soup,
// webserver/game_data/static/cell_renderer.js (split_term_colour,
// term_colour_apply_attributes). DCSS is Copyright 1997–2025
// Linley Henzell, the dev team, and contributors; GPL-2.0-or-later.
// Reused under the "or later" option as part of this AGPL-3.0-or-later
// work. See ATTRIBUTION.md and LICENSE.

// DCSS colour_t byte → CSS color string.
//
// The server encodes the col value as:
//   bits  0-3:  foreground color index (0–15)
//   bits  4-7:  CHATTR attribute (0=NORMAL, 5=REVERSE, 7=HILITE, …)
//   bits  8-11: unused
//   bits 12-15: background color index (0–15), only valid when attr=HILITE
//
// Reference: cell_renderer.js split_term_colour / term_colour_apply_attributes

const PALETTE: readonly string[] = [
  '#000000', // 0  BLACK
  '#0000aa', // 1  BLUE
  '#00aa00', // 2  GREEN
  '#00aaaa', // 3  CYAN
  '#aa0000', // 4  RED
  '#aa00aa', // 5  MAGENTA
  '#aa5500', // 6  BROWN
  '#aaaaaa', // 7  LIGHTGREY
  '#555555', // 8  DARKGREY
  '#5555ff', // 9  LIGHTBLUE
  '#55ff55', // 10 LIGHTGREEN
  '#55ffff', // 11 LIGHTCYAN
  '#ff5555', // 12 LIGHTRED
  '#ff55ff', // 13 LIGHTMAGENTA
  '#ffff55', // 14 YELLOW
  '#ffffff', // 15 WHITE
]

export const DEFAULT_FG = PALETTE[7]   // LIGHTGREY
export const DEFAULT_BG = PALETTE[0]   // BLACK

const CHATTR_REVERSE = 5
const CHATTR_HILITE = 7

export function fgColor(col: number): string {
  return PALETTE[col & 0xf] ?? DEFAULT_FG
}

// Returns the glyph background color string, or null if no highlight applies.
export function bgColor(col: number): string | null {
  const attr = (col >> 4) & 0xf
  if (attr !== CHATTR_HILITE) return null
  const bg = (col >> 12) & 0xf
  return PALETTE[bg] ?? null
}

// Decodes the col byte into final fg/bg CSS colors with CHATTR adjustments.
// HILITE: bg taken from bits 12-15; if bg matches fg, fg forced to BLACK so the
// glyph stays readable. REVERSE: fg/bg swapped — since natural bg is 0=BLACK,
// the cell becomes a colored block with a black glyph (item heaps, travel trail,
// items on traps, fake player cursor). Mirrors term_colour_apply_attributes in
// cell_renderer.js.
export function decodeColor(col: number): { fg: string; bg: string | null } {
  let fgIdx = col & 0xf
  const attr = (col >> 4) & 0xf
  let bgIdx = 0
  if (attr === CHATTR_HILITE) {
    bgIdx = (col >> 12) & 0xf
    if (bgIdx === fgIdx) fgIdx = 0
  } else if (attr === CHATTR_REVERSE) {
    bgIdx = fgIdx
    fgIdx = 0
  }
  return {
    fg: PALETTE[fgIdx] ?? DEFAULT_FG,
    bg: bgIdx > 0 ? (PALETTE[bgIdx] ?? null) : null,
  }
}

// Per-flash-colour-index tint values + default alpha, mirroring view_data.js
// flash_colours. Alpha is in 0..255; the engine sends `fla` to override.
type FlashRGBA = readonly [number, number, number, number]
const FLASH_PALETTE: readonly (FlashRGBA | null)[] = [
  null,                          // 0  BLACK (transparent)
  [  0,   0, 128, 100],          // 1  BLUE
  [  0, 128,   0, 100],          // 2  GREEN
  [  0, 128, 128, 100],          // 3  CYAN
  [128,   0,   0, 100],          // 4  RED
  [150,   0, 150, 100],          // 5  MAGENTA
  [165,  91,   0, 100],          // 6  BROWN
  [ 50,  50,  50, 150],          // 7  LIGHTGRAY
  [  0,   0,   0, 150],          // 8  DARKGRAY
  [ 64,  64, 255, 100],          // 9  LIGHTBLUE
  [ 64, 255,  64, 100],          // 10 LIGHTGREEN
  [  0, 255, 255, 100],          // 11 LIGHTCYAN
  [255,  64,  64, 100],          // 12 LIGHTRED
  [255,  64, 255, 100],          // 13 LIGHTMAGENTA
  [150, 150,   0, 100],          // 14 YELLOW
  [255, 255, 255, 100],          // 15 WHITE
]

// Returns a CSS rgba() string for the given flash colour index + optional alpha
// override, or null when no flash should render. flc=0 / undefined disables.
export function flashColor(flc: number | undefined, fla: number | undefined): string | null {
  if (!flc) return null
  const c = FLASH_PALETTE[flc & 0xf]
  if (!c) return null
  const a = fla && fla > 0 ? fla : c[3]
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(a / 255).toFixed(3)})`
}

export function statusColor(col: number | undefined): string {
  return col !== undefined ? (PALETTE[col & 0xf] ?? DEFAULT_FG) : DEFAULT_FG
}
