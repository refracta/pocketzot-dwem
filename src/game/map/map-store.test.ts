import { describe, it, expect } from 'vitest'
import { MapStore } from './map-store'
import type { CellUpdate } from '../../ws/types'

describe('MapStore.merge — coordinate delta encoding', () => {
  it('first update with x and y seeds the cursor', () => {
    const store = new MapStore()
    store.merge([{ x: 10, y: 5, g: 'a', col: 7 }])
    expect(store.get(10, 5)?.g).toBe('a')
  })

  it('absent x advances by 1; absent y carries forward', () => {
    const store = new MapStore()
    // (10,5)='a', then (11,5)='b' (x++), then (12,5)='c' (x++)
    store.merge([
      { x: 10, y: 5, g: 'a' },
      { g: 'b' },
      { g: 'c' },
    ])
    expect(store.get(10, 5)?.g).toBe('a')
    expect(store.get(11, 5)?.g).toBe('b')
    expect(store.get(12, 5)?.g).toBe('c')
  })

  it('new y with absent x still advances x (does not reset to 0)', () => {
    // Confirmed from merge(): only `u.x !== undefined` resets curX; a new y
    // alone still falls through to curX++.
    const store = new MapStore()
    store.merge([
      { x: 10, y: 5, g: 'a' },
      { y: 6, g: 'b' },
    ])
    expect(store.get(10, 5)?.g).toBe('a')
    expect(store.get(11, 6)?.g).toBe('b')
  })

  it('explicit x resets the column even on the same row', () => {
    const store = new MapStore()
    store.merge([
      { x: 10, y: 5, g: 'a' },
      { g: 'b' },          // (11,5)
      { x: 3, g: 'c' },    // (3,5)  — explicit x resets
    ])
    expect(store.get(11, 5)?.g).toBe('b')
    expect(store.get(3, 5)?.g).toBe('c')
  })
})

describe('MapStore.merge — partial field preservation', () => {
  it('absent g keeps prior glyph; absent col keeps prior col', () => {
    const store = new MapStore()
    store.merge([{ x: 1, y: 1, g: '@', col: 9 }])
    store.merge([{ x: 1, y: 1, col: 12 }])    // only col changes
    expect(store.get(1, 1)).toMatchObject({ g: '@', col: 12 })

    store.merge([{ x: 1, y: 1, g: '#' }])     // only g changes
    expect(store.get(1, 1)).toMatchObject({ g: '#', col: 12 })
  })

  it('defaults to space + col 7 when neither prior nor update provides them', () => {
    const store = new MapStore()
    store.merge([{ x: 2, y: 2 }])
    expect(store.get(2, 2)).toMatchObject({ g: ' ', col: 7 })
  })

  it('returns dirty keys for every updated cell', () => {
    const store = new MapStore()
    const dirty = store.merge([
      { x: 1, y: 1, g: 'a' },
      { g: 'b' },
      { y: 2, g: 'c' },
    ])
    expect(dirty).toEqual(new Set(['1,1', '2,1', '3,2']))
  })
})

describe('MapStore.merge — tile field carry-forward', () => {
  it('t-field carries forward when t is absent on the update', () => {
    const store = new MapStore()
    store.merge([{ x: 1, y: 1, g: '.', t: { fg: 100, bg: 200 } }])
    store.merge([{ x: 1, y: 1, g: '#' }])   // no t — fg/t_bg should persist
    expect(store.get(1, 1)).toMatchObject({ g: '#', fg: 100, t_bg: 200 })
  })

  it('explicit 0/false in t overwrites prior value (not treated as absent)', () => {
    const store = new MapStore()
    store.merge([{ x: 1, y: 1, t: { sanctuary: true, halo: 3 } }])
    store.merge([{ x: 1, y: 1, t: { sanctuary: false, halo: 0 } }])
    expect(store.get(1, 1)).toMatchObject({ sanctuary: false, halo: 0 })
  })
})

describe('MapStore — monster tracking', () => {
  it('records a visible monster in the monster map', () => {
    const store = new MapStore()
    store.merge([{
      x: 5, y: 5, g: 'D', col: 4,
      mon: { id: 42, name: 'dragon', typedata: { no_exp: false } },
    }])
    const mons = store.getMonsters()
    expect(mons.size).toBe(1)
    expect(mons.get('5,5')).toMatchObject({
      x: 5, y: 5, g: 'D',
      mon: { id: 42, name: 'dragon' },
    })
  })

  it('explicit mon:null removes the monster from the map', () => {
    const store = new MapStore()
    store.merge([{
      x: 5, y: 5, g: 'D', col: 4,
      mon: { id: 42, name: 'dragon', typedata: { no_exp: false } },
    }])
    store.merge([{ x: 5, y: 5, mon: null }])
    expect(store.getMonsters().size).toBe(0)
  })

  it('skips monsters with no_exp=true (peaceful plants etc.)', () => {
    const store = new MapStore()
    store.merge([{
      x: 5, y: 5, g: 'P', col: 2,
      mon: { id: 7, name: 'plant', typedata: { no_exp: true } },
    }])
    expect(store.getMonsters().size).toBe(0)
  })

  it('keeps ballistomycetes despite no_exp', () => {
    const store = new MapStore()
    store.merge([{
      x: 5, y: 5, g: 'f', col: 12,
      mon: { id: 8, name: 'active ballistomycete', typedata: { no_exp: true } },
    }])
    expect(store.getMonsters().size).toBe(1)
  })
})

describe('MapStore.clear', () => {
  it('wipes cells and monsters', () => {
    const store = new MapStore()
    const updates: CellUpdate[] = [
      { x: 1, y: 1, g: 'a' },
      { x: 2, y: 2, g: 'D', mon: { id: 1, name: 'dragon', typedata: { no_exp: false } } },
    ]
    store.merge(updates)
    expect(store.size).toBe(2)
    expect(store.getMonsters().size).toBe(1)
    store.clear()
    expect(store.size).toBe(0)
    expect(store.getMonsters().size).toBe(0)
  })
})
