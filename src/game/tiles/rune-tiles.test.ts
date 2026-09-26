import { describe, expect, it } from 'vitest'
import { ORB, runeLabel, runeTileName, runeTileRef } from './rune-tiles'
import { TEX, type TileLoader } from './tile-loader'

describe('runeTileName', () => {
  it('maps every rune_type_name adjective to a dc-item.txt rune const', () => {
    // item-name.cc:984-1006 ↔ dc-item.txt item/misc/runes (trunk 2026-08).
    const expected: Record<string, string> = {
      iron: 'RUNE_DIS', obsidian: 'RUNE_GEHENNA', icy: 'RUNE_COCYTUS', bone: 'RUNE_TARTARUS',
      slimy: 'RUNE_SLIME', silver: 'RUNE_VAULTS', serpentine: 'RUNE_SNAKE', elven: 'RUNE_ELVEN',
      golden: 'RUNE_TOMB', decaying: 'RUNE_SWAMP', barnacled: 'RUNE_SHOALS', gossamer: 'RUNE_SPIDER',
      demonic: 'RUNE_DEMONIC', glowing: 'RUNE_MNOLEG', magical: 'RUNE_LOM_LOBON',
      fiery: 'RUNE_CEREBOV', dark: 'RUNE_GLOORX_VLOQ',
    }
    for (const [word, name] of Object.entries(expected)) expect(runeTileName(word)).toBe(name)
  })
  it('uses the tile name RUNE_ABYSS, not the item enum RUNE_ABYSSAL', () => {
    expect(runeTileName('abyssal')).toBe('RUNE_ABYSS')
  })
  it('falls back to the generic rune for tile-less and unknown words', () => {
    expect(runeTileName('mossy')).toBe('MISC_RUNE_OF_ZOT')
    expect(runeTileName('buggy')).toBe('MISC_RUNE_OF_ZOT')
    expect(runeTileName('crystalline')).toBe('MISC_RUNE_OF_ZOT')
  })
  it('names the Orb', () => {
    expect(runeTileName(ORB)).toBe('ORB')
    expect(runeLabel(ORB)).toBe('Orb of Zot')
    expect(runeLabel('golden')).toBe('golden rune')
  })
})

describe('runeTileRef', () => {
  const loader = {
    getModule: async () => ({ RUNE_TOMB: 4210, MISC_RUNE_OF_ZOT: 4200, ORB: 4300 }),
  } as unknown as TileLoader
  it('resolves by name in the main texture', async () => {
    expect(await runeTileRef(loader, 'golden')).toEqual({ t: 4210, tex: TEX.MAIN })
    expect(await runeTileRef(loader, ORB)).toEqual({ t: 4300, tex: TEX.MAIN })
  })
  it('falls to the generic tile when a mapped const is missing in this version', async () => {
    expect(await runeTileRef(loader, 'iron')).toEqual({ t: 4200, tex: TEX.MAIN })
  })
  it('yields null when even the generic name is absent', async () => {
    const bare = { getModule: async () => ({}) } as unknown as TileLoader
    expect(await runeTileRef(bare, 'golden')).toBeNull()
  })
})
