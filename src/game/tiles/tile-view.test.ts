// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { appendTiles } from './tile-view'
import { TEX, type TileLoader, type TileSprite } from './tile-loader'

// Sprite-positioning math in paintSprite, exercised through appendTiles with
// a stub loader whose getAsync resolves immediately. The interesting cases
// are the reference draw_tile centring (size_oy = 32 - h bottom-aligns the
// authored box, making 32×48 pan lord parts poke above the cell) and our
// list-only fit shrink (oversized boxes scaled about the cell's
// bottom-centre so they stay inside the row's cell).

function stubLoader(sprite: Partial<TileSprite>): TileLoader {
  const s: TileSprite = {
    img: { src: 'atlas.png', naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement,
    sx: 0, sy: 0,
    w: 32, h: 32,
    ox: 0, oy: 0,
    aw: 32, ah: 32,
    ...sprite,
  }
  return { getAsync: () => Promise.resolve(s) } as unknown as TileLoader
}

async function paint(loader: TileLoader, opts?: { centre?: boolean; fit?: boolean }): Promise<HTMLElement> {
  const wrap = document.createElement('div')
  appendTiles(loader, wrap, [{ t: 1, tex: TEX.PLAYER }], 1, opts)
  // paintSprite resolves its getAsync promise in a microtask.
  await Promise.resolve()
  await Promise.resolve()
  return wrap.firstElementChild as HTMLElement
}

describe('paintSprite placement', () => {
  it('leaves 32×32 sprites at their authored offsets by default', async () => {
    const tile = await paint(stubLoader({ ox: 3, oy: 5 }))
    expect(tile.style.left).toBe('3px')
    expect(tile.style.top).toBe('5px')
    expect(tile.style.height).toBe('32px')
  })

  it('centre bottom-aligns a 32×48 authored box (head pokes above the cell)', async () => {
    // Pan lord part: authored 32×48, crop covering the full box.
    const tile = await paint(stubLoader({ h: 48, ah: 48 }), { centre: true })
    // size_oy = 32 - 48 = -16, per reference draw_tile.
    expect(tile.style.top).toBe('-16px')
    expect(tile.style.height).toBe('48px')
  })

  it('centre is a no-op for a 32×32 authored box', async () => {
    const tile = await paint(stubLoader({ ox: 3, oy: 5 }), { centre: true })
    expect(tile.style.left).toBe('3px')
    expect(tile.style.top).toBe('5px')
  })

  it('fit shrinks an oversized box into the cell about its bottom-centre', async () => {
    const tile = await paint(stubLoader({ h: 48, ah: 48 }), { centre: true, fit: true })
    // k = 32/48; centred top of -16 maps to 32 + (-16 - 32) * k = 0, so the
    // shrunk sprite exactly fills the cell top-to-bottom.
    expect(tile.style.top).toBe('0px')
    expect(tile.style.height).toBe('32px')
    // Width shrinks by the same k, recentred: 32 * 2/3 = 21.33…px wide,
    // left = 16 + (0 - 16) * 2/3 = 5.33…px.
    expect(parseFloat(tile.style.width)).toBeCloseTo(32 * (32 / 48), 3)
    expect(parseFloat(tile.style.left)).toBeCloseTo(16 - 16 * (32 / 48), 3)
    // Atlas backdrop scales with k so the crop stays aligned.
    expect(tile.style.backgroundSize).toContain(`${1024 * (32 / 48)}px`)
  })

  it('fit leaves normal-size sprites untouched', async () => {
    const tile = await paint(stubLoader({ ox: 3, oy: 5 }), { centre: true, fit: true })
    expect(tile.style.left).toBe('3px')
    expect(tile.style.top).toBe('5px')
    expect(tile.style.height).toBe('32px')
    expect(tile.style.backgroundSize).toBe('')
  })
})
