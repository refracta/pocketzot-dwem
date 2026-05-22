import { describe, it, expect } from 'vitest'
import {
  decodeMdam, decodeFgStatuses, decodeFgThreatTier,
  fgOverlayIcons, loFlagOverlayIcons, fgTileIndex,
  nameColor, threatColor, isExcluded, monsterSort,
  mdamTier, MDAM_COLORS, THREAT_COLORS, FRIENDLY_COLOR, NEUTRAL_COLOR,
  filterAndSortMonsters,
} from './monster-style'
import type { MonsterInfo } from '../../ws/types'
import type { MonsterCell } from '../map/map-store'
import {
  FG_PET, FG_GD_NEUTRAL, FG_NEUTRAL,
  FG_STAB, FG_MAY_STAB, FG_FLEEING, FG_PARALYSED,
  FG_NET, FG_WEB, FG_S_UNDER,
  FG_MDAM_LIGHT_LO, FG_MDAM_MOD_LO, FG_MDAM_HEAVY_LO, FG_MDAM_HI_BIT,
  FG_POISON, FG_MORE_POISON, FG_MAX_POISON,
  FG_THREAT_TRIVIAL, FG_THREAT_EASY, FG_THREAT_TOUGH, FG_THREAT_NASTY, FG_THREAT_UNUSUAL,
} from '../map/cell-flags'

// ─── decodeMdam ────────────────────────────────────────────────────────────
// State table from cell-flags.ts:
//   (loMasked, hiMasked) → state
//   (0,         0) → uninjured
//   (LIGHT_LO,  0) → lightly_damaged
//   (MOD_LO,    0) → moderately_damaged
//   (HEAVY_LO,  0) → heavily_damaged
//   (0,         1) → severely_damaged
//   (HEAVY_LO,  1) → almost_dead

describe('decodeMdam', () => {
  it('returns uninjured for undefined or zero', () => {
    expect(decodeMdam(undefined)).toBe('uninjured')
    expect(decodeMdam(0)).toBe('uninjured')
    expect(decodeMdam([0, 0])).toBe('uninjured')
  })

  it('lo-only states (no hi bit)', () => {
    expect(decodeMdam(FG_MDAM_LIGHT_LO)).toBe('lightly_damaged')
    expect(decodeMdam(FG_MDAM_MOD_LO)).toBe('moderately_damaged')
    expect(decodeMdam(FG_MDAM_HEAVY_LO)).toBe('heavily_damaged')
  })

  it('hi-bit only → severely_damaged (lo=0, hi=1)', () => {
    expect(decodeMdam([0, FG_MDAM_HI_BIT])).toBe('severely_damaged')
  })

  it('hi-bit + HEAVY_LO → almost_dead', () => {
    expect(decodeMdam([FG_MDAM_HEAVY_LO, FG_MDAM_HI_BIT])).toBe('almost_dead')
  })

  it('regression: HEAVY_LO (0xC0000000) is uint32-coerced, not negative int32', () => {
    // Without `>>> 0`, `(lo & FG_MDAM_LO_MASK)` returns the negative int32
    // form of 0xC0000000, which fails strict-equality against the positive
    // Number literal FG_MDAM_HEAVY_LO. This would silently misreport
    // heavily_damaged as uninjured.
    expect(decodeMdam(0xC0000000)).toBe('heavily_damaged')
  })
})

describe('mdamTier', () => {
  it('maps damage names to ascending tier indices', () => {
    expect(mdamTier('uninjured')).toBe(0)
    expect(mdamTier('almost_dead')).toBe(5)
  })

  it('falls back to 0 for unknown names', () => {
    expect(mdamTier('bogus')).toBe(0)
  })

  it('MDAM_COLORS covers every named tier', () => {
    expect(MDAM_COLORS.uninjured).toBeDefined()
    expect(MDAM_COLORS.almost_dead).toBeDefined()
  })
})

// ─── decodeFgStatuses ──────────────────────────────────────────────────────

