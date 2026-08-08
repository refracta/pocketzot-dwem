// Reflow the DCSS skill menu (`m`) from its native two-column terminal layout
// into a single column, so it fits a phone screen without horizontal panning.
//
// The menu is a fixed-geometry grid, not free text. Every cell is placed at
// constant character bounds (skill-menu.cc, SkillMenuEntry / SkillMenu::init):
//
//   cell   = name(20) ' ' level(5) ' ' progress(6) ' ' aptitude(5)  = 39 cols
//   left  cell at column 1, right cell at column 1 + MIN_COLS/2 = 40
//   text   = get_prefix() + ' ' + name, i.e. " <key> <sign> Name…"
//            → key at cell+1, sign at cell+3, name at cell+5
//
// So the columns are separated by a single character position that no cell can
// ever cross: the left cell's last field, the aptitude, is exactly 5 wide even
// at its widest ("+8 +4" — a skill with a manual), ending at column 39. That
// makes the reflow a plain split at a known column, with no need to sniff rows
// for hotkeys or measure the gap between the columns.
//
// Grid row 0 is the header (the SK_TITLE entry): the same cell frame carrying
// the name "     Skill" in each column. We find those two words and derive the
// split from them rather than hardcoding 40, so the reflow still holds if a
// future version changes MIN_COLS or the indent. Lines above the header (the
// experience menu's title) are full-width prose; lines below the grid are the
// help text and the command footer.
//
// Skills fill the LEFT column top to bottom, then the RIGHT, so stacking the
// two halves reproduces the natural a→z reading order in a single column.

// Offset of the skill name within a cell. get_prefix() renders " %c %c" (key,
// sign) and set_name() appends a space before the name; the header row spells
// the same gap out as the literal "     Skill".
const NAME_OFF = 5

// The grid's header row, which is also its measuring stick.
const HEADER_NAME = 'Skill'
const HEADER_RE = /^ *Skill +Level/

// Visual (rendered) text of an HTML line: tags removed, every entity collapsed
// to a single cell so indices line up with splitHtmlAtCol's column counting.
// Exported so tests measure columns the same way the reflow does.
export function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-zA-Z0-9#]+;/g, '·')
}

// Collapse a terminal line's alignment padding so it wraps as prose rather than
// breaking mid-phrase. For lines that are text, not grid.
function collapsePadding(html: string): string {
  return html.replace(/ {2,}/g, ' ')
}

interface Geometry {
  header: number // line index of the header row (= grid row 0)
  indent: number // column where the left column's cells begin
  cut: number // column where the right column's cells begin
}

// Measure the grid off its header row: the two "Skill" words sit at the name
// offset of their respective cells, so they give us both column origins.
function findGeometry(plains: string[]): Geometry | null {
  for (let i = 0; i < plains.length; i++) {
    if (!HEADER_RE.test(plains[i])) continue
    const left = plains[i].indexOf(HEADER_NAME)
    const right = plains[i].indexOf(HEADER_NAME, left + 1)
    // Only one column, or a first column too narrow to hold a cell's prefix:
    // not a grid we know how to measure, so don't touch it.
    if (right < 0 || left < NAME_OFF) return null
    return { header: i, indent: left - NAME_OFF, cut: right - NAME_OFF }
  }
  return null
}

// Is there a skill cell at this column? The frame is fixed, so we can simply
// look at it: the cell's separator columns are blank and its name column is
// non-blank. Do not require an ASCII capital here: DWEM can translate names
// before this view sees them. The key and sign columns both go blank (mastered
// skills, and every row under distributed training), so neither can be
// required.
function hasCell(plain: string, edge: number): boolean {
  return (
    plain[edge] === ' ' &&
    plain[edge + 2] === ' ' &&
    plain[edge + 4] === ' ' &&
    /\S/.test(plain[edge + NAME_OFF] ?? '')
  )
}

