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
