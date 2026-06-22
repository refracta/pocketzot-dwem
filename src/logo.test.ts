// @vitest-environment happy-dom
//
// Invariants for the decorated-wordmark roller (src/logo.ts). The morph animation
// is timing-based and verified by eye; here we pin (a) the pure roll logic so a
// palette edit can't silently emit an illegal colour or swap a letter that
// shouldn't, and (b) the substring split — decorateLogo must wrap only the
// LOGO_WORD characters and leave any fork chrome before/after it (a custom suffix
// or build tag) as untouched plain text.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { decorateLogo, rollLogoChar, LOGO_WORD, LOGO_CONFIG } from './logo'

// Letters that have NO lookalike swap (must never change glyph), vs. the rest.
const NO_SWAP = ['k']
const HAS_SWAP = ['P', 'o', 'c', 'e', 't', 'Z']

const savedShift = LOGO_CONFIG.pGlyphShift
afterEach(() => { LOGO_CONFIG.pGlyphShift = savedShift })

describe('rollLogoChar', () => {
  it('every wordmark letter rolls a legible colour (1-15, never black or darkgrey)', () => {
    for (const letter of LOGO_WORD) {
      for (let i = 0; i < 200; i++) {
        const { fg } = rollLogoChar(letter)
        expect(fg).toBeGreaterThanOrEqual(1)
        expect(fg).toBeLessThanOrEqual(15)
        expect(fg).not.toBe(8) // darkgrey — too dim on the dark card
      }
    }
  })

  it('with pGlyphShift = 0, no letter ever changes glyph', () => {
    LOGO_CONFIG.pGlyphShift = 0
    for (const letter of LOGO_WORD) {
      for (let i = 0; i < 50; i++) {
        const roll = rollLogoChar(letter)
        expect(roll.ch).toBe(letter)
        expect(roll.swapped).toBe(false)
      }
    }
  })

  it('with pGlyphShift = 1, swap-capable letters always swap and the others never do', () => {
    LOGO_CONFIG.pGlyphShift = 1
    for (const letter of HAS_SWAP) {
      const roll = rollLogoChar(letter)
      expect(roll.swapped).toBe(true)
      expect(roll.ch).not.toBe(letter)
    }
    for (const letter of NO_SWAP) {
      const roll = rollLogoChar(letter)
      expect(roll.swapped).toBe(false)
      expect(roll.ch).toBe(letter)
    }
  })

  it('a swapped glyph is never an ASCII letter (always a lookalike symbol)', () => {
    LOGO_CONFIG.pGlyphShift = 1
    for (const letter of HAS_SWAP) {
      for (let i = 0; i < 100; i++) {
        const { ch } = rollLogoChar(letter)
        expect(ch).not.toMatch(/[A-Za-z]/)
      }
    }
  })

  it('returns fg = -1 for a character with no entry', () => {
    expect(rollLogoChar(' ').fg).toBe(-1)
  })
})