describe('decodeFgStatuses', () => {
  it('empty when undefined or zero', () => {
    expect(decodeFgStatuses(undefined)).toEqual([])
    expect(decodeFgStatuses(0)).toEqual([])
  })

  it('decodes each behaviour exclusively', () => {
    expect(decodeFgStatuses(FG_STAB)).toEqual(['asleep'])
    expect(decodeFgStatuses(FG_MAY_STAB)).toEqual(['wandering'])
    expect(decodeFgStatuses(FG_FLEEING)).toEqual(['fleeing'])
    expect(decodeFgStatuses(FG_PARALYSED)).toEqual(['paralysed'])
  })

  it('decodes net + web (independent bits)', () => {
    expect(decodeFgStatuses(FG_NET)).toEqual(['caught'])
    expect(decodeFgStatuses(FG_WEB)).toEqual(['webbed'])
    expect(decodeFgStatuses(FG_NET | FG_WEB)).toEqual(['caught', 'webbed'])
  })

  it('decodes poison tiers from hi word', () => {
    expect(decodeFgStatuses([0, FG_POISON])).toEqual(['poisoned'])
    expect(decodeFgStatuses([0, FG_MORE_POISON])).toEqual(['very poisoned'])
    expect(decodeFgStatuses([0, FG_MAX_POISON])).toEqual(['extremely poisoned'])
  })

  it('combines behaviour + restraint + poison', () => {
    expect(decodeFgStatuses([FG_STAB | FG_NET, FG_POISON]))
      .toEqual(['asleep', 'caught', 'poisoned'])
  })
})

// ─── decodeFgThreatTier ────────────────────────────────────────────────────

describe('decodeFgThreatTier', () => {
  it('returns undefined when no tier set', () => {
    expect(decodeFgThreatTier(undefined)).toBeUndefined()
    expect(decodeFgThreatTier(0)).toBeUndefined()
    expect(decodeFgThreatTier([0, 0])).toBeUndefined()
  })

  it('decodes each tier', () => {
    expect(decodeFgThreatTier([0, FG_THREAT_TRIVIAL])).toBe('trivial')
    expect(decodeFgThreatTier([0, FG_THREAT_EASY])).toBe('easy')
    expect(decodeFgThreatTier([0, FG_THREAT_TOUGH])).toBe('tough')
    expect(decodeFgThreatTier([0, FG_THREAT_NASTY])).toBe('nasty')
    expect(decodeFgThreatTier([0, FG_THREAT_UNUSUAL])).toBe('unusual')
  })

  it('regression: NASTY (0x80000000) is uint32-coerced, not negative int32', () => {
    // Comment in decodeFgThreatTier names this case explicitly: without
    // `>>> 0`, NASTY and UNUSUAL "compare as negative int32 and silently
    // miss" — a dangerous monster would render as no-tier (defaulting to
    // hostile-grey instead of red).
    expect(FG_THREAT_NASTY).toBe(0x80000000)
    expect(decodeFgThreatTier([0, 0x80000000])).toBe('nasty')
    expect(decodeFgThreatTier([0, 0xE0000000])).toBe('unusual')
  })
})

// ─── fg overlay icons ──────────────────────────────────────────────────────

describe('loFlagOverlayIcons', () => {
  it('attitude + behaviour + plain flags compose', () => {
    expect(loFlagOverlayIcons(FG_PET | FG_STAB | FG_NET))
      .toEqual(['FRIENDLY', 'STAB_BRAND', 'TRAP_NET'])
  })

  it('attitude mask is exclusive — only one of PET/GD_NEUTRAL/NEUTRAL', () => {
    expect(loFlagOverlayIcons(FG_GD_NEUTRAL)).toEqual(['GOOD_NEUTRAL'])
    expect(loFlagOverlayIcons(FG_NEUTRAL)).toEqual(['NEUTRAL'])
  })

  it('returns empty for zero', () => {
    expect(loFlagOverlayIcons(0)).toEqual([])
  })
})

describe('fgOverlayIcons', () => {
  it('appends poison icon from hi word', () => {
    expect(fgOverlayIcons([FG_S_UNDER, FG_POISON]))
      .toEqual(['SOMETHING_UNDER', 'POISON'])
  })

  it('plain-number form has no poison (hi is implicit 0)', () => {
    expect(fgOverlayIcons(FG_PET)).toEqual(['FRIENDLY'])
  })

  it('returns empty for undefined', () => {
    expect(fgOverlayIcons(undefined)).toEqual([])
  })
})

describe('fgTileIndex', () => {
  it('extracts low 16 bits of fg.lo', () => {
    expect(fgTileIndex(0x1234)).toBe(0x1234)
    expect(fgTileIndex([0xABCD0042, 0])).toBe(0x0042)
  })

  it('returns 0 for undefined', () => {
    expect(fgTileIndex(undefined)).toBe(0)
  })
})

// ─── nameColor / threatColor ───────────────────────────────────────────────

