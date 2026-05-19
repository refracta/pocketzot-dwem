// Portions of this file are ported from Dungeon Crawl Stone Soup,
// webserver/game_data/static/cell_renderer.js (draw_dolls). DCSS is
// Copyright 1997–2025 Linley Henzell, the dev team, and contributors;
// GPL-2.0-or-later. Reused under the "or later" option as part of this
// AGPL-3.0-or-later work. See ATTRIBUTION.md and LICENSE.

import { tileLoader, TEX } from './tile-loader'

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
export function renderTiles(tiles: TileRef[], scale = 1, opts?: { expand?: boolean }): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'tile-stack'
  wrap.style.width = `${CELL * scale}px`
  wrap.style.height = `${CELL * scale}px`
  if (opts?.expand) wrap.dataset.expand = '1'
  appendTiles(wrap, tiles, scale)
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
//      tuple slot (ymax, used for water clipping in the reference) is
//      currently dropped — we don't render water effects.
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

// Resolves status-icon constant names (e.g. 'STAB_BRAND', 'POISON') and/or
// raw numeric ids against the icons tileinfo module and appends them as
// overlay tiles on top of an already-rendered base sprite. Shared by the
// monster panel rows and the describe-monster popup so both surfaces
// produce identical icon stacks.
export function appendIconOverlays(
  wrap: HTMLElement,
  spec: { names?: string[]; ids?: number[] },
  scale = 1,
): void {
  const names = spec.names ?? []
  const ids = spec.ids ?? []
  if (names.length === 0 && ids.length === 0) return
  tileLoader.getModule('icons').then((mod) => {
    const overlays: TileRef[] = []
    for (const name of names) {
      const id = mod[name]
      if (typeof id === 'number') overlays.push({ t: id, tex: TEX.ICONS })
    }
    for (const id of ids) overlays.push({ t: id, tex: TEX.ICONS })
    if (overlays.length > 0) appendTiles(wrap, overlays, scale)
  }).catch((err) => console.warn('icon module load failed:', err))
}

// Adds tiles into an existing tile-stack wrapper. Used to layer extra
// overlays (e.g. monster status icons that arrive after a constants
// lookup) on top of an already-rendered base sprite.
export function appendTiles(wrap: HTMLElement, tiles: TileRef[], scale = 1): void {
  if (!tileLoader.configured) return
  for (const t of tiles) {
    const child = document.createElement('div')
    child.className = 'tile'
    wrap.appendChild(child)
    paintSprite(child, t.tex, t.t, scale, t.xofs ?? 0, t.yofs ?? 0)
  }
}

// Inserts a dngn-atlas tile (e.g. HALO_FRIENDLY) at the bottom of the stack,
// beneath any later-appended layers. Synchronously creates the placeholder
// div before the module/atlas loads so DOM order — and therefore paint order
// inside the .tile-stack stacking context — reflects the call site, not the
// async resolution race between this and appendTiles for the doll.
export function prependDngnLayer(wrap: HTMLElement, dngnName: string, scale = 1): void {
  if (!tileLoader.configured) return
  const child = document.createElement('div')
  child.className = 'tile'
  wrap.insertBefore(child, wrap.firstChild)
  tileLoader.getModule('feat').then((mod) => {
    const id = mod[dngnName]
    if (typeof id !== 'number') return
    paintSprite(child, TEX.FEAT, id, scale, 0, 0)
  }).catch((err) => console.warn('feat module load failed:', err))
}

// Same as prependDngnLayer but takes a numeric dngn id (low 16 bits of t.bg)
// rather than a named constant. The id can land in any of the floor/wall/feat
// atlases — tileinfo-dngn dispatches via get_img(idx). Used for the dungeon
// background under monster sprites in the panel, mirroring draw_background.
export function prependDngnIndex(wrap: HTMLElement, dngnIdx: number, scale = 1): void {
  if (!tileLoader.configured) return
  if (dngnIdx <= 0) return  // 0 = DNGN_UNSEEN; nothing to draw
  const child = document.createElement('div')
  child.className = 'tile'
  wrap.insertBefore(child, wrap.firstChild)
  tileLoader.getDngnTex(dngnIdx).then((tex) => {
    paintSprite(child, tex, dngnIdx, scale, 0, 0)
  }).catch((err) => console.warn('dngn tile load failed:', err))
}

function paintSprite(child: HTMLElement, tex: number, id: number, scale: number, xofs: number, yofs: number): void {
  tileLoader.getAsync(tex, id).then((s) => {
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
