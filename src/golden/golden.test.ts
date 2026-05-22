// Golden-fixture replay tests. Each *.golden.json file holds a recorded
// sequence of server messages plus the expected store state after replay.
// Real captures break loud on any upstream wire-format change — that's
// their job. Unit tests verify internal logic against our constants;
// these verify our decode still produces sensible state from real bytes.
//
// See CAPTURING.md (next to this file) for how to record new fixtures.

import { describe, it, expect } from 'vitest'
import { MapStore } from '../game/map/map-store'
import type { ServerMsg } from '../ws/types'

interface CellSample {
  x: number
  y: number
  g?: string
  col?: number
}

interface GoldenFixture {
  description: string
  captured_from: string
  // When true, the runner prints the actual store state after replay so you
  // can copy the values back into `expected`. Use this when authoring a new
  // fixture: set `dump: true` + `expected: {}`, run `npm test -- --reporter=verbose`,
  // copy the printed values into `expected`, then remove the flag.
  dump?: boolean
  messages: ServerMsg[]
  expected: {
    playerPos?: { x: number; y: number }
    cellSamples?: CellSample[]
    cellCount?: number
    monsterCount?: number
    monsterNames?: string[]
  }
}

// Vite/Vitest evaluates this glob at build time; each matched JSON file
// becomes a value in the returned record (key = relative path, value =
// the file's default export).
const fixtures = import.meta.glob<GoldenFixture>('./*.golden.json', {
  eager: true,
  import: 'default',
})

// Replays a server-message sequence against a fresh MapStore. Only the
// few msg types that drive map/player state are handled — everything
// else is intentionally ignored so captures from a live session
// (which include msgs, ui-push, layer, etc.) work without filtering.
function replay(messages: ServerMsg[]): MapStore {
  const store = new MapStore()
  for (const m of messages) {
    if (m.msg === 'player' && 'pos' in m && m.pos) {
      store.playerPos = m.pos
    } else if (m.msg === 'map') {
      if (m.clear) store.clear()
      store.merge(m.cells)
    }
  }
  return store
}

describe('golden replays', () => {
  const entries = Object.entries(fixtures)
  if (entries.length === 0) {
    it.skip('no fixtures found', () => {})
    return
  }

  for (const [path, fx] of entries) {
    const name = path.replace(/^\.\//, '')
    it(`${name} — ${fx.description}`, () => {
      const store = replay(fx.messages)
      const { expected } = fx

      if (fx.dump) {
        // eslint-disable-next-line no-console
        console.log(`\n[dump ${name}]`, JSON.stringify({
          playerPos: store.playerPos,
          cellCount: store.size,
          monsterCount: store.getMonsters().size,
          monsterNames: Array.from(store.getMonsters().values())
            .map(m => m.mon.name ?? '<unnamed>'),
          // First few cells (sorted) as starter samples
          cellSamples: Array.from(store.getMonsters().values())
            .slice(0, 3)
            .map(m => ({ x: m.x, y: m.y, g: m.g, col: m.col })),
        }, null, 2))
      }

      if (expected.playerPos) {
        expect(store.playerPos, 'playerPos').toEqual(expected.playerPos)
      }

      if (expected.cellCount !== undefined) {
        expect(store.size, 'cell count').toBe(expected.cellCount)
      }

      if (expected.cellSamples) {
        for (const s of expected.cellSamples) {
          const cell = store.get(s.x, s.y)
          expect(cell, `cell at (${s.x},${s.y}) should exist`).toBeDefined()
          if (s.g !== undefined) {
            expect(cell?.g, `glyph at (${s.x},${s.y})`).toBe(s.g)
          }
          if (s.col !== undefined) {
            expect(cell?.col, `col at (${s.x},${s.y})`).toBe(s.col)
          }
        }
      }

      if (expected.monsterCount !== undefined) {
        expect(store.getMonsters().size, 'monster count').toBe(expected.monsterCount)
      }

      if (expected.monsterNames) {
        const names = Array.from(store.getMonsters().values())
          .map(m => m.mon.name ?? '<unnamed>')
          .sort()
        expect(names).toEqual([...expected.monsterNames].sort())
      }
    })
  }
})
