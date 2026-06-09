// Reflow the DCSS skill menu (`m`) from its native two-column terminal layout
// into a single column, so it fits a phone screen without horizontal panning.
//
// The server renders the skill menu as a fixed 79-column grid and sends it as
// `txt` lines (HTML with fg/bg colour spans). Skills fill the LEFT column top
// to bottom (a–g…), then the RIGHT column (h–u…), so reading every left cell
// followed by every right cell reproduces the natural a→z order in one column.
//
// We split each grid line at the right column's position and stack the halves.
// The split is located by the right-column hotkey's *position*, never by
// counting spaces: a skill with a training manual appends a "+4" inside its
// fixed-width aptitude field, which changes the inter-column spacing — the trap
// that the `extractSkillHotkeys` space-anchored regex originally fell into.

import { SKILL_HOTKEY_RE } from './skill-hotkeys'

// A selectable skill row carries `X S Name` — hotkey, training sign, then a
// capitalised skill name. Shared with the hotkey parser (SKILL_HOTKEY_RE is
// global, for matchAll); a non-global copy is needed for the single `.test()`,
// since a global regex carries `.lastIndex` across `.test()` calls.
const SKILL_ROW = new RegExp(SKILL_HOTKEY_RE.source)

// A left-column hotkey sits at the indent (col ~2); the right column starts far
// past the 20-wide name field. Any hotkey at/after this column is the right one.
const RIGHT_COL_MIN = 20

// Visual (rendered) text of an HTML line: tags removed, every entity collapsed
// to a single cell so indices line up with splitHtmlAtCol's column counting.
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-zA-Z0-9#]+;/g, '·')
}

function hasSkillRow(plain: string): boolean {
  return SKILL_ROW.test(plain)
}

// Column index of the right-column hotkey, or -1 if the line has none.
function rightHotkeyCol(plain: string): number {
  for (const m of plain.matchAll(SKILL_HOTKEY_RE)) {
    if (m.index !== undefined && m.index >= RIGHT_COL_MIN) return m.index
  }
  return -1
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
// (e.g. "Help  </span>" → "Help</span>").
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
  if (cmds.length < 2) return [html.replace(/ {2,}/g, ' ')]
  const out: string[] = []
  for (let k = 0; k < cmds.length; k++) {
    const start = cmds[k].index ?? 0
    const end = k + 1 < cmds.length ? cmds[k + 1].index : undefined
    out.push(' ' + trimTrailingHtml(sliceHtmlCols(html, start, end)))
  }
  return out
}

// Reflow the ordered CRT lines of a skill menu into a single column. Returns a
// new ordered array. If the lines don't look like a skill grid (no skill rows),
// they're returned unchanged.
export function reflowSkillCrt(lines: string[]): string[] {
  const gridIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (hasSkillRow(plainText(lines[i]))) gridIdx.push(i)
  }
  if (gridIdx.length === 0) return lines

  const first = gridIdx[0]
  const last = gridIdx[gridIdx.length - 1]

  // Representative right-column position, used to split the (hotkey-less)
  // column-header line: the most common right-hotkey column across grid rows.
  const counts = new Map<number, number>()
  for (const i of gridIdx) {
    const c = rightHotkeyCol(plainText(lines[i]))
    if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let repRight = 41 // matches MIN_COLS/2 + indent; only a fallback
  let bestN = 0
  for (const [c, n] of counts) if (n > bestN) ((bestN = n), (repRight = c))

  const leftCells: string[] = []
  const rightCells: string[] = []
  for (let i = first; i <= last; i++) {
    const html = lines[i]
    const plain = plainText(html)
    const col = rightHotkeyCol(plain)
    if (col < 0) {
      // Left-only skill row, or a blank/spacer line within the grid.
      if (plain.trim()) leftCells.push(html)
      continue
    }
    const [l, r] = splitHtmlAtCol(html, col)
    if (plainText(l).trim()) leftCells.push(l)
    if (plainText(r).trim()) rightCells.push(r)
  }

  // Left cells keep the grid's leading indent (the left column sits at col ~2);
  // right cells were sliced at their hotkey, so they start flush. Re-indent the
  // right cells to match so every row's Level/Cost/Apt columns line up.
  let indent = 2
  for (const c of leftCells) {
    const m = /^( *)\S/.exec(plainText(c))
    if (m) {
      indent = m[1].length
      break
    }
  }
  const pad = ' '.repeat(indent)
  const rightOut = rightCells.map(c => pad + c)

  // Column header(s) above the grid: keep only the left copy.
  const head: string[] = []
  for (let i = 0; i < first; i++) {
    const [l] = splitHtmlAtCol(lines[i], repRight)
    head.push(l.replace(/\s+$/, ''))
  }

  // Stack the two columns, but keep the break between them: a blank line plus a
  // repeated header. The original two-column view shows the header above each
  // column, and the left/right split is a meaningful grouping (physical vs.
  // magic skills) that players navigate by position — so preserve it.
  const body: string[] = [...leftCells]
  if (leftCells.length && rightOut.length) body.push('', ...head)
  body.push(...rightOut)

  // Explanatory / help text below the grid: the command footer is itself a
  // multi-column grid, so reflow it to one command per line; prose lines just
  // get their padding collapsed so they wrap cleanly.
  const tail: string[] = []
  for (const line of lines.slice(last + 1)) tail.push(...reflowHelpLine(line))

  return [...head, ...body, ...tail]
}
