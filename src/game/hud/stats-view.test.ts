// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { StatsView } from './stats-view'
import { InventoryStore } from '../inventory-store'

function makeView(): StatsView {
  return new StatsView(new InventoryStore())
}

function pietyEl(v: StatsView): HTMLElement {
  return v.element.querySelector('#hud-piety')!
}

// The identity text spans one element in the compact template (#hud-id) and
// two in the square one (#hud-title + #hud-species); the happy-dom viewport
// decides which template mounts, so read whichever is present.
function identityText(v: StatsView): string {
  const id = v.element.querySelector('#hud-id')
  if (id) return id.textContent ?? ''
  return `${v.element.querySelector('#hud-title')?.textContent ?? ''} ${v.element.querySelector('#hud-species')?.textContent ?? ''}`
}

describe('StatsView piety row', () => {
  it('renders stars + dots for a regular god, including rank 0', () => {
    const v = makeView()
    v.update({ god: 'Okawaru', piety_rank: 3 })
    expect(pietyEl(v).textContent).toBe('***...')
    v.update({ piety_rank: 0 })
    expect(pietyEl(v).textContent).toBe('......')
  })

  it('renders Xom as a mood position, not a level', () => {
    const v = makeView()
    v.update({ god: 'Xom', piety_rank: 2 })
    expect(pietyEl(v).textContent).toBe('..*...')
    v.update({ piety_rank: -1 })  // very special plaything
    expect(pietyEl(v).textContent).toBe('......')
  })

  it('renders ostracism pips as trailing X marks', () => {
    const v = makeView()
    v.update({ god: 'Yredelemnul', piety_rank: 2, ostracism_pips: 2 })
    expect(pietyEl(v).textContent).toBe('**..XX')
    expect(pietyEl(v).querySelector('.fg5')?.textContent).toBe('XX')
  })

  it('toggles the penance tint class', () => {
    const v = makeView()
    v.update({ god: 'Trog', piety_rank: 1, penance: true })
    expect(pietyEl(v).classList.contains('penance')).toBe(true)
    v.update({ penance: false })
    expect(pietyEl(v).classList.contains('penance')).toBe(false)
  })

  it('stays empty for Gozag and the godless', () => {
    const v = makeView()
    v.update({ god: 'Gozag', piety_rank: 6 })
    expect(pietyEl(v).textContent).toBe('')
    v.update({ god: '', piety_rank: 3 })
    expect(pietyEl(v).textContent).toBe('')
  })
})

describe('StatsView weapon row (pre-0.33 equip fallback)', () => {
  function makeArmedView(): StatsView {
    const inv = new InventoryStore()
    inv.update({ 3: { name: '+2 mace', col: 2 } })
    return new StatsView(inv)
  }

  function weaponRow(v: StatsView): HTMLElement {
    return v.element.querySelector('#hud-wq')!
  }

  it('reads the legacy equip map when weapon_index is absent', () => {
    const v = makeArmedView()
    // 0.32-shaped player message: equip map + always-present unarmed_attack
    v.update({ equip: { '0': 3 }, unarmed_attack: 'Nothing wielded' })
    expect(weaponRow(v).textContent).toBe('d) +2 mace')
  })

  it('keeps the weapon across equip deltas touching other slots', () => {
    const v = makeArmedView()
    v.update({ equip: { '0': 3 }, unarmed_attack: 'Nothing wielded' })
    v.update({ equip: { '9': 5 } })  // amulet change only
    expect(weaponRow(v).textContent).toBe('d) +2 mace')
  })

  it('shows the unarmed attack when the legacy weapon slot is empty', () => {
    const v = makeArmedView()
    v.update({ equip: { '0': -1 }, unarmed_attack: 'Nothing wielded' })
    expect(weaponRow(v).textContent).toBe('-) Nothing wielded')
  })

  it('prefers weapon_index (0.33+) when both are present', () => {
    const inv = new InventoryStore()
    inv.update({ 3: { name: '+2 mace', col: 2 }, 4: { name: '+0 dagger', col: 7 } })
    const v = new StatsView(inv)
    v.update({ weapon_index: 4, equip: { '0': 3 } })
    expect(weaponRow(v).textContent).toBe('e) +0 dagger')
  })
})

describe('StatsView identity line', () => {
  it('prefers species_display_name over species', () => {
    const v = makeView()
    v.update({ name: 'Zap', title: 'the Chiller', species: 'Draconian', species_display_name: 'Red Draconian' })
    expect(identityText(v)).toContain('Red Draconian')
  })

  it('joins comma-leading titles without a space', () => {
    const v = makeView()
    v.update({ name: 'Zap', title: ', Duchess of Dis', species: 'Human' })
    expect(identityText(v)).toContain('Zap, Duchess of Dis')
  })

  it('flags wizard and explore games', () => {
    const v = makeView()
    v.update({ name: 'Zap', title: 'the Chiller', species: 'Human', explore: true })
    expect(identityText(v)).toContain('*EXPLORE*')
    v.update({ wizard: 1 })
    expect(identityText(v)).toContain('*WIZARD*')
  })
})
