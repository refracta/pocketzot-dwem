// Portions of this file are ported from Dungeon Crawl Stone Soup,
// webserver/game_data/static/cell_renderer.js (draw_dolls). DCSS is
// Copyright 1997–2025 Linley Henzell, the dev team, and contributors;
// GPL-2.0-or-later. Reused under the "or later" option as part of this
// AGPL-3.0-or-later work. See ATTRIBUTION.md and LICENSE.

import { TEX, type TileinfoModule, type TileLoader } from './tile-loader'
import { buildStatusOverlays, mayHaveStatusOverlays, resolveOverlayId } from '../hud/monster-style'
import { buildStatusIconSizeMap } from '../map/icon-sizes'

// Native cell size used by all DCSS sprite atlases. Each tile occupies a
// 32x32 logical cell; the actual sprite within is positioned via per-tile
// ox/oy. Menu and popup contexts pass centre=false (per menu.js:69 and
// ui-layouts.js:61 in the reference client), so sprites land at their
// authored offsets without further centring math.
const CELL = 32

export interface TileRef {
  t: number
  tex: number
  // Optional pixel offsets layered on top of the sprite's authored ox/oy.
  // Used by describe-monster mcache entries to position equipment relative
  // to the body sprite.
  xofs?: number
  yofs?: number
}

// `expand`: grow the wrap on async sprite paint so larger-than-cell sprites
// (huge monsters in describe popups: Serpent of Hell, dragons, ...) reserve
// vertical space in their flex parent instead of dripping into the row below.
// Off by default — menu rows and the monster panel rely on the fixed cell.
export function renderTiles(loader: TileLoader | null, tiles: TileRef[], scale = 1, opts?: { expand?: boolean }): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'tile-stack'
  wrap.style.width = `${CELL * scale}px`
  wrap.style.height = `${CELL * scale}px`
  if (opts?.expand) wrap.dataset.expand = '1'
  appendTiles(loader, wrap, tiles, scale)
  return wrap
}

// Builds a base-sprite tile list for a monster *or the player character*,
// matching crawl-ref/.../cell_renderer.js draw_dolls. Inputs come from
// either ui-push fields (msg.doll / msg.mcache / msg.fg_idx) or the cell
// update fields (t.doll / t.mcache / low 16 bits of t.fg).
//
// Layering, in order:
//   1. doll parts (PLAYER atlas), each picking up per-part xofs/yofs from
//      mcache when a matching part_id appears in both lists. doll's second
//      tuple slot (ymax) is dropped here — it's the y-clip line that
//      `TilesFramework::send_doll` in tileweb.cc sets to 18 for
//      TILEP_FLAG_CUT_BOTTOM parts (naga / armataur / merfolk-water / djinni
//      torsos, and some helms), and is honored by the in-game canvas renderer
//      (tile-map-view.ts paintTile). Replicating it on this DOM-tile path
//      would need a per-part CSS height crop; not done because nagas etc. in
//      the monster panel are a polish issue, not a correctness one.
//   2. mcache parts (PLAYER atlas), drawn at their own xofs/yofs.
//   3. fg_idx as a single MAIN tile, only when doll *and* mcache are both
//      empty (small natural monsters that ship a single MAIN sprite id).
//
// Hostile monsters in practice carry only mcache (humanoid+equipment) or
// only fg_idx (small natural). The doll branch is wired up so a future
// player-avatar HUD/panel can reuse this helper with the player's doll
// payload — the reference player render path is exactly this composition.
export function monsterTileSpec(opts: {
  fg_idx?: number
  doll?: Array<[number, number]>
  mcache?: Array<[number, number, number]> | null
}): TileRef[] {
  const { doll, mcache } = opts
  const out: TileRef[] = []

  const offsetMap = mcache && mcache.length > 0
    ? new Map<number, [number, number]>(mcache.map(([t, x, y]) => [t, [x, y]]))
    : undefined

  if (doll && doll.length > 0) {
    for (const [t] of doll) {
      const off = offsetMap?.get(t)
      out.push({ t, tex: TEX.PLAYER, xofs: off?.[0], yofs: off?.[1] })
    }
  }
  if (mcache && mcache.length > 0) {
    for (const [t, xofs, yofs] of mcache) {
      out.push({ t, tex: TEX.PLAYER, xofs, yofs })
    }
  }
  if (out.length > 0) return out
  if (opts.fg_idx && opts.fg_idx > 0) return [{ t: opts.fg_idx, tex: TEX.MAIN }]
  return []
}

// Memoized id→width table for cell.icons stacking, rebuilt only when the
// resolved icons module identity changes (configure() swaps it on reconnect).
let iconSizeMapCache: ReadonlyMap<number, number> | null = null
let iconSizeMapSource: TileinfoModule | null = null

