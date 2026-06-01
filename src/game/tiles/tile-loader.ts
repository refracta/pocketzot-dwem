// Loads DCSS tile atlas PNGs and tileinfo modules from the connected WebTiles
// server. The atlas is one big sprite sheet per texture; each tileinfo file is
// an AMD module exporting `get_tile_info(id)` returning the sprite's
// source-rect inside the atlas.
//
// We can't fetch() the tileinfo JS cross-origin (the official server sends
// no CORS headers), but cross-origin <script> execution and <img> display
// both work without CORS. So we load tileinfo via a <script> tag with a
// shimmed AMD `define`, and load atlases as plain Image objects.
//
// Each game *version* gets its own immutable TileLoader instance, obtained
// from getTileLoader() and keyed by the gamedata base URL. This is the
// in-SPA analog of the reference client's per-version page reload: a loader's
// caches are valid by construction for its one version, so version X's atlas
// can never be read under version Y's tileinfo. A late image onload from a
// torn-down game writes into that game's own (now-orphaned) instance, never
// the live one — which is the whole class of "black tile after switching
// versions" bug, eliminated structurally rather than by a runtime guard.

// Texture enum based on DCSS 0.34.1 (FLOOR=0..ICONS=6).
const TEXTURE_NAMES = ['floor', 'wall', 'feat', 'player', 'main', 'gui', 'icons'] as const

// Indices into TEXTURE_NAMES, exported so callers don't sprinkle bare
// `tex: 3` / `tex: 6` literals (or per-file copies) throughout the code.
export const TEX = {
  FLOOR:  0,
  WALL:   1,
  FEAT:   2,
  PLAYER: 3,
  MAIN:   4,
  GUI:    5,
  ICONS:  6,
} as const

export interface TileSprite {
  img: HTMLImageElement
  sx: number
  sy: number
  w: number
  h: number
  ox: number  // sprite's authored offset from its 32x32 logical cell origin
  oy: number
}

interface TileinfoEntry {
  w: number; h: number
  ox: number; oy: number
  sx: number; sy: number
  ex: number; ey: number
}

export interface TileinfoModule {
  get_tile_info: (idx: number) => TileinfoEntry | undefined
  get_img: (idx: number) => string
  // Generated modules also export named tile-id constants (e.g. UNAWARE,
  // POISON for tileinfo-icons). We type those loosely so callers can read
  // them by name without a per-module schema.
  [k: string]: unknown
}

// Registry of loaders by gamedata base URL (`${httpBase}/gamedata/${version}`).
// Memoized so repeated games of the same version reuse the warm atlas/tileinfo
// cache, while different versions get fully isolated instances.
const loaders = new Map<string, TileLoader>()

// Bounds how many version-distinct atlas sets we keep resident (each holds a
// few MB of decoded PNGs). A session realistically touches 1–3 versions; the
// cap is a leak backstop, not a tuning knob. Evicting a base only drops it
// from the registry — any live view still holding that instance keeps working;
// a later re-request just builds a fresh instance and reloads.
const MAX_LOADERS = 4

export function getTileLoader(httpBase: string, version: string): TileLoader {
  const base = `${httpBase}/gamedata/${version}`
  const existing = loaders.get(base)
  if (existing) {
    // Refresh LRU recency.
    loaders.delete(base)
    loaders.set(base, existing)
    return existing
  }
  installShim()
  const loader = new TileLoader(base)
  loaders.set(base, loader)
  while (loaders.size > MAX_LOADERS) {
    const oldest = loaders.keys().next().value as string | undefined
    if (oldest === undefined) break
    loaders.delete(oldest)
  }
  return loader
}

export class TileLoader {
  // Public so the routing shim and callers can identify this instance; never
  // mutated after construction.
  readonly base: string
  private atlases = new Map<string, Promise<HTMLImageElement>>()
  private modules = new Map<string, Promise<TileinfoModule>>()
  private moduleResolvers = new Map<string, (m: TileinfoModule) => void>()
  // Resolved-state mirrors of `atlases` / `modules` for synchronous lookup.
  // The async maps hold the in-flight promise; these hold the value once it
  // arrives. TileMapView paints from these so a 33×21 canvas redraw doesn't
  // need to await a promise per cell layer.
  private atlasSync = new Map<string, HTMLImageElement>()
  private moduleSync = new Map<string, TileinfoModule>()

