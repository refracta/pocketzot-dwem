import { describe, it, expect } from 'vitest'
import { abbrevPlace } from './place-abbrev'

describe('abbrevPlace', () => {
  it('abbreviates branches whose abbrevname differs', () => {
    expect(abbrevPlace('Dungeon')).toBe('D')
    expect(abbrevPlace('Elven Halls')).toBe('Elf')
    expect(abbrevPlace('Slime Pits')).toBe('Slime')
    expect(abbrevPlace('Pandemonium')).toBe('Pan')
    expect(abbrevPlace('Ice Cave')).toBe('IceCv')
  })

  it('passes identical-abbrev branches through', () => {
    expect(abbrevPlace('Temple')).toBe('Temple')
    expect(abbrevPlace('Zot')).toBe('Zot')
    expect(abbrevPlace('Depths')).toBe('Depths')
  })

  it('strips tileweb article decoration on single-level branches', () => {
    expect(abbrevPlace('The Abyss')).toBe('Abyss')
    expect(abbrevPlace('a Sewer')).toBe('Sewer')
    expect(abbrevPlace('an Ossuary')).toBe('Ossuary')
    expect(abbrevPlace('a Ziggurat')).toBe('Zig')
  })

  it('passes unknown (future/fork) branch names through un-broken', () => {
    expect(abbrevPlace('Crucible')).toBe('Crucible')
    expect(abbrevPlace('a Gutter Gulch')).toBe('Gutter Gulch')
  })
})
