// Rune adjective → main-atlas tile const. Adjectives are rune_type_name's
// (item-name.cc:980, identical in 0.34 and trunk) — the word in both the
// pickup message and the morgue `}` line. Tile consts are from rltiles
// dc-item.txt `item/misc/runes`; looked up BY NAME through the version's own
// tileinfo-main module (ids reshuffle per version, names don't). Gotchas:
// the tile is RUNE_ABYSS while the item enum is RUNE_ABYSSAL; mossy
// (RUNE_FOREST, removed branch) has no tile at all. Unknown words — mossy,
// a future rune, "buggy" — fall to the generic MISC_RUNE_OF_ZOT so the row
// never has a hole.
import { TEX, type TileLoader } from './tile-loader'
import type { TileRef } from './tile-view'

const RUNE_TILE: Record<string, string> = {
  iron: 'RUNE_DIS',
  obsidian: 'RUNE_GEHENNA',
  icy: 'RUNE_COCYTUS',
  bone: 'RUNE_TARTARUS',
  slimy: 'RUNE_SLIME',
  silver: 'RUNE_VAULTS',
  serpentine: 'RUNE_SNAKE',
  elven: 'RUNE_ELVEN',
  golden: 'RUNE_TOMB',
  decaying: 'RUNE_SWAMP',
  barnacled: 'RUNE_SHOALS',
  gossamer: 'RUNE_SPIDER',
  demonic: 'RUNE_DEMONIC',
  abyssal: 'RUNE_ABYSS',
  glowing: 'RUNE_MNOLEG',
  magical: 'RUNE_LOM_LOBON',
  fiery: 'RUNE_CEREBOV',
  dark: 'RUNE_GLOORX_VLOQ',
}
const GENERIC_RUNE = 'MISC_RUNE_OF_ZOT'
// The Orb of Zot's own tile (dc-item.txt OBJ_ORBS) — the row's win marker.
export const ORB = 'orb'

export function runeTileName(word: string): string {
  return word === ORB ? 'ORB' : (RUNE_TILE[word] ?? GENERIC_RUNE)
}

// "golden rune" / "Orb of Zot" — accessible/tooltip label.
export function runeLabel(word: string): string {
  return word === ORB ? 'Orb of Zot' : `${word} rune`
}

// Resolve a word to a drawable ref under this loader's tileinfo-main, or
// null when even the generic fallback name is missing (a module we don't
// understand — treat as "no sprite", not an error).
export async function runeTileRef(loader: TileLoader, word: string): Promise<TileRef | null> {
  const main = await loader.getModule('main')
  const t = main[runeTileName(word)] ?? main[GENERIC_RUNE]
  return typeof t === 'number' ? { t, tex: TEX.MAIN } : null
}

// ASCII-mode stand-ins for when no sprite can be drawn: the default charset's
// item glyphs (viewchar.cc dchar_table: DCHAR_ITEM_ORB '0', DCHAR_ITEM_RUNE
// 'φ' U+03C6) in the rune's own colour (items.cc item_def::rune_colour —
// element colours (colour.cc) reduced to their first component, except
// magical: ETC_MAGIC's second, lightblue, since glowing already takes
// lightmagenta; the demonic rune's random element and the abyssal rune's
// ETC_RANDOM get fixed picks). Colour names are DCSS_COLOR_MAP keys.
const RUNE_COLOUR: Record<string, string> = {
  iron: 'cyan', obsidian: 'darkgrey', icy: 'lightblue', bone: 'white', slimy: 'green',
  silver: 'lightgrey', serpentine: 'lightgreen', elven: 'lightgreen', golden: 'yellow',
  decaying: 'brown', barnacled: 'blue', gossamer: 'white', demonic: 'lightred',
  abyssal: 'magenta', glowing: 'lightmagenta', magical: 'lightblue', fiery: 'red',
  dark: 'darkgrey',
}
export function runeGlyph(word: string): { ch: string; colour: string } {
  if (word === ORB) return { ch: '0', colour: 'lightmagenta' } // ETC_MUTAGENIC
  return { ch: '\u03c6', colour: RUNE_COLOUR[word] ?? 'lightgrey' }
}
