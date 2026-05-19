// Tile flag bit constants for the WebTiles protocol — the single in-repo
// definition every decoder that reads `t.fg` / `t.bg` imports from, kept
// in lockstep with crawl-ref/source/webserver/game_data/static/enums.js.
//
// These bit positions are fixed by the WebTiles wire protocol; the
// client must match them exactly or it mis-decodes the cell. See
// ATTRIBUTION.md.
//
// `t.fg` arrives as `number` (low word) or `[lo, hi]` (when high-word bits
// are set — poison, threat tier, ghost, MDAM_SEV/ADEAD). `t.bg` is a single
// 32-bit word in v0.34. Use `>>> 0` to coerce to uint32 before masking
// high-bit values; bitwise `&` in JS yields int32 and `0x80000000` would
// otherwise compare as a negative number.

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

// ── bg (single word in v0.34) ──────────────────────────────────────────────

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
