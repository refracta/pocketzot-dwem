import { describe, it, expect } from 'vitest'
import { bgLo, bgHi, BG_RAMPAGE_HI, BG_KRAKEN_SE, BG_UNSEEN } from './cell-flags'

// Regression guard. The header comment in cell-flags.ts names the prior bug:
// callers used `bg & 0xFFFF` directly, which silently yields 0 when bg is the
// [lo, hi] array form (NaN >>> 0), wiping the dngn floor tile id and killing
// the floor paint. bgLo / bgHi exist specifically to coerce both forms.

describe('bgLo', () => {
  it('returns 0 for undefined', () => {
    expect(bgLo(undefined)).toBe(0)
  })

  it('passes plain numbers through (uint32-coerced)', () => {
    expect(bgLo(0)).toBe(0)
    expect(bgLo(0x1234)).toBe(0x1234)
    expect(bgLo(BG_UNSEEN)).toBe(BG_UNSEEN)
  })

  it('coerces high-bit lo word to uint32 (not negative int32)', () => {
    // BG_KRAKEN_SE = 0x80000000 — without `>>> 0`, the int32 form is negative.
    expect(bgLo(BG_KRAKEN_SE)).toBe(0x80000000)
    expect(bgLo(BG_KRAKEN_SE) > 0).toBe(true)
  })

  it('extracts lo word from [lo, hi] array form', () => {
    expect(bgLo([0x1234, BG_RAMPAGE_HI])).toBe(0x1234)
  })

  it('treats missing/undefined lo in array form as 0', () => {
    expect(bgLo([undefined as unknown as number, BG_RAMPAGE_HI])).toBe(0)
  })
})

describe('bgHi', () => {
  it('returns 0 for undefined', () => {
    expect(bgHi(undefined)).toBe(0)
  })

  it('returns 0 for plain number (hi word absent on the wire)', () => {
    // Single-number form means no hi-word flags fired; hi is implicitly 0.
    expect(bgHi(0x12345678)).toBe(0)
    expect(bgHi(BG_KRAKEN_SE)).toBe(0)
  })

  it('extracts hi word from [lo, hi] array form', () => {
    expect(bgHi([0, BG_RAMPAGE_HI])).toBe(BG_RAMPAGE_HI)
  })

  it('treats missing hi in [lo] as 0', () => {
    expect(bgHi([0x1234] as unknown as number[])).toBe(0)
  })
})
