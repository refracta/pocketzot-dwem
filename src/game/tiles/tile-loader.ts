// Lazy-loads DCSS tile atlas PNGs and tileinfo modules from the connected
// WebTiles server. The atlas is one big sprite sheet per texture; each
// tileinfo file is an AMD module exporting `get_tile_info(id)` returning
// the sprite's source-rect inside the atlas.
//
// We can't fetch() the tileinfo JS cross-origin (the official server sends
// no CORS headers), but cross-origin <script> execution and <img> display
// both work without CORS. So we load tileinfo via a <script> tag with a
// shimmed AMD `define`, and load atlases as plain Image objects.

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

class TileLoader {
  private httpBase = ''
  private version = ''
  private atlases = new Map<string, Promise<HTMLImageElement>>()
  private modules = new Map<string, Promise<TileinfoModule>>()
  private moduleResolvers = new Map<string, (m: TileinfoModule) => void>()
  private shimInstalled = false
  // Resolved-state mirrors of `atlases` / `modules` for synchronous lookup.
  // The async maps hold the in-flight promise; these hold the value once it
  // arrives. TileMapView paints from these so a 33×21 canvas redraw doesn't
  // need to await a promise per cell layer.
  private atlasSync = new Map<string, HTMLImageElement>()
  private moduleSync = new Map<string, TileinfoModule>()

  configure(httpBase: string, version: string): void {
    if (this.httpBase === httpBase && this.version === version) return
    this.httpBase = httpBase
    this.version = version
    this.atlases.clear()
    this.modules.clear()
    this.moduleResolvers.clear()
    this.atlasSync.clear()
    this.moduleSync.clear()
  }

  get configured(): boolean {
    return this.httpBase !== '' && this.version !== ''
  }

  // Returns a tileinfo module by texture name (e.g. 'icons') so callers
  // can read named tile-id constants (e.g. mod.UNAWARE) for status overlays.
  getModule(name: string): Promise<TileinfoModule> {
    if (!this.configured) return Promise.reject(new Error('tile loader not configured'))
    return this.loadTileinfo(name)
  }

  async getAsync(tex: number, tileId: number): Promise<TileSprite> {
    if (!this.configured) throw new Error('tile loader not configured')
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
    if (!this.configured) throw new Error('tile loader not configured')
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
    if (!this.configured) throw new Error('tile loader not configured')
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
      img.src = `${this.httpBase}/gamedata/${this.version}/${name}.png`
    })
    this.atlases.set(name, p)
    return p
  }

  private loadTileinfo(name: string): Promise<TileinfoModule> {
    const cached = this.modules.get(name)
    if (cached) return cached
    this.installShim()
    const p = new Promise<TileinfoModule>((resolve, reject) => {
      this.moduleResolvers.set(name, resolve)
      const s = document.createElement('script')
      s.src = `${this.httpBase}/gamedata/${this.version}/tileinfo-${name}.js`
      s.onerror = () => {
        this.moduleResolvers.delete(name)
        reject(new Error(`failed to load tileinfo-${name}.js`))
      }
      document.head.appendChild(s)
    })
    this.modules.set(name, p)
    return p
  }

  private installShim(): void {
    if (this.shimInstalled) return
    this.shimInstalled = true
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
      // Identify which tileinfo module is being defined by the URL of the
      // currently-executing <script>. This avoids ordering races between
      // multiple in-flight loads.
      const src = (document.currentScript as HTMLScriptElement | null)?.src ?? ''
      const m = src.match(/tileinfo-([a-z]+)\.js/)
      if (!m) return
      const name = m[1]
      Promise.all(deps.map((d) => this.loadDep(d)))
        .then((args) => {
          const mod = factory(...args)
          this.moduleSync.set(name, mod)
          const resolve = this.moduleResolvers.get(name)
          this.moduleResolvers.delete(name)
          resolve?.(mod)
        })
        .catch((err) => console.error('tileinfo factory failed:', name, err))
    }
    ;(define as unknown as { amd: object }).amd = {}
    w['define'] = define
  }

  private loadDep(dep: string): Promise<unknown> {
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

export const tileLoader = new TileLoader()