describe('nameColor', () => {
  it('friendly attitude (4) → green regardless of threat', () => {
    expect(nameColor(4, 0)).toBe(FRIENDLY_COLOR)
    expect(nameColor(4, 3)).toBe(FRIENDLY_COLOR)
  })

  it('non-hostile non-friendly (neutral variants 1/2/3) → brown', () => {
    expect(nameColor(1, 3)).toBe(NEUTRAL_COLOR)
    expect(nameColor(2, 3)).toBe(NEUTRAL_COLOR)
    expect(nameColor(3, 3)).toBe(NEUTRAL_COLOR)
  })

  it('hostile (0) routes through threat color table', () => {
    expect(nameColor(0, 0)).toBe(THREAT_COLORS[0])  // trivial
    expect(nameColor(0, 3)).toBe(THREAT_COLORS[3])  // nasty
  })

  it('unknown attitude defaults to hostile', () => {
    expect(nameColor(99, 2)).toBe(THREAT_COLORS[2])
  })

  it('unknown threat tier falls back to nasty (worst-case visual)', () => {
    expect(threatColor(99)).toBe(THREAT_COLORS[3])
  })
})

// ─── isExcluded ────────────────────────────────────────────────────────────

describe('isExcluded', () => {
  it('sparse delta (no name) is excluded', () => {
    expect(isExcluded({ id: 1 } as MonsterInfo)).toBe(true)
  })

  it('regular monster is not excluded', () => {
    expect(isExcluded({ id: 1, name: 'goblin', typedata: { no_exp: false } }))
      .toBe(false)
  })

  it('no_exp monsters are excluded (plants etc.)', () => {
    expect(isExcluded({ id: 1, name: 'plant', typedata: { no_exp: true } }))
      .toBe(true)
  })

  it('active ballistomycete is kept despite no_exp', () => {
    expect(isExcluded({ id: 1, name: 'active ballistomycete', typedata: { no_exp: true } }))
      .toBe(false)
  })

  it('tentacles are kept despite no_exp', () => {
    expect(isExcluded({ id: 1, name: 'kraken tentacle', typedata: { no_exp: true } }))
      .toBe(false)
  })
})

// ─── monsterSort ───────────────────────────────────────────────────────────

describe('monsterSort', () => {
  const m = (overrides: Partial<MonsterInfo>): MonsterInfo => ({
    id: 1, name: 'x', att: 0, type: 0, typedata: { avghp: 10 }, ...overrides,
  })

  it('attitude ascending (hostile=0 first, friendly=4 last)', () => {
    const hostile = m({ att: 0 })
    const friendly = m({ att: 4 })
    expect(monsterSort(hostile, friendly)).toBeLessThan(0)
    expect(monsterSort(friendly, hostile)).toBeGreaterThan(0)
  })

  it('within same attitude: higher avghp first', () => {
    const big = m({ typedata: { avghp: 100 } })
    const small = m({ typedata: { avghp: 10 } })
    expect(monsterSort(big, small)).toBeLessThan(0)
    expect(monsterSort(small, big)).toBeGreaterThan(0)
  })

  it('within same attitude+hp: lower type id sorts AFTER (reference quirk)', () => {
    // Confirmed from the function body: t1 < t2 returns 1, not -1.
    const lowType = m({ type: 5 })
    const highType = m({ type: 10 })
    expect(monsterSort(lowType, highType)).toBeGreaterThan(0)
    expect(monsterSort(highType, lowType)).toBeLessThan(0)
  })

  it('named (clientid) monsters sort before unnamed siblings', () => {
    const unique = m({ clientid: 42 })
    const generic = m({})  // no clientid key
    expect(monsterSort(unique, generic)).toBeLessThan(0)
    expect(monsterSort(generic, unique)).toBeGreaterThan(0)
  })

  it('equal entries return 0', () => {
    const a = m({})
    const b = m({})
    expect(monsterSort(a, b)).toBe(0)
  })
})

// ─── filterAndSortMonsters integration ─────────────────────────────────────

describe('filterAndSortMonsters', () => {
  it('drops excluded entries and sorts the rest', () => {
    const cells = new Map<string, MonsterCell>([
      ['1,1', { x: 1, y: 1, g: 'P', col: 2,
        mon: { id: 1, name: 'plant', typedata: { no_exp: true } } }],
      ['2,2', { x: 2, y: 2, g: 'g', col: 7,
        mon: { id: 2, name: 'goblin', att: 0, type: 5, typedata: { avghp: 5 } } }],
      ['3,3', { x: 3, y: 3, g: 'D', col: 4,
        mon: { id: 3, name: 'dragon', att: 0, type: 8, typedata: { avghp: 100 } } }],
    ])
    const sorted = filterAndSortMonsters(cells)
    expect(sorted.map(c => c.mon.name)).toEqual(['dragon', 'goblin'])
  })
})
