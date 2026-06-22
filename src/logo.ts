// Decorated "PocketZot" wordmark for the login screen.
//
// With probability LOGO_CONFIG.pDecorate the flat title morphs — after a short
// delay, so the page never looks broken on load — into a per-character roll of
// DCSS-authentic monster colours and lookalike glyph swaps: other DCSS glyphs
// (clouds, runes, items) that still read as the letter. Each visit is a fresh
// roll, so the wordmark is unique per load. The morph plays once and settles.
//
// Provenance + the full palette (which monster uses each letter, every legit
// colour, and the lookalike-glyph rationale) lives in
//   dev-material/pocketzot-glyph-palette.md   (sourced from DCSS 0.34.1)
// Colour integers are DCSS console colour indices == the CRT `fg0`..`fg15`
// classes in style.css, so a roll of N just sets class `fgN`.

export const LOGO_CONFIG = {
  pDecorate: 0.30,     // probability of decorating at all
  pGlyphShift: 0.20,   // per-character chance of a lookalike glyph swap
  revealDelayMs: 1500, // normal logo holds this long, then morphs
  staggerMs: 150,      // per-character delay across the reveal
}

export const LOGO_WORD = 'PocketZot'

interface GlyphSub {
  ch: string         // the substitute glyph
  cloud?: boolean    // colour from the cloud union (any of PALETTE, like a real cloud)
  colors?: number[]  // else: authentic fg indices for this non-cloud glyph
}
interface Glyph {
  colors: number[]   // DCSS-legit fg indices for the canonical letter
  anyColor?: boolean // P: plants span the whole palette
  subs: GlyphSub[]   // lookalike glyph swaps that still read as the letter
}

// Any of the 15 console colours except darkgrey(8), which is too dim on the dark
// login card. This doubles as the "cloud union": clouds collectively use every
// colour 1-15, and glyph/colour are independent in DCSS (the cloud glyph encodes
// decay, the colour encodes element) — so a cloud glyph may legitimately take any
// of these. See the doc's "Legitimate cloud-element colour palette" section.
const PALETTE = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]

