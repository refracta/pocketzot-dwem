// Custom control sets: the user-swappable button layouts for the touch
// panel's three control tabs. A set covers ONLY the 3×4 / 3×3 button grids
// and the three tab labels — the d-pad, Esc/Enter, Shift/Ctrl and the abc▴
// keyboard toggle are fixed chrome and never part of a set.
//
// Two built-in sets are always available and immutable; custom sets persist
// in localStorage and travel between installs as a human-readable
// `pocketzot-controls:1:` string (see encode/decode below).

import { fnKeycode } from './keyboard'
import { getPref, setPref } from '../../prefs'

// A slot's action — exactly one of `text` (1–3 printable chars sent as a
// single input message; the server writes multi-char text to the game pty
// atomically, so short macros like "za." are safe) or `key` (a special
// wire keycode from SPECIAL_KEYS). An empty slot is `null` in the grid.
export interface SlotDef {
  text?: string
  key?: number
}

export interface ControlTabDef {
  name: string          // single-char tab label
  cols: 3 | 4           // grid is always 3 rows; 3 or 4 columns
  slots: (SlotDef | null)[]  // row-major, length 3 * cols
}

export interface ControlSet {
  id: string
  name: string
  builtin?: boolean
  tabs: [ControlTabDef, ControlTabDef, ControlTabDef]
}

const GRID_ROWS = 3
export const MAX_MACRO_LEN = 3
export const CONTROLS_CHANGED_EVENT = 'pocketzot:controls-changed'

const SETS_KEY = 'pocketzot:control-sets'
// Export strings open with the fixed marker, then the format version:
// "pocketzot-controls:1:…" — so the marker stands out and a future format
// bump (:2:) stays distinguishable from garbage on import.
const EXPORT_MARKER = 'pocketzot-controls:'
const EXPORT_VERSION = 1
const EXPORT_PREFIX = `${EXPORT_MARKER}${EXPORT_VERSION}:`

// --- Special keys ---------------------------------------------------------

export interface SpecialKey {
  keycode: number
  label: string      // button face
  token: string      // export-format token, without braces
  title: string      // long name (tooltip / picker)
  inPicker?: boolean // false = label/encode/decode support only, not offered in the picker
}

// F1–F12, sequential from F1 = -265 per the engine's cio.h numbering
// (fnKeycode in keyboard.ts, the home of the wire keycode tables).
const FKEYS: SpecialKey[] = Array.from({ length: 12 }, (_, i) => ({
  keycode: fnKeycode(i + 1),
  label: `F${i + 1}`,
  token: `F${i + 1}`,
  title: `F${i + 1}`,
}))

// Ctrl+letter sends the control character (1–26), same as the physical
// keyboard path. The full table drives labels and the export tokens, but the
// picker offers only the combos trunk actually binds to something a button
// user could want (cmd-keys.h), titled with the command so the tooltip reads
// "Ctrl+P — Replay messages". Not offered: ^H/^J/^K/^L/^Y/^U/^B/^N
// (attack-without-move — the d-pad's ⌃ modifier already covers those) and
// other unbound letters. ^I/^M are absent from the table entirely: their
// control characters ARE Tab (9) and Enter (13), listed above.
const CTRL_COMMANDS: Record<string, string> = {
  A: 'Toggle autopickup',
  C: 'Clear map',
  D: 'Macro menu',
  E: 'Add macro',
  F: 'Search stashes',
  G: 'Interlevel travel',
  O: 'Dungeon overview',
  P: 'Replay messages',
  Q: 'Quit (abandon character)',
  S: 'Save and exit',
  W: 'Set travel waypoint',
  X: 'List what is in view',
}
const CTRL_KEYS: SpecialKey[] = [...'ABCDEFGHJKLNOPQRSTUVWXYZ'].map(c => {
  const cmd = CTRL_COMMANDS[c]
  return {
    keycode: c.charCodeAt(0) - 64,
    label: `^${c}`,
    token: `^${c}`,
    title: cmd ? `Ctrl+${c} — ${cmd}` : `Ctrl+${c}`,
    inPicker: !!cmd,
  }
})

