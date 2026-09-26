// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { marksFor, wrapWithRuneMarks } from './rune-marks'

vi.mock('./rune-sprites', async (orig) => ({
  ...(await orig<typeof import('./rune-sprites')>()),
  fillRuneCells: vi.fn(async () => {}),
}))

describe('marksFor', () => {
  it('marks only entries with a collection or a win', () => {
    expect(marksFor(null)).toBeNull()
    expect(marksFor({})).toBeNull()
    expect(marksFor({ runes: [] })).toBeNull()
    expect(marksFor({ outcome: { reason: 'dead' } })).toBeNull()
    expect(marksFor({ runes: ['golden'] })).toEqual({ runes: ['golden'], won: false })
    expect(marksFor({ outcome: { reason: 'won' } })).toEqual({ runes: [], won: true })
    expect(marksFor({ orb: true })).toEqual({ runes: [], won: true }) // carrying it counts
  })
})

describe('wrapWithRuneMarks', () => {
  it('wraps the doll untouched and fans the most recent runes, pip for the rest', () => {
    const doll = document.createElement('img')
    const wrap = wrapWithRuneMarks(doll, { runes: ['a', 'b', 'c', 'd', 'e'], won: false }, 2)
    expect(wrap.firstElementChild).toBe(doll)
    expect(wrap.querySelector('.doll-mark-orb')).toBeNull()
    const fan = [...wrap.querySelectorAll<HTMLElement>('.doll-mark-fan .rune-cell')].map((c) => c.dataset.rune)
    expect(fan).toEqual(['c', 'd', 'e'])
    expect(wrap.querySelector('.doll-mark-pip')?.textContent).toBe('+2')
  })

  it('badges wins with the Orb and omits the fan when rune-less', () => {
    const wrap = wrapWithRuneMarks(document.createElement('div'), { runes: [], won: true }, 2.5)
    expect(wrap.querySelector('.doll-mark-orb')?.getAttribute('title')).toBe('Orb of Zot')
    expect(wrap.querySelector('.doll-mark-fan')).toBeNull()
    expect(wrap.querySelector('.doll-mark-pip')).toBeNull()
  })

  it('sizes marks from the doll scale, clamped', () => {
    const w = (scale: number) => wrapWithRuneMarks(document.createElement('div'), { runes: ['a'], won: false }, scale)
      .querySelector<HTMLElement>('.doll-mark-fan .rune-cell')!.style.width
    expect(w(2)).toBe('16px')     // shelf doll
    expect(w(2.5)).toBe('20px')   // crypt grid
    expect(w(1)).toBe('14.4px')   // floor
    expect(w(10)).toBe('24px')    // ceiling
  })
})