// Decodes a monster's t.fg (+ cell.icons) into ordered status overlays via the
// shared buildStatusOverlays decision, resolves names→ids against the icons
// tileinfo module, and appends them — with draw_foreground's status_shift
// offsets — on top of an already-rendered base sprite. The DOM-tile substrate
// for the monster list, the touch monster panel, and the describe-monster
// popup; the canvas map runs the same buildStatusOverlays decision directly.
// Pass `includeMdam` for surfaces (the popup) that show damage as an overlay
// rather than a separate HP bar.
export function appendIconOverlays(
  loader: TileLoader | null,
  wrap: HTMLElement,
  fg: number | number[] | undefined,
  icons: readonly number[] = [],
  scale = 1,
  opts: { includeMdam?: boolean } = {},
): void {
  if (!loader) return
  // Skip the async module load for status-free monsters (the common case in a
  // crowded list) — the same fast-path predicate buildStatusOverlays gates on,
  // checked here before paying a Promise + microtask per row.
  if (!mayHaveStatusOverlays(fg, icons, opts)) return
  loader.getModule('icons').then((mod) => {
    if (iconSizeMapSource !== mod) {
      iconSizeMapCache = buildStatusIconSizeMap(mod)
      iconSizeMapSource = mod
    }
    const { overlays } = buildStatusOverlays(fg, icons, iconSizeMapCache!, opts)
    if (overlays.length === 0) return
    const tiles: TileRef[] = []
    for (const o of overlays) {
      const id = resolveOverlayId(o, mod)
      if (id !== undefined) tiles.push({ t: id, tex: TEX.ICONS, xofs: o.xofs, yofs: o.yofs })
    }
    if (tiles.length > 0) appendTiles(loader, wrap, tiles, scale)
  }).catch((err) => console.warn('icon module load failed:', err))
}

// Adds tiles into an existing tile-stack wrapper. Used to layer extra
// overlays (e.g. monster status icons that arrive after a constants
// lookup) on top of an already-rendered base sprite.
export function appendTiles(loader: TileLoader | null, wrap: HTMLElement, tiles: TileRef[], scale = 1): void {
  if (!loader) return
  for (const t of tiles) {
    const child = document.createElement('div')
    child.className = 'tile'
    wrap.appendChild(child)
    paintSprite(loader, child, t.tex, t.t, scale, t.xofs ?? 0, t.yofs ?? 0)
  }
}

// Inserts a dngn-atlas tile (e.g. HALO_FRIENDLY) at the bottom of the stack,
// beneath any later-appended layers. Synchronously creates the placeholder
// div before the module/atlas loads so DOM order — and therefore paint order
// inside the .tile-stack stacking context — reflects the call site, not the
// async resolution race between this and appendTiles for the doll.
export function prependDngnLayer(loader: TileLoader | null, wrap: HTMLElement, dngnName: string, scale = 1): void {
  if (!loader) return
  const child = document.createElement('div')
  child.className = 'tile'
  wrap.insertBefore(child, wrap.firstChild)
  loader.getModule('feat').then((mod) => {
    const id = mod[dngnName]
    if (typeof id !== 'number') return
    paintSprite(loader, child, TEX.FEAT, id, scale, 0, 0)
  }).catch((err) => console.warn('feat module load failed:', err))
}

// Same as prependDngnLayer but takes a numeric dngn id (low 16 bits of t.bg)
// rather than a named constant. The id can land in any of the floor/wall/feat
// atlases — tileinfo-dngn dispatches via get_img(idx). Used for the dungeon
// background under monster sprites in the panel, mirroring draw_background.
export function prependDngnIndex(loader: TileLoader | null, wrap: HTMLElement, dngnIdx: number, scale = 1): void {
  if (!loader) return
  if (dngnIdx <= 0) return  // 0 = DNGN_UNSEEN; nothing to draw
  const child = document.createElement('div')
  child.className = 'tile'
  wrap.insertBefore(child, wrap.firstChild)
  loader.getDngnTex(dngnIdx).then((tex) => {
    paintSprite(loader, child, tex, dngnIdx, scale, 0, 0)
  }).catch((err) => console.warn('dngn tile load failed:', err))
}

function paintSprite(loader: TileLoader, child: HTMLElement, tex: number, id: number, scale: number, xofs: number, yofs: number): void {
  loader.getAsync(tex, id).then((s) => {
    const w = s.w * scale
    const h = s.h * scale
    const left = (s.ox + xofs) * scale
    const top = (s.oy + yofs) * scale
    child.style.width = `${w}px`
    child.style.height = `${h}px`
    child.style.left = `${left}px`
    child.style.top = `${top}px`
    child.style.backgroundImage = `url(${s.img.src})`
    child.style.backgroundPosition = `${-s.sx * scale}px ${-s.sy * scale}px`
    if (scale !== 1) {
      child.style.backgroundSize = `${s.img.naturalWidth * scale}px ${s.img.naturalHeight * scale}px`
    }
    const wrap = child.parentElement
    if (wrap?.dataset.expand) {
      const right = left + w
      const bottom = top + h
      const curW = parseFloat(wrap.style.width) || 0
      const curH = parseFloat(wrap.style.height) || 0
      if (right > curW) wrap.style.width = `${right}px`
      if (bottom > curH) wrap.style.height = `${bottom}px`
    }
  }).catch((err) => {
    console.warn('tile render failed:', err)
  })
}
