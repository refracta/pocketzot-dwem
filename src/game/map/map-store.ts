import type { CellUpdate, MonsterInfo } from '../../ws/types'

export interface Cell {
  g: string   // glyph
  col: number // packed color byte
  t_bg?: number // tile background; bits MM_UNSEEN=0x20000 / UNSEEN=0x40000 indicate out-of-FOV
  // Tile foreground + overlays. Carried per cell (not just per monster) so
  // TileMapView can render items, clouds, ground icons, and the player avatar
  // — same fields the reference cell_renderer.js consumes from each cell.
  fg?: number | number[]
  cloud?: number
  icons?: number[]
  doll?: Array<[number, number]>
  mcache?: Array<[number, number, number]> | null
  flc?: number // flash colour index; 0 = no flash
  fla?: number // flash alpha override (0 = use palette default)
  // Extra render layers. Flattened from `t.*` on the wire into top-level
  // on the internal Cell so renderers can read `cell.sanctuary` etc.
  // directly. See ws/types.ts TileInfo for per-field semantics.
  sanctuary?: boolean
  blasphemy?: boolean
  has_bfb_corpse?: boolean
  silenced?: boolean
  halo?: number
  orb_glow?: number
  quad_glow?: boolean
  disjunct?: number
  highlighted_summoner?: boolean
  awakened_forest?: boolean
  bloody?: boolean
  old_blood?: boolean
  blood_rotation?: number
  liquefied?: boolean
  mangrove_water?: boolean
  travel_trail?: number
  ov?: number[]
  flv?: { f?: number; s?: number }
  trans?: boolean
  base?: number
  overlay1?: number
  overlay2?: number
}

export interface MonsterCell {
  mon: MonsterInfo
  g: string
  col: number
  x: number
  y: number
  fg?: number | number[]  // t.fg from the cell update; updated each turn for MDAM health flags
  // Humanoid composition (PLAYER atlas), copied from t.doll / t.mcache so the
  // monster panel can render the same layered sprite as the describe-monster popup.
  doll?: Array<[number, number]>
  mcache?: Array<[number, number, number]> | null
  // Pre-decoded icon tile ids from t.icons. The server resolves
  // monster_status_icons (tilepick.cc) for ~60 MB_* flags that aren't packed
  // into t.fg's 32-bit flag mask — MB_ABJURABLE → SUMMONED (the small purple
  // gem on summoned creatures), MB_MINION → MINION, MB_CONFUSED → CONFUSED,
  // status auras like MB_HASTED / MB_SLOWED, etc. Without carrying these
  // through, the panel only shows the few flags fgOverlayIcons can decode.
  icons?: number[]
  // Packed t.bg from the cell update, mirrored from Cell.t_bg. Low 16 bits
  // hold the dngn tile id (floor/wall/feat dispatch via tileinfo-dngn) so
  // the monster panel can stamp the dungeon background under each sprite,
  // matching what the reference's draw_background draws in the dungeon view.
  t_bg?: number
}

// From reference enums.js: MM_UNSEEN=0x00020000, UNSEEN=0x00040000.
// When either is set, the cell has been explored but is not in the player's current FOV.
const UNSEEN_MASK = 0x00060000

// Stores the known map state and merges delta updates from the server.
// The server sends cells as diffs: only changed fields are included,
// and x/y coordinates carry forward (if x omitted, use prev x+1; if y omitted use prev y).
export class MapStore {
  private cells = new Map<string, Cell>()
  private monsterMap = new Map<string, MonsterCell>()
  // Keyed by monster id; accumulates partial updates across turns (mirrors reference monster_table)
  private monsterTable = new Map<number, MonsterInfo>()
  // Canonical glyph per tracked monster id, stored on first sighting when cell includes g
  private monsterGlyphs = new Map<number, string>()
  // Reference count per tracked monster id: how many cells currently hold this monster
  private monsterRefs = new Map<number, number>()
  // Last full monster info seen at each cell, kept across out-of-FOV transitions.
  // Used to recover name/typedata when the server later sends a sparse {mon:{id:N}}
  // at a cell whose original sighting had no client_id assigned yet.
  private lastMonAtCell = new Map<string, { mon: MonsterInfo; g: string }>()
  playerPos = { x: 0, y: 0 }