// Grid rows carry a cell in one column or the other; blank rows are the group
// separators between skill categories (SK_BLANK_LINE), which fall in each
// column independently. Help prose below the grid starts hard against the left
// edge, so it can never pass for a cell.
function isGridRow(plain: string, g: Geometry): boolean {
  return plain.trim() === '' || hasCell(plain, g.indent) || hasCell(plain, g.cut)
}

function closeTagFor(openTag: string): string {
  const m = /^<\s*([a-zA-Z0-9]+)/.exec(openTag)
  return m ? `</${m[1]}>` : ''
}

// Split an HTML fragment at a visual column (rendered glyph cells; tags count
// for nothing, an entity counts as one). Tags left open across the cut are
// closed on the left half and reopened on the right, so both halves are
// well-formed and keep their colours. Spans that would be left empty by the
// cut are elided rather than emitted as `<span></span>`.
export function splitHtmlAtCol(html: string, col: number): [string, string] {
  if (col <= 0) return ['', html]
  let left = ''
  let right = ''
  let visCol = 0
  let i = 0
  const n = html.length
  const open: string[] = [] // opening tags currently in scope (logical stack)
  let crossed = false
  let pending: string[] = [] // tags closed at the cut, awaiting reopen on the right

  const emitRight = (s: string): void => {
    if (pending.length) {
      right += pending.join('')
      pending = []
    }
    right += s
  }

  while (i < n) {
    const ch = html[i]
    if (ch === '<') {
      const gt = html.indexOf('>', i)
      const end = gt === -1 ? n : gt + 1
      const tag = html.slice(i, end)
      i = end
      const isClose = tag.startsWith('</')
      const isSelf = tag.endsWith('/>')
      if (!crossed) {
        left += tag
        if (isClose) open.pop()
        else if (!isSelf) open.push(tag)
      } else if (isClose) {
        open.pop()
        if (pending.length) pending.pop() // never reopened → drop both halves
        else right += tag // already reopened on the right → close it
      } else if (isSelf) {
        emitRight(tag)
      } else {
        emitRight(tag)
        open.push(tag)
      }
      continue
    }
    // A single rendered glyph: a plain char or an HTML entity.
    let glyph: string
    if (ch === '&') {
      const semi = html.indexOf(';', i)
      if (semi !== -1 && semi - i <= 10) {
        glyph = html.slice(i, semi + 1)
        i = semi + 1
      } else {
        glyph = ch
        i++
      }
    } else {
      glyph = ch
      i++
    }
    if (!crossed) {
      left += glyph
      visCol++
      if (visCol === col) {
        for (let k = open.length - 1; k >= 0; k--) left += closeTagFor(open[k])
        pending = [...open]
        crossed = true
      }
    } else {
      emitRight(glyph)
      visCol++
    }
  }
  return [left, right]
}

// Extract the visual columns [start, end) of an HTML fragment (end omitted =
// to the end). Built on splitHtmlAtCol, so spans straddling either edge are
// closed/reopened and colours survive.
function sliceHtmlCols(html: string, start: number, end?: number): string {
  const [, rest] = splitHtmlAtCol(html, start)
  if (end === undefined) return rest
  return splitHtmlAtCol(rest, end - start)[0]
}

// Drop trailing spaces, including any tucked just inside the final close tag(s)
// (e.g. "Help  </span>" → "Help</span>"). A cell that was nothing but padding
// (the empty half of a one-sided row) collapses to "".
function trimTrailingHtml(html: string): string {
  return html.replace(/ +(?=(?:<\/[^>]+>)*$)/g, '')
}

// A command marker in the help footer: "[" + a single key glyph + "]".
const CMD_MARKER = /\[\S\]/g