const GLYPHS: Record<string, Glyph> = {
  P: { colors: [2, 5, 6, 7, 10, 11, 12, 13, 14, 15], anyColor: true,
       subs: [{ ch: 'Þ', colors: [7, 14, 4, 10] }] },                 // trunk sphinx (thorn reads as P; ß dropped)
  o: { colors: [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15],
       subs: [{ ch: '○', cloud: true }, { ch: '•', cloud: true }, { ch: '☼', cloud: true },
              { ch: '©', colors: [5, 9] },                            // teleporter (transloc = magenta)
              { ch: 'φ', colors: [14, 10, 11, 13, 12, 15] },          // rune (bright)
              { ch: '¤', colors: [13, 9, 5, 1] },                     // trunk battlesphere (etc_magic)
              { ch: 'ö', colors: PALETTE },                           // trunk orc-apostle (colour_undef → any)
              { ch: '●', colors: [6, 4, 12, 15, 13] }] },             // trunk orb/boulder (filled circle)
  c: { colors: [2, 4, 5, 6, 10, 12, 14],
       subs: [{ ch: '©', colors: [5, 9] }] },                         // teleporter — contains a 'c'
  k: { colors: [1, 6, 7, 10, 12, 13, 15], subs: [] },
  e: { colors: [1, 3, 4, 6, 7, 9, 10, 11, 12, 13, 14, 15],
       subs: [{ ch: 'Σ', colors: [11, 6, 9, 7, 4, 5, 1] }] },         // trunk elemental (angular E)
  t: { colors: [2, 7, 10, 12, 14, 15],
       subs: [{ ch: '†', colors: [6, 4] },                            // corpse
              { ch: '‡', colors: [15, 12, 9, 5, 11] }] },             // trunk turret/cannon (double dagger)
  Z: { colors: [2, 6, 7, 9, 10, 11, 12, 14, 15],
       subs: [{ ch: 'ζ', cloud: true }] },                           // trunk fading-cloud glyph (zeta ↔ Z); § dropped — ζ reads as Z far better
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Pick an fg index: the full cloud/plant palette when `anyPalette`, else from the
// glyph's own authentic list. Keeps the PALETTE-vs-specific choice in one place so
// the "1-15, never 8" invariant holds by construction for both sub and canonical.
function pickFg(anyPalette: boolean | undefined, colors: number[]): number {
  return anyPalette ? pick(PALETTE) : pick(colors)
}

export interface Roll { ch: string; fg: number; swapped: boolean }

// Roll one character: either the canonical letter in a DCSS-legit colour, or a
// lookalike glyph swap. fg is a console colour index (1-15) or -1 if the char
// has no entry. Exported for unit tests; decorateLogo drives the live render.
export function rollLogoChar(letter: string): Roll {
  const g = GLYPHS[letter]
  if (!g) return { ch: letter, fg: -1, swapped: false } // undecorated (no entry)
  if (g.subs.length && Math.random() < LOGO_CONFIG.pGlyphShift) {
    const sub = pick(g.subs)
    return { ch: sub.ch, fg: pickFg(sub.cloud, sub.colors!), swapped: true }
  }
  return { ch: letter, fg: pickFg(g.anyColor, g.colors), swapped: false }
}

function setFg(span: HTMLElement, fg: number): void {
  for (const cls of [...span.classList])
    if (/^fg\d+$/.test(cls)) span.classList.remove(cls)
  span.classList.add(`fg${fg}`)
}

// Apply one fresh roll to a span. `animate` re-triggers the reveal keyframe.
function applyRoll(span: HTMLElement, letter: string, animate: boolean): void {
  const { ch, fg, swapped } = rollLogoChar(letter)
  if (fg < 0) return
  span.textContent = ch
  span.classList.toggle('logo-ch--swap', swapped)
  setFg(span, fg)
  if (animate) {
    span.classList.remove('logo-ch--lit')
    void span.offsetWidth // reflow so the animation restarts
  }
  span.classList.add('logo-ch--lit')
}

// Each decorated title's tap handler, so re-decorating the same element removes
// the stale listener instead of stacking a second one.
const tapHandlers = new WeakMap<HTMLElement, () => void>()

// Build the per-character spans and, behind the pDecorate gate, morph them into a
// DCSS-flavoured roll. Decorates only the literal LOGO_WORD substring, leaving any
// fork chrome before or after it (a custom suffix or build tag) as untouched plain
// text. Tapping the title forces a fresh roll (bypassing the gate and the reveal
// delay — a tap is intent). Idempotent: rebuilds the title's contents each call.
export function decorateLogo(titleEl: HTMLElement): void {
  const full = titleEl.textContent ?? LOGO_WORD
  const at = full.indexOf(LOGO_WORD)
  if (at < 0) return // a fork renamed the title away from LOGO_WORD: leave it alone
  const head = full.slice(0, at)
  const tail = full.slice(at + LOGO_WORD.length)

  const letters = [...LOGO_WORD]
  titleEl.textContent = ''
  if (head) titleEl.appendChild(document.createTextNode(head))
  const spans = letters.map((letter) => {
    const span = document.createElement('span')
    span.className = 'logo-ch'
    span.textContent = letter
    titleEl.appendChild(span)
    return span
  })
  if (tail) titleEl.appendChild(document.createTextNode(tail))

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  // Re-roll every span. `delayMs` defers the whole morph (the on-load "don't look
  // broken" pause); a tap passes 0 for an immediate reveal. Each call first cancels
  // the previous roll's pending timers, so a tap can't be overwritten by an earlier
  // delayed reveal and rapid taps don't pile up. Reduced motion settles instantly,
  // ignoring delayMs and the per-character stagger.
  let timers: number[] = []
  const roll = (delayMs: number): void => {
    timers.forEach(clearTimeout)
    timers = []
    letters.forEach((letter, i) => {
      if (reduceMotion) { applyRoll(spans[i], letter, false); return }
      timers.push(window.setTimeout(() => applyRoll(spans[i], letter, true),
                                    delayMs + i * LOGO_CONFIG.staggerMs))
    })
  }

  // Tap the title to force a fresh roll — always decorates (ignores the gate) and
  // skips the reveal delay. Re-decorating the same element swaps this listener out
  // rather than stacking another; otherwise it's GC'd with the view on teardown.
  titleEl.classList.add('logo-tappable')
  const prevTap = tapHandlers.get(titleEl)
  if (prevTap) titleEl.removeEventListener('click', prevTap)
  const onTap = (): void => roll(0)
  tapHandlers.set(titleEl, onTap)
  titleEl.addEventListener('click', onTap)

  // Initial on-load decoration: gated, and delayed (the delay is a no-op under
  // reduced motion). A plain result can still be woken by tapping.
  if (Math.random() < LOGO_CONFIG.pDecorate) roll(LOGO_CONFIG.revealDelayMs)
}
