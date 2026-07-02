// Saved-character "doll" thumbnails for the login screen — a rolling gallery of
// your recently-played characters.
//
// We store the doll's tile-id recipe (the doll/mcache layer ids from the player's
// map cell), not a baked image: the DCSS atlases are cross-origin with no CORS, so
// compositing them taints the canvas and toDataURL() throws (memory
// project_doll_png_bake_blocked). The login strip re-renders the recipe as CSS
// sprite tiles, loading the ~1 MB atlas (HTTP-cached) only at display time.
//
// The store is a HISTORY, not one slot per version line: a new character appends
// (a reroll coexists with the character it replaced), the same character upserts in
// place. New-vs-same is decided by the turn count — monotonic within one life and
// reset to 0 for a new character, so a capture whose `turn` drops below the slot's
// current entry is a reroll. (Name/species collide between a dead char and its
// reroll, so they can't disambiguate; turn works even for combos started with no
// UI.) Upsert targets the slot's current (most-recent) entry — always the live
// save, since a (server, account, game_id) slot holds one at a time.
//
// Storage is newest-first (the strip paints in order → newest at the left edge).
// Two caps: STORE_CAP retained vs VISIBLE_CAP shown; past STORE_CAP the oldest
// rolls off.

const KEY = 'pocketzot:avatars'
// NUL delimiter — can't appear in URLs, usernames, or DCSS character names.
const SEP = '\x00'
// Retained history vs shown on the login row.
const STORE_CAP = 20
const VISIBLE_CAP = 4

// Mirror the wire shapes: doll part = [tile_id, ymax], mcache part = [tile_id,
// xofs, yofs]. Stored verbatim and handed to dollTileSpec at render time.
export type DollPart = [number, number]
export type McachePart = [number, number, number]

export interface Avatar {
  wsUrl: string                 // server — part of the dedup key, and the display origin
  username: string              // account name — part of the dedup key
  gameId: string                // version line ("dcss-0.34") — part of the dedup key, stable across rebuilds
  charName: string              // character name (player.name) — metadata only (usually = account name), never shown
  httpBase: string              // gamedata host (conn.httpBase), e.g. https://crawl.dcss.io
  version: string               // gamedata version dir (git hash) — with httpBase rebuilds the tile loader
  doll: DollPart[] | null       // player-doll body-part layers
  mcache: McachePart[] | null   // worn-equipment / monster-tile layers
  turn: number | null           // DCSS turn count at capture — a reset below the slot's current entry = new character
}

type AvatarKey = Pick<Avatar, 'wsUrl' | 'username' | 'gameId'>

function keyOf(a: AvatarKey): string {
  return a.wsUrl + SEP + a.username.toLowerCase() + SEP + a.gameId.toLowerCase()
}

function load(): Avatar[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Avatar[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persist(list: Avatar[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {}
}

// Store a freshly-captured recipe: append a new character (turn below the slot's
// current entry = a reroll), else upsert the slot's current entry. The slot key
// omits `version`, so a post-rebuild replay of the same character updates in place.
export function saveAvatar(
  a: Omit<Avatar, 'turn'>,
  opts: { turn?: number } = {},
): void {
  const list = load()
  const turn = opts.turn ?? null
  const entry: Avatar = { ...a, turn }
  const k = keyOf(a)
  // Slot's current entry = first match (the list is newest-first).
  const idx = list.findIndex((x) => keyOf(x) === k)
  const cur = idx >= 0 ? list[idx] : null
  const turnReset = cur != null && turn != null && cur.turn != null && turn < cur.turn
  // Reroll (or empty slot): keep any existing entry and prepend the new character.
  // Same character continuing: drop the stale entry so the prepend re-seats it at
  // front. Either way unshift keeps the list newest-first by construction — no
  // timestamp or re-sort needed; insertion order *is* recency.
  if (cur != null && !turnReset) list.splice(idx, 1)
  list.unshift(entry)
  if (list.length > STORE_CAP) list.length = STORE_CAP
  persist(list)
}

// The visible login row: newest-first, capped to VISIBLE_CAP.
export function listAvatars(): Avatar[] {
  return listAllAvatars().slice(0, VISIBLE_CAP)
}

// Full retained history, newest-first. saveAvatar is the only writer and keeps the
// list in newest-first order (unshift) and capped to STORE_CAP, so the read path
// neither re-sorts nor re-slices.
export function listAllAvatars(): Avatar[] {
  return load()
}