// The help footer is a 2–3 column grid of `[key] label` commands. Split each
// such line into one command per line (preserving the state colours inside
// labels like auto|manual). Non-command lines (prose) just get their alignment
// padding collapsed so they wrap as plain text instead of mid-phrase.
function reflowHelpLine(html: string): string[] {
  const cmds = [...plainText(html).matchAll(CMD_MARKER)]
  if (cmds.length < 2) return [collapsePadding(html)]
  const out: string[] = []
  for (let k = 0; k < cmds.length; k++) {
    const start = cmds[k].index ?? 0
    const end = k + 1 < cmds.length ? cmds[k + 1].index : undefined
    out.push(' ' + trimTrailingHtml(sliceHtmlCols(html, start, end)))
  }
  return out
}

function dropTrailingBlanks(cells: string[]): string[] {
  const out = [...cells]
  while (out.length && !plainText(out[out.length - 1]).trim()) out.pop()
  return out
}

// TranslationModule can replace the header and skill names with strings of a
// different width before the CRT reaches this view. In that case the upstream
// fixed-geometry ruler (the two English "Skill" labels) is no longer present.
// Locate translated cells by their stable hotkey/sign prefixes instead.
const FALLBACK_HOTKEY_RE = /(^|\s)([a-z0-9]) [+\-*] (?=\S)/g
const FALLBACK_BARE_RE = /(^|\s)[+\-*] (?=\S)/g
const FALLBACK_RIGHT_MIN = 20

function fallbackAnchors(plain: string, lettered: boolean): number[] {
  const out: number[] = []
  for (const match of plain.matchAll(lettered ? FALLBACK_HOTKEY_RE : FALLBACK_BARE_RE)) {
    const boundary = match[1]?.length ?? 0
    const col = (match.index ?? 0) + boundary
    if (col > 0 && plain[col - 1] !== ' ') continue
    out.push(col)
  }
  return out
}

function fallbackRightCol(plain: string, lettered: boolean): number {
  return fallbackAnchors(plain, lettered).find(col => col >= FALLBACK_RIGHT_MIN) ?? -1
}

function reflowTranslatedSkillCrt(lines: string[], plains: string[]): string[] | null {
  const lettered = plains.some(line => fallbackAnchors(line, true).length > 0)
  const gridRows = plains
    .map((line, index) => fallbackAnchors(line, lettered).length ? index : -1)
    .filter(index => index >= 0)
  if (gridRows.length === 0) return null

  let first = gridRows[0]
  let last = gridRows[gridRows.length - 1]
  const counts = new Map<number, number>()
  for (const index of gridRows) {
    const col = fallbackRightCol(plains[index], lettered)
    if (col >= 0) counts.set(col, (counts.get(col) ?? 0) + 1)
  }
  let cut = 41
  let bestCount = 0
  for (const [col, count] of counts) {
    if (count > bestCount) {
      cut = col
      bestCount = count
    }
  }

  const twoCells = (index: number): boolean =>
    bestCount > 0 && index >= 0 && index < lines.length
    && /\d/.test(plains[index])
    && plains[index][cut - 1] === ' ' && plains[index][cut - 2] === ' '
    && plains[index].slice(0, cut).trim() !== ''
    && plains[index].slice(cut).trim() !== ''
  while (twoCells(first - 1)) first--
  while (twoCells(last + 1)) last++

  const leftCells: string[] = []
  const rightCells: string[] = []
  for (let index = first; index <= last; index++) {
    const line = lines[index]
    const plain = plains[index]
    let col = fallbackRightCol(plain, lettered)
    if (col < 0 && bestCount > 0 && plain.slice(cut).trim()) col = cut
    if (col < 0) {
      if (plain.trim()) leftCells.push(line)
      continue
    }
    const [left, right] = splitHtmlAtCol(line, col)
    if (plainText(left).trim()) leftCells.push(trimTrailingHtml(left))
    if (plainText(right).trim()) rightCells.push(trimTrailingHtml(right))
  }

  const firstCell = leftCells.find(cell => plainText(cell).trim())
  const indent = firstCell ? /^( *)/.exec(plainText(firstCell))?.[1].length ?? 2 : 2
  const rightOut = rightCells.map(cell => ' '.repeat(indent) + cell)

  const head = lines.slice(0, first).map(line => trimTrailingHtml(collapsePadding(line)))
  const headerIndex = first - 1
  if (headerIndex >= 0 && plains[headerIndex].slice(cut).trim()) {
    const [leftHeader] = splitHtmlAtCol(lines[headerIndex], cut)
    head[head.length - 1] = trimTrailingHtml(leftHeader)
  }
  const repeatedHeader = head.length ? head[head.length - 1] : ''

  const body = [...leftCells]
  if (leftCells.length && rightOut.length) {
    body.push('')
    if (plainText(repeatedHeader).trim()) body.push(repeatedHeader)
  }
  body.push(...rightOut)

  const tail: string[] = []
  for (const line of lines.slice(last + 1)) tail.push(...reflowHelpLine(line))
  if (plains.slice(last + 1).some(line => line.trim())) tail.unshift('')
  return [...head, ...body, ...tail]
}

