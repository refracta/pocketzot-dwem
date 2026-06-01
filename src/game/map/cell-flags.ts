// Tile flag bit constants for the WebTiles protocol — the single in-repo
// definition every decoder that reads `t.fg` / `t.bg` imports from, kept
// in lockstep with crawl-ref/source/webserver/game_data/static/enums.js.
//
// These bit positions are fixed by the WebTiles wire protocol; the
// client must match them exactly or it mis-decodes the cell. See
// ATTRIBUTION.md.
//
// `t.fg` arrives as `number` (low word) or `[lo, hi]` (when high-word bits
// are set — poison, threat tier, ghost, MDAM_SEV/ADEAD). `t.bg` uses the
// same encoding: a single number when only lo-word bits are set, or
// `[lo, hi]` when any hi-word flag fires (RAMPAGE, KRAKEN_SW). Coercing
// the array form with `& 0xFFFF` silently yields 0 (NaN >>> 0), which kills
// the floor paint — always go through `bgLo()` / `bgHi()` (below).
// Use `>>> 0` to coerce to uint32 before masking high-bit values; bitwise
// `&` in JS yields int32 and `0x80000000` would otherwise compare as a
// negative number.

// ── fg low-word ────────────────────────────────────────────────────────────

export const FG_TILE_ID_MASK = 0xFFFF

export const FG_ATTITUDE_MASK = 0x00030000
export const FG_PET           = 0x00010000  // player ally (friendly)
export const FG_GD_NEUTRAL    = 0x00020000  // good_neutral (e.g. priest of same god)
export const FG_NEUTRAL       = 0x00030000

export const FG_S_UNDER       = 0x00040000  // item beneath monster
export const FG_FLYING        = 0x00080000

export const FG_BEHAVIOUR_MASK = 0x00700000
export const FG_STAB          = 0x00100000  // asleep / stabbable
export const FG_MAY_STAB      = 0x00200000  // wandering / may-stab
export const FG_FLEEING       = 0x00300000
export const FG_PARALYSED     = 0x00400000

export const FG_NET           = 0x00800000  // caught in a net
export const FG_WEB           = 0x01000000  // webbed

// MDAM is the only field split across both words: bits 30-31 of lo combine
// with bit 0 of hi to encode six damage states.
//   (loMasked, hiMasked) → state
//   (0,           0)     → uninjured
//   (LIGHT_LO,    0)     → lightly_damaged
//   (MOD_LO,      0)     → moderately_damaged
//   (HEAVY_LO,    0)     → heavily_damaged
//   (0,           1)     → severely_damaged
//   (HEAVY_LO,    1)     → almost_dead
export const FG_MDAM_LO_MASK  = 0xC0000000
export const FG_MDAM_LIGHT_LO = 0x40000000
export const FG_MDAM_MOD_LO   = 0x80000000
export const FG_MDAM_HEAVY_LO = 0xC0000000

// ── fg high-word ───────────────────────────────────────────────────────────

export const FG_MDAM_HI_BIT   = 0x01

export const FG_GHOST         = 0x00100000

export const FG_POISON_MASK_HI = 0x18000000
export const FG_POISON         = 0x08000000  // poisoned
export const FG_MORE_POISON    = 0x10000000  // very poisoned
export const FG_MAX_POISON     = 0x18000000  // extremely poisoned

export const FG_THREAT_MASK_HI = 0xE0000000
export const FG_THREAT_TRIVIAL = 0x20000000
export const FG_THREAT_EASY    = 0x40000000
export const FG_THREAT_TOUGH   = 0x60000000
export const FG_THREAT_NASTY   = 0x80000000
// UNUSUAL is set instead of any threat tier when the monster carries items
// unusual for its species — reference renderer paints a magenta border in
// place of the threat-color border.
export const FG_THREAT_UNUSUAL = 0xE0000000

// ── bg low-word ────────────────────────────────────────────────────────────

export const BG_TILE_ID_MASK     = 0xFFFF

export const BG_MM_UNSEEN        = 0x00020000
export const BG_UNSEEN           = 0x00040000

// CURSOR1/2/3 are *exclusive* flags sharing the 0x00180000 mask (see enums.js
// bg_flags.exclusive_flags) — a simple `(bg & CURSOR3)` would also fire for
// CURSOR1, since CURSOR1 is both bits set. Always test as
// `(bg & BG_CURSOR_MASK) === BG_CURSOR{1,2,3}`. In v0.34 WebTiles only CURSOR3
// is ever set on the wire — it's the green-outline autopickup mark, applied
// in tileview.cc to any cell whose item matches the autopickup rules. The
// examine/map cursors arrive as {msg:"cursor"} instead of bg flags.
export const BG_CURSOR_MASK      = 0x00180000
export const BG_CURSOR1          = 0x00180000
export const BG_CURSOR2          = 0x00080000
export const BG_CURSOR3          = 0x00100000

export const BG_TUT_CURSOR       = 0x00200000
export const BG_TRAV_EXCL        = 0x00400000
export const BG_EXCL_CTR         = 0x00800000
export const BG_OOR              = 0x02000000
export const BG_WATER            = 0x04000000
export const BG_NEW_STAIR        = 0x08000000
export const BG_NEW_TRANSPORTER  = 0x10000000

export const BG_KRAKEN_NW        = 0x20000000
export const BG_KRAKEN_NE        = 0x40000000
export const BG_KRAKEN_SE        = 0x80000000
// KRAKEN_SW lives in a high bg word per enums.js, but v0.34 never sends one
// so it has no constant here.

// ── bg hi-word ─────────────────────────────────────────────────────────────
// RAMPAGE marks cells the player can rampage-attack to (winged-boot icon
// overlay). Defined in enums.js as `bg_flags.flags.RAMPAGE = [0, 0x020]` —
// always arrives as `[lo, hi]`, never as a plain number, so a cell with
// RAMPAGE set will have its `t.bg` be an array on the wire.
export const BG_RAMPAGE_HI       = 0x020

// Returns the lo / hi 32-bit words of a (possibly array-encoded) bg field.
// bg arrives as a single number when all flags fit in 32 bits, and as
// `[lo, hi]` when any hi-word flag (RAMPAGE, KRAKEN_SW) fires. Callers that
// just want the dngn tile id (low 16 bits) or the lo-word flag mask should
// use `bgLo`; rampage / hi-only flags use `bgHi`.
export function bgLo(bg: number | number[] | undefined): number {
  if (bg === undefined) return 0
  if (typeof bg === 'number') return bg >>> 0
  return (bg[0] ?? 0) >>> 0
}
export function bgHi(bg: number | number[] | undefined): number {
  if (bg === undefined || typeof bg === 'number') return 0
  return (bg[1] ?? 0) >>> 0
}

// fg uses the identical single-word-or-[lo, hi] encoding as bg. The `>>> 0`
// uint32 coercion is load-bearing: high-bit fg masks (threat NASTY 0x80000000,
// poison, MDAM hi bit) compare as negative int32 without it. Every t.fg
// consumer should unpack through these rather than re-inlining the ternary.
export function fgLo(fg: number | number[] | undefined): number {
  if (fg === undefined) return 0
  if (typeof fg === 'number') return fg >>> 0
  return (fg[0] ?? 0) >>> 0
}
export function fgHi(fg: number | number[] | undefined): number {
  if (fg === undefined || typeof fg === 'number') return 0
  return (fg[1] ?? 0) >>> 0
}