  // Ballistomycetes and tentacles have no_exp=true but are threatening and should display.
  private isDisplayMonster(mon: MonsterInfo): boolean {
    if (!mon.name) return false              // sparse delta — wait for full data
    if (!mon.typedata?.no_exp) return true
    if (mon.name === 'active ballistomycete') return true
    if (mon.name?.match(/tentacle$/)) return true
    return false
  }

  merge(updates: CellUpdate[]): Set<string> {
    const dirty = new Set<string>()
    let curX = 0
    let curY = 0

    for (const u of updates) {
      // Coordinate delta encoding: if x is present, reset x; if y present update y.
      // If neither is present, x advances by 1.
      if (u.y !== undefined) curY = u.y
      if (u.x !== undefined) {
        curX = u.x
      } else {
        curX++
      }

      const key = `${curX},${curY}`
      const existing = this.cells.get(key)

      // Most per-cell render fields are inside `t` on the wire (tileweb.cc
      // opens `t` at line 1643 and closes at 1860). The 'X' in u.t check
      // distinguishes "absent → carry forward existing" from "explicit
      // 0/false/null → overwrite" — same pattern the reference shallow
      // merge_objects uses in game_data/static/map_knowledge.js.
      const t = u.t
      const cell: Cell = {
        g: u.g ?? existing?.g ?? ' ',
        col: u.col ?? existing?.col ?? 7,
        flc: u.flc ?? existing?.flc,
        fla: u.fla ?? existing?.fla,
        t_bg: t && 'bg' in t ? t.bg : existing?.t_bg,
        fg: t && 'fg' in t ? t.fg : existing?.fg,
        cloud: t && 'cloud' in t ? t.cloud : existing?.cloud,
        icons: t && 'icons' in t ? t.icons : existing?.icons,
        doll: t && 'doll' in t ? t.doll : existing?.doll,
        mcache: t && 'mcache' in t ? t.mcache : existing?.mcache,
        sanctuary: t && 'sanctuary' in t ? t.sanctuary : existing?.sanctuary,
        blasphemy: t && 'blasphemy' in t ? t.blasphemy : existing?.blasphemy,
        has_bfb_corpse: t && 'has_bfb_corpse' in t ? t.has_bfb_corpse : existing?.has_bfb_corpse,
        silenced: t && 'silenced' in t ? t.silenced : existing?.silenced,
        halo: t && 'halo' in t ? t.halo : existing?.halo,
        orb_glow: t && 'orb_glow' in t ? t.orb_glow : existing?.orb_glow,
        quad_glow: t && 'quad_glow' in t ? t.quad_glow : existing?.quad_glow,
        disjunct: t && 'disjunct' in t ? t.disjunct : existing?.disjunct,
        highlighted_summoner: t && 'highlighted_summoner' in t ? t.highlighted_summoner : existing?.highlighted_summoner,
        awakened_forest: t && 'awakened_forest' in t ? t.awakened_forest : existing?.awakened_forest,
        bloody: t && 'bloody' in t ? t.bloody : existing?.bloody,
        old_blood: t && 'old_blood' in t ? t.old_blood : existing?.old_blood,
        blood_rotation: t && 'blood_rotation' in t ? t.blood_rotation : existing?.blood_rotation,
        liquefied: t && 'liquefied' in t ? t.liquefied : existing?.liquefied,
        mangrove_water: t && 'mangrove_water' in t ? t.mangrove_water : existing?.mangrove_water,
        travel_trail: t && 'travel_trail' in t ? t.travel_trail : existing?.travel_trail,
        ov: t && 'ov' in t ? t.ov : existing?.ov,
        flv: t && 'flv' in t ? t.flv : existing?.flv,
        trans: t && 'trans' in t ? t.trans : existing?.trans,
        base: t && 'base' in t ? t.base : existing?.base,
        overlay1: t && 'overlay1' in t ? t.overlay1 : existing?.overlay1,
        overlay2: t && 'overlay2' in t ? t.overlay2 : existing?.overlay2,
      }
      this.cells.set(key, cell)
      dirty.add(key)

      const existingMonCell = this.monsterMap.get(key)
      // A cell is out of FOV when its t.bg has the UNSEEN or MM_UNSEEN bit set.
      // Only treat as out-of-FOV when we have definitive t_bg evidence; if unknown, assume visible.
      const outOfFov = cell.t_bg !== undefined && (cell.t_bg & UNSEEN_MASK) !== 0

      // Track monster presence. 'mon' in u distinguishes explicit null from absent.
      if ('mon' in u) {
        const existingId = existingMonCell?.mon.id

        if (u.mon == null) {
          // Explicit removal — monster died or left this cell
          if (existingId !== undefined) {
            this.monsterRefs.set(existingId, (this.monsterRefs.get(existingId) ?? 0) - 1)
          }
          this.monsterMap.delete(key)
        } else {
          const id = u.mon.id

          // Update monsterTable for id'd monsters. The server sends sparse {mon:{id:N}}
          // on re-entry into FOV, expecting full data (name, typedata) to already be
          // present. This is *not* always true: DCSS deliberately resets a monster's
          // client_id on every FOV exit (see player-notices.cc reset_client_id), so a
          // returning monster gets a brand-new id with no monsterTable entry. To recover,
          // we fall back to the per-cell cache populated below from the previous sighting.
          if (id !== undefined) {
            const entry = this.monsterTable.get(id)
            if (entry) {
              Object.assign(entry, u.mon)
            } else {
              const prior = existingMonCell ?? this.lastMonAtCell.get(key)
              if (prior) {
                this.monsterTable.set(id, { ...prior.mon, ...u.mon })
                if (u.g === undefined && !this.monsterGlyphs.has(id)) {
                  this.monsterGlyphs.set(id, prior.g)
                }
              } else {
                this.monsterTable.set(id, u.mon)
              }
            }
            if (u.g !== undefined) {
              this.monsterGlyphs.set(id, u.g)
            }
          }

          // Resolve the most-complete monster info for this cell (table merge + sparse delta).
          const merged: MonsterInfo = id !== undefined ? this.monsterTable.get(id)! : u.mon
          const cellGlyph = id !== undefined ? (this.monsterGlyphs.get(id) ?? cell.g) : cell.g

          // Cache per-cell so a later sparse {id:N} at this cell can recover the original
          // (id-less) monster info even after the cell went out of FOV. Populate even when
          // out of FOV — initial clear:true dumps render memorized monsters as out-of-FOV
          // cells, and that's exactly the data we need to remember for the upgrade.
          if (merged.name) this.lastMonAtCell.set(key, { mon: merged, g: cellGlyph })

          if (outOfFov) {
            // Out of FOV: table is updated above, but remove from display list
            if (existingId !== undefined) {
              this.monsterRefs.set(existingId, (this.monsterRefs.get(existingId) ?? 0) - 1)
            }
            this.monsterMap.delete(key)
          } else {
            // Visible monster: update display list with ref counting
            // Untracked (no-id) monsters always arrive with full data; use snapshot directly.
            if (!this.isDisplayMonster(merged)) {
              if (existingId !== undefined) {
                this.monsterRefs.set(existingId, (this.monsterRefs.get(existingId) ?? 0) - 1)
              }
              this.monsterMap.delete(key)
              continue
            }

            if (id !== undefined) {
              if (existingId !== undefined) {
                this.monsterRefs.set(existingId, (this.monsterRefs.get(existingId) ?? 0) - 1)
              }
              this.monsterRefs.set(id, (this.monsterRefs.get(id) ?? 0) + 1)
            }
            // Distinguish "field absent" (carry forward) from "field present with
            // null/empty" (server cleared it) — `??` would mask an explicit null
            // mcache (e.g. polymorph from humanoid → non-humanoid keeping the
            // same monster id) and leak the previous humanoid sprite.
            this.monsterMap.set(key, {
              mon: merged, g: cellGlyph, col: cell.col, x: curX, y: curY,
              fg: u.t && 'fg' in u.t ? u.t.fg : existingMonCell?.fg,
              doll: u.t && 'doll' in u.t ? u.t.doll : existingMonCell?.doll,
              mcache: u.t && 'mcache' in u.t ? u.t.mcache : existingMonCell?.mcache,
              icons: u.t && 'icons' in u.t ? u.t.icons : existingMonCell?.icons,
              t_bg: cell.t_bg,
            })
          }
        }
      } else if (outOfFov) {
        // Cell carries the UNSEEN t.bg bit — drop any stale entry from the active list.
        // Do NOT trigger on bare glyph changes: spell animations briefly swap a cell's glyph
        // (e.g. soul splinter overlays the target with '*') without the monster leaving, and
        // the reference client only modifies a cell's monster when the update has a `mon` field.
        if (existingMonCell?.mon.id !== undefined) {
          const prev = (this.monsterRefs.get(existingMonCell.mon.id) ?? 0) - 1
          this.monsterRefs.set(existingMonCell.mon.id, prev)
        }
        this.monsterMap.delete(key)
      } else if (existingMonCell && u.t) {
        // In-FOV cell update with no 'mon' field: monsterinfo unchanged
        // (name/threat/att/etc.) but tile state may have shifted. Most common
        // case is a damage-only delta carrying t.fg with new MDAM bits, but
        // equipment swaps or sprite changes can ship t.doll / t.mcache without
        // a fresh fg, and we want those to land too.
        if ('fg' in u.t) existingMonCell.fg = u.t.fg
        if ('doll' in u.t) existingMonCell.doll = u.t.doll
        if ('mcache' in u.t) existingMonCell.mcache = u.t.mcache
        if ('icons' in u.t) existingMonCell.icons = u.t.icons
        if ('bg' in u.t) existingMonCell.t_bg = u.t.bg
      }
    }

    // Purge tracked monsters no longer present in any cell (mirrors reference clean_monster_table).
    // Collect first to avoid mutating the map while iterating.
    const toDelete: number[] = []
    for (const [id, refs] of this.monsterRefs) {
      if (refs <= 0) toDelete.push(id)
    }
    for (const id of toDelete) {
      // Keep monsterTable: server sends sparse delta on re-entry into FOV,
      // expecting full data (name, typedata) to still be present.
      this.monsterGlyphs.delete(id)
      this.monsterRefs.delete(id)
    }

    return dirty
  }

  get(x: number, y: number): Cell | undefined {
    return this.cells.get(`${x},${y}`)
  }

  getMonsters(): ReadonlyMap<string, MonsterCell> {
    return this.monsterMap
  }

  clear(): void {
    this.cells.clear()
    this.monsterMap.clear()
    this.monsterTable.clear()
    this.monsterGlyphs.clear()
    this.monsterRefs.clear()
    this.lastMonAtCell.clear()
  }

  get size(): number {
    return this.cells.size
  }

  // Debug: expose internals for live inspection during dev.
  _debug() {
    return {
      monsterTable: Array.from(this.monsterTable.entries()),
      monsterMap: Array.from(this.monsterMap.entries()),
      monsterRefs: Array.from(this.monsterRefs.entries()),
      monsterGlyphs: Array.from(this.monsterGlyphs.entries()),
      lastMonAtCell: Array.from(this.lastMonAtCell.entries()),
    }
  }
}
