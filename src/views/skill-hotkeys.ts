// Parse the on-screen hotkeys from a rendered DCSS skill menu (CRT lines).
//
// Each selectable skill row carries `X S Name…` — a hotkey letter/digit, a
// training sign (+, -, *), then the skill name. The name may be translated,
// so it is only required to start with a non-space character. Requiring the
// hotkey prefix to begin at the start of a line or after whitespace keeps us
// from false-matching the digits inside the level/cost/target columns.
//
// We deliberately do *not* anchor on leading spaces. When the left-column
// skill has a manual, its aptitude column renders as e.g. "+5 +4" — exactly
// APTITUDE_SIZE chars with no trailing pad — and the right column's hotkey
// ends up preceded by just one space instead of two, which a `^  X` anchor
// would miss.
const SKILL_HOTKEY_RE = /(?:^|\s)([a-z0-9]) [+\-*] (?=\S)/g

export function extractSkillHotkeys(lines: Iterable<string>): string[] {
  const seen = new Set<string>()
  for (const text of lines) {
    for (const m of text.matchAll(SKILL_HOTKEY_RE)) seen.add(m[1])
  }
  const order = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return [...order].filter(c => seen.has(c))
}
