import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../../test/fake-storage'
import {
  cachedFingerprint,
  playerAtlasFingerprint,
  resetAtlasGroups,
  resolvePlayerLoader,
  storeFingerprint,
} from './atlas-dedup'
import { getTileLoader, type TileLoader } from './tile-loader'

// resolvePlayerLoader reaches the network only through getTileLoader — mock it
// so tests hand out fabricated loaders per (httpBase, version).
vi.mock('./tile-loader', () => ({
  TEX: { PLAYER: 3 },
  getTileLoader: vi.fn(),
}))
const getTileLoaderMock = vi.mocked(getTileLoader)

interface Rect { w: number; h: number; ox: number; oy: number; sx: number; sy: number; ex: number; ey: number }

function rect(seed: number): Rect {
  return { w: 32, h: 32, ox: seed % 5, oy: 0, sx: seed * 10, sy: 20, ex: seed * 10 + 32, ey: 52 }
}

// A loader-shaped fake: a player table of `n` rects offset by `start`
// (mirroring the generated module's `tile_info[idx - TILE_MAIN_MAX]`), and an
// atlas that loads unless `atlasFails`.
function fakeLoader(opts: {
  start?: number
  table?: Rect[]
  atlasFails?: boolean
  moduleFails?: boolean
} = {}): TileLoader {
  const start = opts.start ?? 5000
  const table = opts.table ?? [rect(1), rect(2), rect(3)]
  return {
    getModule: vi.fn(async (name: string) => {
      if (opts.moduleFails) throw new Error('tileinfo 404')
      if (name === 'main') return { TILE_MAIN_MAX: start, get_tile_info: () => undefined }
      return { get_tile_info: (i: number) => table[i - start] }
    }),
    ensureLoaded: vi.fn(async () => {
      if (opts.atlasFails) throw new Error('atlas 404')
    }),
  } as unknown as TileLoader
}