export const SPECIAL_KEYS: SpecialKey[] = [
  { keycode: 9, label: '⇥', token: 'Tab', title: 'Tab (auto-fight nearest)' },
  { keycode: 13, label: '⏎', token: 'Ent', title: 'Enter' },
  { keycode: 27, label: '⎋', token: 'Esc', title: 'Escape' },
  ...FKEYS,
  ...CTRL_KEYS,
]

// What the settings editor's key picker actually offers.
export const PICKER_KEYS: SpecialKey[] = SPECIAL_KEYS.filter(k => k.inPicker !== false)

const KEY_BY_CODE = new Map(SPECIAL_KEYS.map(k => [k.keycode, k]))
const KEY_BY_TOKEN = new Map(SPECIAL_KEYS.map(k => [k.token, k]))

// --- Labels & titles -------------------------------------------------------

// Known single-char commands → descriptions, used for button tooltips and the
// editor. Unknown commands simply get no description.
const TEXT_TITLES: Record<string, string> = {
  '5': 'Rest until healed',
  '.': 'Wait one turn',
  's': 'Wait one turn',
  'i': 'Inventory',
  'o': 'Auto-explore',
  'q': 'Quaff potion',
  'r': 'Read scroll',
  'f': 'Fire / quivered',
  'v': 'Evoke item',
  'a': 'Use ability',
  'e': 'Equip / unequip',
  'x': 'Examine surroundings',
  ',': 'Pick up item',
  'g': 'Pick up item',
  'w': 'Wield weapon',
  'R': 'Remove jewellery',
  't': 'Tell allies (tt to shout)',
  'P': 'Put on jewellery',
  'd': 'Drop',
  'G': 'Go to level / branch',
  'X': 'Examine level map',
  '<': 'Ascend stairs',
  '>': 'Descend stairs',
  'z': 'Cast spell',
  '@': 'Character status',
  '%': 'Character overview',
  '^': 'Religion / deity',
  '=': 'Reassign inventory/spell letters',
  'A': 'Abilities/mutations',
  'm': 'Skills screen',
  '}': 'Runes collected',
  '\\': 'Item knowledge',
  '$': 'Gold / shopping list',
  'M': 'Spell library',
  'I': 'List memorised spells',
  '?': 'Help',
}

export function slotLabel(slot: SlotDef): string {
  if (slot.key !== undefined) return KEY_BY_CODE.get(slot.key)?.label ?? `#${slot.key}`
  return (slot.text ?? '').replace(/ /g, '␣')
}

export function slotTitle(slot: SlotDef): string | undefined {
  if (slot.key !== undefined) return KEY_BY_CODE.get(slot.key)?.title
  const text = slot.text ?? ''
  if (text.length === 1) return TEXT_TITLES[text]
  return `Send "${text}"`
}

// --- Built-in sets ---------------------------------------------------------

function t(text: string): SlotDef { return { text } }
function k(key: number): SlotDef { return { key } }

const INFO_SLOTS = (): SlotDef[] => [
  t('@'), t('%'), t('^'), t('='),
  t('A'), t('m'), t('}'), t('\\'),
  t('$'), t('M'), t('I'), t('?'),
]

export const STANDARD_ID = 'standard'

function builtinStandard(): ControlSet {
  return {
    id: STANDARD_ID,
    name: 'Standard (12 per tab)',
    builtin: true,
    tabs: [
      { name: '@', cols: 4, slots: [
        k(9), t('5'), t('i'), t('o'),
        t('q'), t('r'), t('f'), t('v'),
        t('a'), t('e'), t('x'), t(','),
      ] },
      { name: '>', cols: 4, slots: [
        t('w'), t('R'), t('t'), t('P'),
        t('d'), k(6), t('G'), k(15),
        t('X'), t('e'), t('<'), t('>'),
      ] },
      { name: '?', cols: 4, slots: INFO_SLOTS() },
    ],
  }
}