  // Use getTileLoader() rather than `new TileLoader()` directly so instances
  // are registry-memoized (and reachable by the routing shim).
  constructor(base: string) {
    this.base = base
  }

  // Returns a tileinfo module by texture name (e.g. 'icons') so callers
  // can read named tile-id constants (e.g. mod.UNAWARE) for status overlays.
  getModule(name: string): Promise<TileinfoModule> {
    return this.loadTileinfo(name)
  }

  async getAsync(tex: number, tileId: number): Promise<TileSprite> {
    const name = TEXTURE_NAMES[tex]
    if (!name) throw new Error(`unknown texture: ${tex}`)
    const [img, mod] = await Promise.all([this.loadAtlas(name), this.loadTileinfo(name)])
    const info = mod.get_tile_info(tileId)
    if (!info) throw new Error(`no tile_info for id ${tileId} in texture ${name}`)
    return {
      img,
      sx: info.sx,
      sy: info.sy,
      w: info.ex - info.sx,
      h: info.ey - info.sy,
      ox: info.ox,
      oy: info.oy,
    }
  }

  // Preload an atlas + its tileinfo so subsequent getSync() calls succeed.
  // Used by TileMapView before its first canvas paint.
  async ensureLoaded(tex: number): Promise<void> {
    const name = TEXTURE_NAMES[tex]
    if (!name) throw new Error(`unknown texture: ${tex}`)
    const [img, mod] = await Promise.all([this.loadAtlas(name), this.loadTileinfo(name)])
    this.atlasSync.set(name, img)
    this.moduleSync.set(name, mod)
  }

  // Synchronous tile lookup. Returns null when the atlas or tileinfo for this
  // texture hasn't been preloaded yet (caller should ensureLoaded first), or
  // when the tile id has no entry in the tileinfo table.
  getSync(tex: number, tileId: number): TileSprite | null {
    const name = TEXTURE_NAMES[tex]
    if (!name) return null
    const img = this.atlasSync.get(name)
    const mod = this.moduleSync.get(name)
    if (!img || !mod) return null
    const info = mod.get_tile_info(tileId)
    if (!info) return null
    return {
      img,
      sx: info.sx,
      sy: info.sy,
      w: info.ex - info.sx,
      h: info.ey - info.sy,
      ox: info.ox,
      oy: info.oy,
    }
  }

  // Sync variant of getDngnTex. Requires tileinfo-dngn to be preloaded.
  getDngnTexSync(dngnIdx: number): number | null {
    const dngn = this.moduleSync.get('dngn')
    if (!dngn) return null
    const imgName = (dngn.get_img as (i: number) => string)(dngnIdx)
    const tex = TEXTURE_NAMES.indexOf(imgName as typeof TEXTURE_NAMES[number])
    return tex < 0 ? null : tex
  }

  // Maps a dngn-namespace tile id (low 16 bits of t.bg) onto the right
  // atlas. tileinfo-dngn is a meta-module the server generates to dispatch
  // a single id space across floor/wall/feat — its get_img(idx) returns
  // 'floor' | 'wall' | 'feat', which lines up with TEXTURE_NAMES[0..2].
  async getDngnTex(dngnIdx: number): Promise<number> {
    const dngn = await this.loadTileinfo('dngn')
    const getImg = dngn.get_img as (i: number) => string
    const imgName = getImg(dngnIdx)
    const tex = TEXTURE_NAMES.indexOf(imgName as typeof TEXTURE_NAMES[number])
    if (tex < 0) throw new Error(`unknown dngn img: ${imgName}`)
    return tex
  }