// Route the getTileLoader mock through a per-test registry, memoized like the
// real one so claim comparisons see stable instances.
function registry(loaders: Record<string, TileLoader>): void {
  const memo = new Map<string, TileLoader>()
  getTileLoaderMock.mockImplementation((httpBase: string, version: string) => {
    const k = `${httpBase}|${version}`
    const existing = memo.get(k)
    if (existing) return existing
    const l = loaders[k] ?? fakeLoader()
    memo.set(k, l)
    return l
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  resetAtlasGroups()
  getTileLoaderMock.mockReset()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('playerAtlasFingerprint', () => {
  it('is equal for identical tables from distinct sources', async () => {
    const a = await playerAtlasFingerprint(fakeLoader({ start: 5000, table: [rect(1), rect(2)] }))
    const b = await playerAtlasFingerprint(fakeLoader({ start: 5000, table: [rect(1), rect(2)] }))
    expect(a).toBe(b)
  })

  it('differs when a sprite rect changes', async () => {
    const a = await playerAtlasFingerprint(fakeLoader({ table: [rect(1), rect(2)] }))
    const b = await playerAtlasFingerprint(fakeLoader({ table: [rect(1), { ...rect(2), sx: 999 }] }))
    expect(a).not.toBe(b)
  })

  it('differs when the upstream id offset shifts (recipes store absolute ids)', async () => {
    const a = await playerAtlasFingerprint(fakeLoader({ start: 5000 }))
    const b = await playerAtlasFingerprint(fakeLoader({ start: 5001 }))
    expect(a).not.toBe(b)
  })

  it('differs when the table length changes', async () => {
    const a = await playerAtlasFingerprint(fakeLoader({ table: [rect(1), rect(2)] }))
    const b = await playerAtlasFingerprint(fakeLoader({ table: [rect(1), rect(2), rect(3)] }))
    expect(a).not.toBe(b)
  })

  it('rejects when TILE_MAIN_MAX is missing', async () => {
    const src = {
      getModule: async () => ({ get_tile_info: () => undefined }),
    } as unknown as TileLoader
    await expect(playerAtlasFingerprint(src)).rejects.toThrow('TILE_MAIN_MAX')
  })
})

describe('fingerprint cache', () => {
  it('round-trips and misses on unknown versions', () => {
    storeFingerprint('https://a', 'v1', 'fp1')
    expect(cachedFingerprint('https://a', 'v1')).toBe('fp1')
    expect(cachedFingerprint('https://a', 'v2')).toBeNull()
    expect(cachedFingerprint('https://b', 'v1')).toBeNull()
  })

  it('evicts oldest-stored past the cap', () => {
    for (let i = 0; i < 70; i++) storeFingerprint('https://a', `v${i}`, `fp${i}`)
    expect(cachedFingerprint('https://a', 'v0')).toBeNull()   // rolled off
    expect(cachedFingerprint('https://a', 'v69')).toBe('fp69') // newest kept
  })
})

describe('resolvePlayerLoader', () => {
  it('routes same-fingerprint versions through one representative atlas', async () => {
    const l1 = fakeLoader({ start: 5000, table: [rect(1)] })
    const l2 = fakeLoader({ start: 5000, table: [rect(1)] }) // rebuilt version, identical layout
    registry({ 'https://a|v1': l1, 'https://a|v2': l2 })

    expect(await resolvePlayerLoader('https://a', 'v1')).toBe(l1)
    expect(await resolvePlayerLoader('https://a', 'v2')).toBe(l1) // deduped onto v1
    expect(l1.ensureLoaded).toHaveBeenCalled()
    expect(l2.ensureLoaded).not.toHaveBeenCalled() // the saved PNG download
  })

  it('keeps different fingerprints on their own atlases', async () => {
    const l1 = fakeLoader({ table: [rect(1)] })
    const l2 = fakeLoader({ table: [rect(2)] })
    registry({ 'https://a|v1': l1, 'https://a|v2': l2 })

    expect(await resolvePlayerLoader('https://a', 'v1')).toBe(l1)
    expect(await resolvePlayerLoader('https://a', 'v2')).toBe(l2)
  })

  it('serves a cached-fingerprint version without loading its tileinfo', async () => {
    const l1 = fakeLoader({ start: 5000, table: [rect(1)] })
    const l2 = fakeLoader({ start: 5000, table: [rect(1)] })
    registry({ 'https://a|v1': l1, 'https://a|v2': l2 })
    const fp = await playerAtlasFingerprint(l1)
    storeFingerprint('https://a', 'v1', fp)
    storeFingerprint('https://a', 'v2', fp)
    ;(l1.getModule as ReturnType<typeof vi.fn>).mockClear()

    expect(await resolvePlayerLoader('https://a', 'v1')).toBe(l1)
    expect(await resolvePlayerLoader('https://a', 'v2')).toBe(l1)
    expect(l1.getModule).not.toHaveBeenCalled()
    expect(l2.getModule).not.toHaveBeenCalled()
  })

  it('renders a dead version dir through a live same-fingerprint atlas', async () => {
    // vDead's tileinfo AND atlas are gone, but its fingerprint was cached in a
    // past session; vLive shares it and already claimed the group.
    const dead = fakeLoader({ moduleFails: true, atlasFails: true })
    const live = fakeLoader()
    registry({ 'https://a|vDead': dead, 'https://a|vLive': live })
    storeFingerprint('https://a', 'vLive', 'shared-fp')
    storeFingerprint('https://a', 'vDead', 'shared-fp')

    expect(await resolvePlayerLoader('https://a', 'vLive')).toBe(live)
    expect(await resolvePlayerLoader('https://a', 'vDead')).toBe(live)
    expect(dead.ensureLoaded).not.toHaveBeenCalled()
  })

  it('falls back to the per-version path when unfingerprintable', async () => {
    const l = fakeLoader({ moduleFails: true }) // tileinfo 404s, atlas fine
    registry({ 'https://a|v1': l })
    expect(await resolvePlayerLoader('https://a', 'v1')).toBe(l)
    expect(l.ensureLoaded).toHaveBeenCalled()
  })

  it('returns null when nothing is reachable (doll skipped, as pre-dedup)', async () => {
    const l = fakeLoader({ moduleFails: true, atlasFails: true })
    registry({ 'https://a|v1': l })
    expect(await resolvePlayerLoader('https://a', 'v1')).toBeNull()
  })

  it('converges concurrent siblings onto one download after a dead claimant', async () => {
    // The code-review scenario: the newest entry claims the group and its
    // atlas fails AFTER the live siblings already adopted it. Both siblings'
    // next iteration must converge on the first re-claim — one download —
    // rather than each falling back to its own atlas.
    const dead = fakeLoader({ atlasFails: true })
    const b = fakeLoader()
    const c = fakeLoader()
    registry({ 'https://a|vDead': dead, 'https://a|vB': b, 'https://a|vC': c })
    for (const v of ['vDead', 'vB', 'vC']) storeFingerprint('https://a', v, 'shared-fp')

    const [ra, rb, rc] = await Promise.all([
      resolvePlayerLoader('https://a', 'vDead'),
      resolvePlayerLoader('https://a', 'vB'),
      resolvePlayerLoader('https://a', 'vC'),
    ])
    expect(ra).toBeNull()          // the dead claimant itself (rescued by the paint retry pass)
    expect(rb).toBe(b)             // first sibling re-claims with its own atlas
    expect(rc).toBe(b)             // second sibling adopts the re-claim...
    expect(c.ensureLoaded).not.toHaveBeenCalled() // ...instead of downloading its own
  })

  it("re-claims the group when the representative's atlas fails", async () => {
    // vDead claimed the group first (e.g. it's the newest entry) but its atlas
    // is gone; vLive must fall back to its own atlas and take over the claim.
    const dead = fakeLoader({ atlasFails: true })
    const live = fakeLoader()
    const third = fakeLoader()
    registry({ 'https://a|vDead': dead, 'https://a|vLive': live, 'https://a|v3': third })
    storeFingerprint('https://a', 'vDead', 'shared-fp')
    storeFingerprint('https://a', 'vLive', 'shared-fp')
    storeFingerprint('https://a', 'v3', 'shared-fp')

    expect(await resolvePlayerLoader('https://a', 'vDead')).toBeNull()
    expect(await resolvePlayerLoader('https://a', 'vLive')).toBe(live)
    // The re-claim now serves the rest of the group.
    expect(await resolvePlayerLoader('https://a', 'v3')).toBe(live)
    expect(third.ensureLoaded).not.toHaveBeenCalled()
  })
})
