// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Avatar } from '../avatars'
import { cachedFingerprint, resolvePlayerLoader } from '../game/tiles/atlas-dedup'
import type { TileLoader } from '../game/tiles/tile-loader'
import { paintAvatars } from './avatar-tiles'

// paintAvatars' own job is orchestration: resolve order, list-order insertion,
// and the dead-version retry pass. Mock the resolution and sprite layers so
// the test drives exactly those.
vi.mock('../game/tiles/atlas-dedup', () => ({
  resolvePlayerLoader: vi.fn(),
  cachedFingerprint: vi.fn(() => null),
}))
vi.mock('../game/tiles/tile-view', () => ({
  dollTileSpec: (cell: { doll: unknown }) => (cell.doll ? [cell.doll] : []),
  renderTiles: (_loader: unknown, spec: string[][]) => {
    const el = document.createElement('div')
    el.dataset.doll = spec[0][0]
    return el
  },
}))
const resolveMock = vi.mocked(resolvePlayerLoader)
const cachedFpMock = vi.mocked(cachedFingerprint)

const LOADER = { live: true } as unknown as TileLoader

function avatar(name: string, version: string): Avatar {
  return {
    wsUrl: 'wss://x/socket', username: 'u', gameId: 'g', charName: 'c',
    httpBase: 'https://x', version, doll: [[name]], mcache: null, turn: null,
  } as unknown as Avatar
}

function dolls(container: HTMLElement): string[] {
  return [...container.children].map((el) => (el as HTMLElement).dataset.doll!)
}

beforeEach(() => {
  resolveMock.mockReset()
  cachedFpMock.mockReset().mockReturnValue(null)
})

describe('paintAvatars', () => {
  it('keeps list order regardless of resolution order', async () => {
    // First entry resolves slowest — it must still land first in the DOM.
    resolveMock.mockImplementation(async (_h, version) => {
      if (version === 'v1') await new Promise((r) => setTimeout(r, 10))
      return LOADER
    })
    const container = document.createElement('div')
    await paintAvatars(container, [avatar('a', 'v1'), avatar('b', 'v2')], 1, 'x')
    expect(dolls(container)).toEqual(['a', 'b'])
  })

  it('retries a failed entry with a cached fingerprint after the first wave', async () => {
    // The dead-but-newest case seen live: entry 1 claims its fingerprint
    // group, fails on its own atlas, and only resolves once the live sibling
    // has re-claimed — i.e. on the retry.
    let deadCalls = 0
    resolveMock.mockImplementation(async (_h, version) => {
      if (version === 'vDead') return ++deadCalls > 1 ? LOADER : null
      return LOADER
    })
    cachedFpMock.mockReturnValue('shared-fp')
    const container = document.createElement('div')
    await paintAvatars(container, [avatar('dead', 'vDead'), avatar('live', 'vLive')], 1, 'x')
    expect(deadCalls).toBe(2)
    expect(dolls(container)).toEqual(['dead', 'live']) // rescued AND in list order
  })

  it('suppresses placement when the signal aborts mid-resolution', async () => {
    // The login strip's disable path: the caller aborts and clears the
    // container while an atlas is still resolving — the late resolve must
    // not append into the cleared strip.
    let release!: (l: TileLoader) => void
    resolveMock.mockImplementation(() => new Promise((r) => { release = r }))
    const container = document.createElement('div')
    const ctl = new AbortController()
    const done = paintAvatars(container, [avatar('a', 'v1')], 1, 'x', ctl.signal)
    ctl.abort()
    release(LOADER)
    await done
    expect(container.children).toHaveLength(0)
  })

  it('does not retry entries with no cached fingerprint', async () => {
    resolveMock.mockResolvedValue(null)
    const container = document.createElement('div')
    await paintAvatars(container, [avatar('a', 'v1')], 1, 'x')
    expect(resolveMock).toHaveBeenCalledTimes(1) // no second attempt
    expect(container.children).toHaveLength(0)
  })
})