// Reflow the ordered CRT lines of a skill menu into a single column. Returns a
// new ordered array, or null if the lines carry no header row to measure the
// grid by — in which case the caller must fall back to showing them as an
// ordinary pannable terminal, since a grid we couldn't unstack is still 79
// columns wide.
export function reflowSkillCrt(lines: string[]): string[] | null {
  const plains = lines.map(plainText)
  const geo = findGeometry(plains)
  if (!geo) {
    // plainText represents every HTML entity with `·`, so that placeholder
    // alone does not mean the menu was translated.
    const translated = plains.some(line => /[^\x00-\x7f·]/.test(line))
    return translated ? reflowTranslatedSkillCrt(lines, plains) : null
  }

  // The grid runs from the header down to the first line that isn't a row of
  // it — the blank strip above the help text, or the help text itself.
  let last = geo.header
  while (last + 1 < lines.length && isGridRow(plains[last + 1], geo)) last++

  // Split every grid row at the column that separates the two cells, then
  // re-indent the right cells to the left column's origin so that Level, Train
  // and Apt keep lining up once the columns are stacked.
  const pad = ' '.repeat(geo.indent)
  const leftCol: string[] = []
  const rightCol: string[] = []
  for (let i = geo.header; i <= last; i++) {
    const [l, r] = splitHtmlAtCol(lines[i], geo.cut)
    leftCol.push(trimTrailingHtml(l))
    rightCol.push(plainText(r).trim() ? pad + trimTrailingHtml(r) : '')
  }

  // Stack the two columns, keeping the break between them: a blank line plus a
  // repeat of the header row. The terminal shows that header above each column,
  // and the left/right split is a meaningful grouping (physical vs. magical
  // skills) that players navigate by position — so preserve it.
  const leftCells = dropTrailingBlanks(leftCol.slice(1))
  const rightCells = dropTrailingBlanks(rightCol.slice(1))
  const body = [leftCol[0], ...leftCells]
  if (leftCells.length && rightCells.length) body.push('', rightCol[0])
  body.push(...rightCells)

  // Above the grid sits the experience menu's title ("You have gained great
  // experience…"), a full-width line, so it wraps as prose instead of keeping
  // the grid's alignment padding.
  const head = lines.slice(0, geo.header).map(l => trimTrailingHtml(collapsePadding(l)))

  // Below it, explanatory text and the command footer — itself a multi-column
  // grid, so reflow that to one command per line. The blank strip that padded
  // the grid out to its full height was absorbed above, so put a single blank
  // line back to keep the help text off the last skill row.
  const tail: string[] = []
  for (const line of lines.slice(last + 1)) tail.push(...reflowHelpLine(line))
  if (plains.slice(last + 1).some(p => p.trim())) tail.unshift('')

  return [...head, ...body, ...tail]
}