function builtinBigKeys(): ControlSet {
  return {
    id: 'bigkeys',
    name: 'Big keys (9+9+12)',
    builtin: true,
    tabs: [
      { name: '@', cols: 3, slots: [
        k(9), t('5'), t('o'),
        t('q'), t('r'), t('f'),
        t('a'), t('x'), t('i'),
      ] },
      { name: '>', cols: 3, slots: [
        t('w'), t('e'), t('d'),
        k(6), t('G'), k(15),
        t('X'), t('<'), t('>'),
      ] },
      { name: '?', cols: 4, slots: INFO_SLOTS() },
    ],
  }
}

export function builtinSets(): ControlSet[] {
  return [builtinStandard(), builtinBigKeys()]
}

// --- Persistence -----------------------------------------------------------

function loadCustom(): ControlSet[] {
  try {
    const raw = localStorage.getItem(SETS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as ControlSet[]
    return Array.isArray(arr) ? arr.filter(s => s && typeof s.id === 'string' && Array.isArray(s.tabs)) : []
  } catch {
    return []
  }
}

function storeCustom(sets: ControlSet[]): void {
  try {
    localStorage.setItem(SETS_KEY, JSON.stringify(sets))
  } catch {}
}

function fireChanged(): void {
  window.dispatchEvent(new Event(CONTROLS_CHANGED_EVENT))
}

export function listControlSets(): ControlSet[] {
  return [...builtinSets(), ...loadCustom()]
}

export function getControlSet(id: string): ControlSet | undefined {
  return listControlSets().find(s => s.id === id)
}

export function getActiveControlSet(): ControlSet {
  return getControlSet(getPref('controlSetId')) ?? builtinStandard()
}

export function setActiveControlSet(id: string): void {
  if (!getControlSet(id)) return
  setPref('controlSetId', id)
  fireChanged()
}

export function newSetId(): string {
  return 'set-' + Math.random().toString(36).slice(2, 10)
}

// Deep-copy a set under a new identity (never built-in) — the editor's
// new/duplicate flows start from this.
export function cloneSet(set: ControlSet, id: string, name: string): ControlSet {
  const copy = JSON.parse(JSON.stringify(set)) as ControlSet
  copy.id = id
  copy.name = name
  delete copy.builtin
  return copy
}

// Upsert a custom set. Built-in ids are immutable — silently ignored.
export function saveControlSet(set: ControlSet): void {
  if (builtinSets().some(b => b.id === set.id)) return
  const custom = loadCustom()
  const i = custom.findIndex(s => s.id === set.id)
  if (i >= 0) custom[i] = set
  else custom.push(set)
  storeCustom(custom)
  if (getPref('controlSetId') === set.id) fireChanged()
}

export function deleteControlSet(id: string): void {
  const custom = loadCustom()
  const next = custom.filter(s => s.id !== id)
  if (next.length === custom.length) return
  storeCustom(next)
  if (getPref('controlSetId') === id) {
    setPref('controlSetId', STANDARD_ID)
    fireChanged()
  }
}

// --- Export / import string format ------------------------------------------
//
//   pocketzot-controls:1:<name>|<tab>|<tab>|<tab>
//   tab   := <namechar><cols>:<tok> <tok> …   (3*cols tokens, row-major)
//   tok   := {}            empty slot
//          | {Tab} {Ent} {Esc} {F1}…{F12} {^A}…   special key
//          | literal text (1–3 chars) with escapes:
//            {sp}=space {lb}={ {rb}=} {bar}=|
//
// Human-readable and hand-editable; every structural character that could
// also be a crawl command ({ } | space) round-trips through the escape table.

const ESCAPE_NAMES: Record<string, string> = { sp: ' ', lb: '{', rb: '}', bar: '|' }
const ESCAPE_CHARS: Record<string, string> = { ' ': '{sp}', '{': '{lb}', '}': '{rb}', '|': '{bar}' }

// Key tokens are space-separated, so their spaces must be escaped…
function escText(s: string): string {
  return s.replace(/[ {}|]/g, ch => ESCAPE_CHARS[ch])
}

// …but the name fields are |-delimited, so their spaces can stay readable.
function escName(s: string): string {
  return s.replace(/[{}|]/g, ch => ESCAPE_CHARS[ch])
}

function unescText(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{') {
      const end = s.indexOf('}', i)
      if (end < 0) throw new Error(`unterminated escape in "${s}"`)
      const name = s.slice(i + 1, end)
      const ch = ESCAPE_NAMES[name]
      if (ch === undefined) throw new Error(`unknown escape {${name}}`)
      out += ch
      i = end
    } else if (c === '}') {
      throw new Error(`stray "}" in "${s}"`)
    } else {
      out += c
    }
  }
  return out
}

