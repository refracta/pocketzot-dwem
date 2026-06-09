import { describe, it, expect } from 'vitest'
import { splitHtmlAtCol, reflowSkillCrt } from './skill-reflow'

// Strip tags so tests can assert on rendered text without span noise.
const text = (html: string): string => html.replace(/<[^>]*>/g, '')

describe('splitHtmlAtCol', () => {
  it('splits plain text at the column', () => {
    expect(splitHtmlAtCol('abcdef', 3)).toEqual(['abc', 'def'])
  })

  it('returns all-right for col 0 and all-left for col past the end', () => {
    expect(splitHtmlAtCol('abc', 0)).toEqual(['', 'abc'])
    expect(splitHtmlAtCol('abc', 9)).toEqual(['abc', ''])
  })

  it('splits cleanly at a span boundary without leaving an empty span', () => {
    // Apt span closes exactly at the cut; right cell opens its own span.
    const line = '<span class="a">L    </span><span class="b">R</span>'
    const [l, r] = splitHtmlAtCol(line, 5)
    expect(l).toBe('<span class="a">L    </span>')
    expect(r).toBe('<span class="b">R</span>')
  })

  it('closes and reopens a span that straddles the cut', () => {
    const [l, r] = splitHtmlAtCol('<span class="c">abcdef</span>', 3)
    expect(l).toBe('<span class="c">abc</span>')
    expect(r).toBe('<span class="c">def</span>')
  })

  it('counts an HTML entity as a single column', () => {
    const [l, r] = splitHtmlAtCol('a&amp;b', 2)
    expect(l).toBe('a&amp;')
    expect(r).toBe('b')
  })

  it('keeps leading spaces on the left and the right cell intact', () => {
    const line = '   <span class="b">R col</span>'
    const [l, r] = splitHtmlAtCol(line, 3)
    expect(l).toBe('   ')
    expect(r).toBe('<span class="b">R col</span>')
  })
})

describe('reflowSkillCrt', () => {
  // A compact stand-in for the real grid: header, two filled rows, an
  // empty-left row (right column longer than left), then help text. Column
  // positions mirror the real layout (right column begins at index 20).
  const L = (s: string): string => `<span class="fg7 bg0">${s}</span>`
  const lines = [
    '  Skill        Apt    Skill        Apt', // header (dup right copy)
    `  ${'a - Fighting    +0'.padEnd(18)}${L('c - Spellcasting +11')}`,
    `  ${'b - Dodging     +1'.padEnd(18)}${L('d - Conjurations +11')}`,
    `  ${''.padEnd(18)}${L('e - Hexes        +11')}`,
    '',
    ' The species aptitude is in white.',
  ]

  it('stacks left-column then right-column skills in a→z order', () => {
    const out = reflowSkillCrt(lines).map(text)
    const skills = out
      .map(t => (/^\s*([a-z]) [+\-*] (\w+)/.exec(t)))
      .filter(Boolean)
      .map(m => `${m![1]}:${m![2]}`)
    expect(skills).toEqual(['a:Fighting', 'b:Dodging', 'c:Spellcasting', 'd:Conjurations', 'e:Hexes'])
  })

  it('keeps a single column header (drops the duplicated right copy)', () => {
    const out = reflowSkillCrt(lines).map(text)
    expect(out[0]).toBe('  Skill        Apt')
  })

  it('re-indents right-column cells to match the left column', () => {
    const out = reflowSkillCrt(lines).map(text)
    const indentOf = (s: string): number => /^( *)/.exec(s)![1].length
    const aRow = out.find(t => /Fighting/.test(t))!
    const cRow = out.find(t => /Spellcasting/.test(t))!
    expect(indentOf(cRow)).toBe(indentOf(aRow))
  })

  it('separates the two column groups with a blank line and a repeated header', () => {
    const out = reflowSkillCrt(lines).map(text)
    const lastLeft = out.findIndex(t => /Dodging/.test(t)) // last left-column skill
    const firstRight = out.findIndex(t => /Spellcasting/.test(t)) // first right-column skill
    expect(firstRight).toBeGreaterThan(lastLeft)
    const between = out.slice(lastLeft + 1, firstRight)
    expect(between).toContain('') // blank separator
    expect(between.some(t => /Skill.*Apt/.test(t))).toBe(true) // repeated header
  })

  it('passes single-spaced help text through unchanged', () => {
    const out = reflowSkillCrt(lines)
    expect(out[out.length - 1]).toBe(' The species aptitude is in white.')
  })

  it('reflows the multi-column help footer to one command per line', () => {
    const input = [
      '  a - Fighting    +0',
      '',
      ' [?] Help                [=] set a skill target',
      ' [/] auto mode    [*] all skills    [!] targets',
    ]
    const out = reflowSkillCrt(input).map(text)
    expect(out).toContain(' [?] Help')
    expect(out).toContain(' [=] set a skill target')
    expect(out).toContain(' [/] auto mode')
    expect(out).toContain(' [*] all skills')
    expect(out).toContain(' [!] targets')
  })

  it('keeps each help command intact, with colours, when split mid-span', () => {
    // The next "[" lives inside the previous command's span — as on the wire.
    const line =
      ' <span class="fg7 bg0">[</span><span class="fg14 bg0">/</span>' +
      '<span class="fg7 bg0">] auto mode    [</span><span class="fg14 bg0">*</span>' +
      '<span class="fg7 bg0">] all</span>'
    const out = reflowSkillCrt([' a - X  +0', '', line])
    const star = out.find(l => /\] all/.test(text(l)))!
    expect(text(star)).toBe(' [*] all')
    expect(star).toContain('<span class="fg14 bg0">*</span>') // key colour preserved
  })

  it('still collapses padding on non-command (prose) help lines', () => {
    const input = ['  a - Fighting    +0', '', ' The cost   is   in   cyan.']
    const out = reflowSkillCrt(input).map(text)
    expect(out).toContain(' The cost is in cyan.')
  })

  it('preserves the lightred manual "+4" inside the left cell, colours intact', () => {
    // Manual fills the fixed-width apt field; the right hotkey stays put.
    const manualLine =
      `  <span class="fg7 bg0">a - Fighting    </span><span class="fg15 bg0">+0</span><span class="fg9 bg0">+4</span> ` +
      `<span class="fg7 bg0">c - Hexes        +11</span>`
    const out = reflowSkillCrt([manualLine])
    // a in the left cell with its manual marker, c in the right cell.
    expect(out.some(l => /a - Fighting/.test(text(l)) && /\+4/.test(text(l)) && l.includes('fg9'))).toBe(true)
    const cCell = out.find(l => /c - Hexes/.test(text(l)))!
    expect(cCell).toContain('<span class="fg7 bg0">c - Hexes')
    // The "+4" must not bleed into the right (c) cell.
    expect(text(cCell)).not.toMatch(/\+4/)
  })

  it('leaves non-skill content untouched', () => {
    const plain = ['Welcome to the dungeon.', '', 'Press any key.']
    expect(reflowSkillCrt(plain)).toEqual(plain)
  })
})
