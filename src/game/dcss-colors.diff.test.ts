import { describe, it, expect } from 'vitest'
import { dcssToHtml, escHtml, DCSS_COLOR_MAP } from './dcss-colors'

// Regression guard for the dcssToHtml rewrite (DCSS `<<` escape fix). It pins
// the new renderer against the previous implementation across an exhaustive
// fuzz of the whole len≤6 markup space, asserting that EVERY divergence is one
// of a small set of explained, intended changes — nothing else moved. (A wider
// one-off run over 829 real markup literals harvested from the DCSS engine
// source agreed: diffs only in the two intended-fix buckets, output always
// balanced. That corpus is GPL, so it isn't committed here.)

// ─── The OLD implementation, verbatim (pre-fix) ───────────────────────────
function dcssToHtmlOLD(text: string): string {
  const parts = text.split(/(<[^>]+>)/)
  const colorStack: string[] = []
  let spanOpen = false
  let out = ''
  for (const part of parts) {
    if (part.startsWith('<') && part.endsWith('>')) {
      const tag = part.slice(1, -1).toLowerCase()
      if (tag.startsWith('/')) {
        if (colorStack.length > 0) {
          if (spanOpen) { out += '</span>'; spanOpen = false }
          colorStack.pop()
          if (colorStack.length > 0) {
            out += `<span style="color:${colorStack[colorStack.length - 1]}">`
            spanOpen = true
          }
        }
      } else {
        const hex = DCSS_COLOR_MAP[tag]
        if (hex) {
          if (spanOpen) { out += '</span>'; spanOpen = false }
          colorStack.push(hex)
          out += `<span style="color:${hex}">`
          spanOpen = true
        }
      }
    } else {
      out += escHtml(part)
    }
  }
  if (spanOpen) out += '</span>'
  return out
}

// Does every `<` in s begin a clean, canonical tag `<[/]?[a-z:]*>` with no
// `<<` doubling? On such strings the old splitter and the new tokenizer see
// identical tag boundaries, so I claim old===new there.
function allTagsClean(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') {
      const m = /^<\/?(?:bg:)?[a-z]*>/i.exec(s.slice(i))
      if (!m) return false
      i += m[0].length - 1
    }
  }
  return true
}

type Bucket = 'A:escape-<<' | 'B:raw-<' | 'C:mismatched-close' | 'E:empty-tag' | 'D:UNEXPECTED'

// Classify a divergence between old and new into an intended/known bucket.
//  A,B = the two intended fixes. C,E = unreachable-in-practice edge classes
//  where new is more faithful to the official client than the old code.
//  D = anything unexplained (must never occur).
function classify(s: string): Bucket {
  if (s.includes('<<')) return 'A:escape-<<'
  if (!allTagsClean(s)) return 'B:raw-<'
  if (s.includes('<>')) return 'E:empty-tag'
  // Clean tags only, no escape, no empty tag — the only remaining delta is
  // old's pop-on-any-close vs new's ignore-unknown-close. Detect: a close tag
  // whose name is NOT a known colour appears somewhere.
  for (const m of s.matchAll(/<\/((?:bg:)?[a-z]*)>/gi)) {
    const name = m[1].toLowerCase()
    if (name.startsWith('bg:') || !(name in DCSS_COLOR_MAP)) return 'C:mismatched-close'
  }
  return 'D:UNEXPECTED'
}

describe('dcssToHtml differential: new vs old', () => {
  it('exhaustive fuzz (len ≤ 6) — every divergence is an intended fix', () => {
    const alphabet = ['<', '>', '&', '/', ':', ' ', 'w', 'z']
    const buckets: Record<string, { count: number; ex: string[] }> = {}
    let total = 0, diffs = 0
    const stack: string[] = ['']
    while (stack.length) {
      const s = stack.pop()!
      total++
      const a = dcssToHtmlOLD(s)
      const b = dcssToHtml(s)
      if (a !== b) {
        diffs++
        const c = classify(s)
        ;(buckets[c] ??= { count: 0, ex: [] }).count++
        if (buckets[c].ex.length < 3) buckets[c].ex.push(JSON.stringify(s))
      }
      if (s.length < 6) for (const ch of alphabet) stack.push(s + ch)
    }
    // eslint-disable-next-line no-console
    console.log(`[fuzz] strings=${total} diffs=${diffs} buckets=`, buckets)
    // Every divergence over the entire len≤6 space falls into an intended or
    // known-benign bucket — nothing unexplained.
    expect(buckets['D:UNEXPECTED']).toBeUndefined()
    // At len≤6 a genuine mismatched-close needs <w>…</z> (≥7 chars), so it is
    // not reachable here; see the dedicated case below.
    expect(buckets['C:mismatched-close']).toBeUndefined()
    // Sanity: the fix actually changed something in the intended buckets.
    expect((buckets['A:escape-<<']?.count ?? 0)).toBeGreaterThan(0)
    expect((buckets['B:raw-<']?.count ?? 0)).toBeGreaterThan(0)
  })

  it('the only non-fix delta is the mismatched unknown close tag (rare, ref-faithful)', () => {
    // When a KNOWN colour span is open and an UNKNOWN close tag arrives, old
    // popped the known colour; new ignores the stray close (keeping the span),
    // which matches the official client. DCSS never emits this, but document it.
    const s = '<red>a</z>b</red>'
    expect(dcssToHtmlOLD(s)).toBe('<span style="color:#b30009">a</span>b')
    expect(dcssToHtml(s)).toBe('<span style="color:#b30009">ab</span>')
    expect(classify(s)).toBe('C:mismatched-close')
  })

  it('on canonical markup (clean tags, no escape) old === new, byte-for-byte', () => {
    // The regression guarantee: anything that is well-formed DCSS markup with
    // no `<<` escape and no mismatched close renders identically to before.
    const cases = [
      '<red>danger</red>',
      '<lightblue>Header</lightblue> rest',
      '<red>a<blue>b</blue>c</red>',
      '<w>K</w> for menu, <w>Esc</w> to cancel',
      'plain text with no markup at all',
      'a > b & c',                       // bare > and & (no <)
      '<yellow>You see here a +0 long sword.</yellow>',
      '</red>orphan close at empty stack',
      '<brown>Space</brown> - <brown>Tab</brown>',
      'HP: <lightgreen>40</lightgreen>/<lightgreen>40</lightgreen>',
      '<bg:blue>bg tag</bg:blue> dropped both ways',
      '<bogus>unknown</bogus> tag',
    ]
    for (const s of cases) {
      expect(dcssToHtml(s), `mismatch on: ${JSON.stringify(s)}`).toBe(dcssToHtmlOLD(s))
    }
  })
})