function encodeToken(slot: SlotDef | null): string {
  if (!slot) return '{}'
  if (slot.key !== undefined) {
    const sk = KEY_BY_CODE.get(slot.key)
    if (!sk) throw new Error(`unencodable keycode ${slot.key}`)
    return `{${sk.token}}`
  }
  return escText(slot.text ?? '')
}

function decodeToken(tok: string): SlotDef | null {
  if (tok === '{}') return null
  const m = /^\{(.+)\}$/.exec(tok)
  if (m && KEY_BY_TOKEN.has(m[1])) return { key: KEY_BY_TOKEN.get(m[1])!.keycode }
  // {^I}/{^M} aliases: wire-identical to Tab/Enter, absent from the table
  const ctrl = m && /^\^([A-Z])$/.exec(m[1])
  if (ctrl) return { key: ctrl[1].charCodeAt(0) - 64 }
  const text = unescText(tok)
  if (!text || text.length > MAX_MACRO_LEN) throw new Error(`bad key token "${tok}"`)
  if (/[\x00-\x1f\x7f]/.test(text)) throw new Error(`bad key token "${tok}"`)
  return { text }
}

export function encodeControlSet(set: ControlSet): string {
  const tabs = set.tabs.map(tab =>
    escName(tab.name) + tab.cols + ':' + tab.slots.map(encodeToken).join(' '))
  return EXPORT_PREFIX + escName(set.name) + '|' + tabs.join('|')
}

export function decodeControlSet(raw: string): Omit<ControlSet, 'id'> {
  const s = raw.trim()
  if (!s.startsWith(EXPORT_MARKER)) {
    throw new Error(`not a control-set string (expected it to start with "${EXPORT_MARKER}")`)
  }
  const ver = /^(\d+):/.exec(s.slice(EXPORT_MARKER.length))
  if (!ver) throw new Error('missing format version (expected "pocketzot-controls:1:…")')
  if (Number(ver[1]) !== EXPORT_VERSION) {
    throw new Error(`format version ${ver[1]} is newer than this app understands (version ${EXPORT_VERSION})`)
  }
  const parts = s.slice(EXPORT_PREFIX.length).split('|')
  if (parts.length !== 4) throw new Error('expected a name and exactly 3 tabs')
  const name = unescText(parts[0]).trim()
  if (!name || name.length > 48) throw new Error('bad set name')
  const tabs = parts.slice(1).map(field => {
    const m = /^(.*?)([34]):(.*)$/.exec(field)
    if (!m) throw new Error(`bad tab header in "${field.slice(0, 20)}"`)
    const tabName = unescText(m[1])
    if ([...tabName].length !== 1) throw new Error('tab name must be a single character')
    const cols = Number(m[2]) as 3 | 4
    const toks = m[3].split(' ')
    if (toks.length !== GRID_ROWS * cols) {
      throw new Error(`tab "${tabName}" needs ${GRID_ROWS * cols} keys, got ${toks.length}`)
    }
    return { name: tabName, cols, slots: toks.map(decodeToken) }
  })
  return { name, tabs: tabs as ControlSet['tabs'] }
}

// Decode, store as a new custom set, and return it. Throws (with a
// user-showable message) on any format error.
export function importControlSet(raw: string): ControlSet {
  const decoded = decodeControlSet(raw)
  const set: ControlSet = { id: newSetId(), ...decoded }
  saveControlSet(set)
  return set
}
