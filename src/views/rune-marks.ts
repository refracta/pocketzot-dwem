// Rune marks on dolls — the collection at doll fidelity, on every surface a
// doll appears (login shelf, crypt grid, offline slot rows): a fan of the
// most recent runes at the doll's bottom-right (up to FAN_MAX, each a
// half-height sprite overlapping the previous like a hand of cards) with a
// "+N" pip when more were collected, and the Orb as a badge at the top-right
// on wins. Sprites go through rune-sprites.ts (glyph placeholder → sprite).
//
// The marks are an OVERLAY, never part of the doll: the doll element (baked
// <img> or live tile-stack) is wrapped, unchanged, in a positioned box the
// marks sit in — so baked thumbnails, sidecar PNGs and their content keys
// stay pure doll (avatar-bake.ts). The wrapper takes over the placed
// element's role for callers (class, tap target).
import { ORB } from '../game/tiles/rune-tiles'
import type { DollRecipe } from './avatar-tiles'
import { fillRuneCells, runeCell } from './rune-sprites'

export const FAN_MAX = 3

export interface RuneMarksSpec { runes: readonly string[]; won: boolean }

// What an avatar-shaped recipe says about its collection; null when there is
// nothing to mark (the common case — no wrapper is made).
// `won` in the spec means "show the Orb": a finished win, or a live/dead
// character that picked the Orb up (the orb run itself).
export function marksFor(a: { runes?: readonly string[]; orb?: boolean; outcome?: { reason: string } | null } | null | undefined): RuneMarksSpec | null {
  const runes = a?.runes ?? []
  const won = a?.outcome?.reason === 'won' || a?.orb === true
  return runes.length > 0 || won ? { runes, won } : null
}

// `dollScale` is the doll's own render scale; marks are sized relative to it
// (a 64px shelf doll gets 16px sprites, an 80px crypt doll 20px).
export function wrapWithRuneMarks(dollEl: HTMLElement, spec: RuneMarksSpec, dollScale: number, recipe?: DollRecipe | null): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'doll-marked'
  wrap.append(dollEl)
  const marks = document.createElement('span')
  marks.className = 'doll-marks'
  const scale = Math.min(0.75, Math.max(0.45, dollScale / 4))
  const cells: HTMLElement[] = []
  if (spec.won) {
    const orb = runeCell(ORB, scale * 1.25)
    orb.classList.add('doll-mark-orb')
    marks.append(orb)
    cells.push(orb)
  }
  if (spec.runes.length > 0) {
    const fan = document.createElement('span')
    fan.className = 'doll-mark-fan'
    const shown = spec.runes.slice(-FAN_MAX)
    for (const w of shown) {
      const c = runeCell(w, scale)
      fan.append(c)
      cells.push(c)
    }
    if (spec.runes.length > FAN_MAX) {
      const pip = document.createElement('span')
      pip.className = 'doll-mark-pip'
      pip.textContent = `+${spec.runes.length - FAN_MAX}`
      pip.title = `${spec.runes.length} runes`
      fan.append(pip)
    }
    marks.append(fan)
  }
  wrap.append(marks)
  void fillRuneCells(cells, recipe, scale)
  return wrap
}
