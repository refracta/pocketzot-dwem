// Branch-name abbreviation for the compact HUD's place chip: "Elven Halls:3"
// → "Elf:3", the same short forms the lobby rows, milestones, and morgue
// notes use, so the vocabulary is already native to crawl players.
//
// The player message's `place` is the branch *shortname* from branch-data.h
// ("Dungeon", "Slime Pits"), which tileweb.cc decorates with an article for
// single-level branches ("The Abyss", "a Sewer", "an Ossuary") — strip that
// before lookup. The table below holds only the branches whose abbrevname
// differs from their shortname (branch-data.h, trunk); everything else — and
// any branch a future version adds — passes through unchanged, so unknown
// names degrade to the full form rather than breaking.
const PLACE_ABBREV: Record<string, string> = {
  'Dungeon': 'D',
  'Orcish Mines': 'Orc',
  'Elven Halls': 'Elf',
  'Dwarven Hall': 'Dwarf',
  'Snake Pit': 'Snake',
  'Spider Nest': 'Spider',
  'Slime Pits': 'Slime',
  'Hall of Blades': 'Blade',
  'Gehenna': 'Geh',
  'Cocytus': 'Coc',
  'Tartarus': 'Tar',
  'Pandemonium': 'Pan',
  'Ziggurat': 'Zig',
  'Labyrinth': 'Lab',
  'Ice Cave': 'IceCv',
  'Wizlab': 'WizLab',
}

export function abbrevPlace(place: string): string {
  const bare = place.replace(/^(?:the|a|an) /i, '')
  return PLACE_ABBREV[bare] ?? bare
}
