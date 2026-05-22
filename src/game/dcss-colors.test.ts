import { describe, it, expect } from 'vitest'
import { dcssToHtml, escHtml, uiColor, DCSS_UI_COLOR } from './dcss-colors'

describe('escHtml', () => {
  it('escapes &, <, > in that order so & is not double-encoded', () => {
    expect(escHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
    expect(escHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('uiColor', () => {
  it('returns palette entry for valid index', () => {
    expect(uiColor(0)).toBe(DCSS_UI_COLOR[0])
    expect(uiColor(7)).toBe(DCSS_UI_COLOR[7])  // lightgrey
    expect(uiColor(15)).toBe(DCSS_UI_COLOR[15])
  })

  it('masks index to 4 bits', () => {
    expect(uiColor(16)).toBe(DCSS_UI_COLOR[0])
    expect(uiColor(23)).toBe(DCSS_UI_COLOR[7])
  })
})

describe('dcssToHtml', () => {
  it('returns escaped plain text unchanged when no tags', () => {
    expect(dcssToHtml('hello world')).toBe('hello world')
    expect(dcssToHtml('a < b')).toBe('a &lt; b')
  })

  it('wraps tagged text in a styled span', () => {
    expect(dcssToHtml('<red>danger</red>'))
      .toBe('<span style="color:#b30009">danger</span>')
  })

  it('closes spans on </tag>', () => {
    const html = dcssToHtml('<red>x</red>y')
    expect(html).toBe('<span style="color:#b30009">x</span>y')
  })

  it('nests colors and restores outer color on close', () => {
    // outer red, inner blue, then back to red
    const html = dcssToHtml('<red>a<blue>b</blue>c</red>')
    expect(html).toBe(
      '<span style="color:#b30009">a</span>' +
      '<span style="color:#005afa">b</span>' +
      '<span style="color:#b30009">c</span>'
    )
  })

  it('treats unpaired close at empty stack as no-op', () => {
    expect(dcssToHtml('</red>plain')).toBe('plain')
  })

  it('closes unterminated spans — prevents nested-span accumulation in msg log', () => {
    // Regression guard. DCSS uses an open-only <color> markup where many
    // server strings omit the closing tag. Without the safeguard at end of
    // dcssToHtml, every such line emits a `<span ...>text` with no close;
    // appending hundreds of those into the message log nests them, growing
    // the DOM unboundedly and tanking render perf. The function MUST emit
    // self-contained, balanced HTML even when the input has an open tag.
    expect(dcssToHtml('<red>unterminated'))
      .toBe('<span style="color:#b30009">unterminated</span>')
  })

  it('separate calls do not leak open spans across boundaries', () => {
    // Companion to the regression test above: each call's output must be
    // independently balanced, so concatenating results (or appending them
    // as sibling nodes) never produces a span that wraps the next call.
    const a = dcssToHtml('<red>a')
    const b = dcssToHtml('<blue>b')
    expect(a).toBe('<span style="color:#b30009">a</span>')
    expect(b).toBe('<span style="color:#005afa">b</span>')
    // Concatenated output has exactly two spans, both closed — no nesting.
    expect((a + b).match(/<span/g)?.length).toBe(2)
    expect((a + b).match(/<\/span>/g)?.length).toBe(2)
  })

  it('drops unknown color tags (keeps text)', () => {
    expect(dcssToHtml('<bogus>x</bogus>')).toBe('x')
  })

  it('greedy split: raw < inside payload is consumed as a pseudo-tag', () => {
    // Documents a parser limitation: the splitter regex /(<[^>]+>)/ matches
    // "< b></red>" as one token, so payload that contains a literal '<'
    // breaks the surrounding markup. Server messages don't normally include
    // raw '<' — escape upstream if you ever need to feed user text in.
    expect(dcssToHtml('<red>a < b</red>'))
      .toBe('<span style="color:#b30009">a </span>')
  })

  it('handles <w> alias as a white highlight', () => {
    expect(dcssToHtml('<w>K</w>'))
      .toBe('<span style="color:#eeeeec">K</span>')
  })
})