  private loadAtlas(name: string): Promise<HTMLImageElement> {
    const cached = this.atlases.get(name)
    if (cached) return cached
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => { this.atlasSync.set(name, img); resolve(img) }
      img.onerror = () => reject(new Error(`failed to load atlas ${name}.png`))
      img.src = `${this.base}/${name}.png`
    })
    this.atlases.set(name, p)
    // Evict on failure so a later call retries the load instead of forever
    // re-returning this rejected promise. The instance is immutable and
    // registry-memoized — nothing else clears the cache — so without this a
    // single transient network blip would pin this version to ASCII for the
    // whole session. Guard the delete so a newer in-flight retry isn't dropped.
    p.catch(() => { if (this.atlases.get(name) === p) this.atlases.delete(name) })
    return p
  }

  private loadTileinfo(name: string): Promise<TileinfoModule> {
    const cached = this.modules.get(name)
    if (cached) return cached
    const p = new Promise<TileinfoModule>((resolve, reject) => {
      this.moduleResolvers.set(name, resolve)
      const s = document.createElement('script')
      s.src = `${this.base}/tileinfo-${name}.js`
      s.onerror = () => {
        this.moduleResolvers.delete(name)
        reject(new Error(`failed to load tileinfo-${name}.js`))
      }
      document.head.appendChild(s)
    })
    this.modules.set(name, p)
    // See loadAtlas: evict a rejected load so the next call retries rather than
    // re-returning the failure for the rest of this (immutable) loader's life.
    p.catch(() => { if (this.modules.get(name) === p) this.modules.delete(name) })
    return p
  }

  // Called by the global `define` shim once a tileinfo-<name>.js for THIS
  // instance's base URL finishes executing. Module-internal (not part of the
  // public API) — kept unmarked so the shim, defined at module scope, can
  // reach it.
  resolveModule(name: string, mod: TileinfoModule): void {
    this.moduleSync.set(name, mod)
    const resolve = this.moduleResolvers.get(name)
    this.moduleResolvers.delete(name)
    resolve?.(mod)
  }

  // Resolves an AMD dependency string a tileinfo module declares. Module-
  // internal; called by the shim with this instance as `this`-equivalent.
  loadDep(dep: string): Promise<unknown> {
    if (dep === 'jquery') {
      // The "jquery" dep is only used for `$.extend(exports, ...)` to merge
      // sub-module exports — Object.assign is a drop-in replacement.
      return Promise.resolve({ extend: Object.assign })
    }
    const m = dep.match(/^\.\/tileinfo-(.+)$/)
    if (!m) return Promise.reject(new Error(`unsupported AMD dep: ${dep}`))
    return this.loadTileinfo(m[1])
  }
}

// One global AMD `define` shim for every loader instance. tileinfo-*.js
// modules call `define(deps, factory)` at execution; we route each call back
// to the right instance by parsing the base URL out of the executing script's
// src. A single shim (rather than per-instance) is what makes concurrent
// cross-version loads safe — two instances installing rival `define`s on
// `window` would otherwise clobber each other.
let shimInstalled = false
function installShim(): void {
  if (shimInstalled) return
  shimInstalled = true
  const w = window as unknown as Record<string, unknown>
  // tileinfo-dngn.js (and other generated modules) calls `assert(...)` at
  // module init and inside get_img to validate the dngn dispatch ranges.
  // The reference client defines this in its util.js bundle; we don't load
  // util.js, so provide a minimal global assert that throws on failure.
  if (typeof w['assert'] !== 'function') {
    w['assert'] = (cond: unknown, msg?: string): void => {
      if (!cond) throw new Error(msg || 'assert failed')
    }
  }
  const define = (deps: string[], factory: (...args: unknown[]) => TileinfoModule) => {
    // `${base}/tileinfo-<name>.js` — base identifies the instance, name the
    // module. Splitting on the last `/tileinfo-` segment yields both.
    const src = (document.currentScript as HTMLScriptElement | null)?.src ?? ''
    const m = src.match(/^(.*)\/tileinfo-([a-z]+)\.js/)
    if (!m) return
    const base = m[1]
    const name = m[2]
    const loader = loaders.get(base)
    if (!loader) return  // instance evicted/torn down while its script loaded
    Promise.all(deps.map((d) => loader.loadDep(d)))
      .then((args) => {
        const mod = factory(...args)
        loader.resolveModule(name, mod)
      })
      .catch((err) => console.error('tileinfo factory failed:', name, err))
  }
  ;(define as unknown as { amd: object }).amd = {}
  w['define'] = define
}