describe('decorateLogo', () => {
  // pDecorate = 0 suppresses the on-load decoration so each test controls when the
  // roll happens: the split tests get a synchronous plain structure, and the tap
  // test can prove the tap (not the gate) is what lights the wordmark.
  const savedDecorate = LOGO_CONFIG.pDecorate
  beforeEach(() => { LOGO_CONFIG.pDecorate = 0 })
  afterEach(() => { LOGO_CONFIG.pDecorate = savedDecorate })

  const makeTitle = (text: string): HTMLElement => {
    const el = document.createElement('h1')
    el.className = 'login-title'
    el.textContent = text
    return el
  }
  const wordmarkSpans = (el: HTMLElement) => el.querySelectorAll('.logo-ch')
  const spanText = (el: HTMLElement) =>
    [...wordmarkSpans(el)].map((s) => s.textContent).join('')

  it('wraps exactly the LOGO_WORD characters in .logo-ch spans (plain title)', () => {
    const el = makeTitle(LOGO_WORD)
    decorateLogo(el)
    expect(wordmarkSpans(el)).toHaveLength(LOGO_WORD.length)
    expect(spanText(el)).toBe(LOGO_WORD)
    expect(el.textContent).toBe(LOGO_WORD)
  })

  it('keeps a trailing suffix as plain text after the spans', () => {
    const el = makeTitle('PocketZot (fork)')
    decorateLogo(el)
    expect(wordmarkSpans(el)).toHaveLength(LOGO_WORD.length)
    expect(spanText(el)).toBe(LOGO_WORD)             // suffix is NOT inside a span
    expect(el.textContent).toBe('PocketZot (fork)')  // suffix preserved
    const last = el.lastChild
    expect(last).toBeInstanceOf(Text)                // a plain text node, not a span
    expect(last?.textContent).toBe(' (fork)')
  })

  it('keeps a leading prefix as plain text before the spans', () => {
    const el = makeTitle('(fork) PocketZot')
    decorateLogo(el)
    expect(wordmarkSpans(el)).toHaveLength(LOGO_WORD.length)
    expect(spanText(el)).toBe(LOGO_WORD)
    expect(el.textContent).toBe('(fork) PocketZot')
    const first = el.firstChild
    expect(first).toBeInstanceOf(Text)
    expect(first?.textContent).toBe('(fork) ')
  })

  it('leaves the title untouched when LOGO_WORD is absent (renamed fork)', () => {
    const el = makeTitle('MyZot')
    decorateLogo(el)
    expect(wordmarkSpans(el)).toHaveLength(0)
    expect(el.textContent).toBe('MyZot')
  })

  it('is idempotent: re-decorating does not duplicate spans or text', () => {
    const el = makeTitle('PocketZot (fork)')
    decorateLogo(el)
    decorateLogo(el)
    expect(wordmarkSpans(el)).toHaveLength(LOGO_WORD.length)
    expect(el.textContent).toBe('PocketZot (fork)')
  })

  it('tapping forces a fresh roll even when the pDecorate gate is off', () => {
    // Force reduced motion so the tap's roll applies synchronously (no stagger
    // timers); decorateLogo reads matchMedia at call time, so mock it first.
    const savedMM = window.matchMedia
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia
    try {
      const el = makeTitle(LOGO_WORD)
      decorateLogo(el) // pDecorate = 0 → no on-load decoration
      const lit = (s: Element) => [...s.classList].some((c) => /^fg\d+$/.test(c))
      expect(el.classList.contains('logo-tappable')).toBe(true)
      expect([...wordmarkSpans(el)].some(lit)).toBe(false) // plain before the tap
      el.click()
      expect([...wordmarkSpans(el)].every(lit)).toBe(true)  // every letter lit after
    } finally {
      window.matchMedia = savedMM
    }
  })

  it('a tap cancels the pending on-load reveal instead of stacking timers', () => {
    // Motion on (matches:false) so the on-load reveal is delayed via timers; fake
    // timers let us count what's pending without waiting.
    const savedMM = window.matchMedia
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia
    vi.useFakeTimers()
    try {
      LOGO_CONFIG.pDecorate = 1                          // force the delayed on-load decoration
      const el = makeTitle(LOGO_WORD)
      decorateLogo(el)
      expect(vi.getTimerCount()).toBe(LOGO_WORD.length)  // on-load reveal pending, one timer/char
      el.click()                                         // tap re-roll
      expect(vi.getTimerCount()).toBe(LOGO_WORD.length)  // cancelled + rescheduled, NOT doubled
      vi.runAllTimers()                                  // tap reveal completes; no stale on-load fire
      const lit = (s: Element) => [...s.classList].some((c) => /^fg\d+$/.test(c))
      expect([...wordmarkSpans(el)].every(lit)).toBe(true)
    } finally {
      vi.useRealTimers()
      window.matchMedia = savedMM
    }
  })
})
