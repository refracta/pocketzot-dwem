// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest'
import { MonsterListView } from './monster-list'
import { MapStore } from '../map/map-store'
import { tileLoader } from '../tiles/tile-loader'

// Regression coverage for the cache-key collision in renderTiles. Setup:
// MapStore populated with three monsters that monsterSort splits into three
// groups, two of which share the (att|type|name|clientid) tuple the old key
// formula used. Before the position-indexed rewrite, the second same-key
// group's row.remove() wiped the first one and the DOM ended up with one
// fewer row than expected.
describe('MonsterListView.renderTiles', () => {
  beforeEach(() => {
    // The tile path is gated on tileLoader.configured; configure with dummy
    // strings so the path runs. The sprite painters inside appendTiles /
    // prependDngnLayer no-op gracefully without real atlas loads — we only
    // care about the row-count structure here.
    tileLoader.configure('http://test', '0.34.0')
  })

  it('renders one DOM row per group when same-name groups sort apart', () => {
    const store = new MapStore()
    store.merge([
      // Named monster — own group at top of list, own cache key (clientid).
      { x: 1, y: 1, g: 'C', mon: {
        id: 1, name: 'Lodul', att: 0, type: 5,
        typedata: { avghp: 100 }, clientid: 42,
      } },
      // Two ogres that share name+att+type but sort apart because their
      // typedata.avghp differs. The old (att|type|name|clientid) key
      // collides between them; the new positional cache doesn't.
      { x: 2, y: 2, g: 'O', mon: {
        id: 2, name: 'ogre', att: 0, type: 7,
        typedata: { avghp: 80 },
      } },
      { x: 3, y: 3, g: 'O', mon: {
        id: 3, name: 'ogre', att: 0, type: 7,
        typedata: { avghp: 50 },
      } },
    ])

    const view = new MonsterListView(store)
    // Force tile mode without triggering the early-return short-circuit; the
    // constructor defaults to 'ascii', so setRenderMode('tiles') here is the
    // first mode transition and will run a fresh render.
    view.setRenderMode('tiles')
    view.update(store.getMonsters())

    // The bug we're regressing on: rendering must produce three rows, not
    // two. The exact labels are a stronger assertion than just the count —
    // they'd catch a future regression that produced three rows but with
    // the wrong content (e.g. both ogre slots showing the same monster's
    // damage indicator).
    const rows = view.element.querySelectorAll('.ml-row')
    expect(rows.length).toBe(3)
    const labels = Array.from(view.element.querySelectorAll('.ml-name'))
      .map((el) => el.textContent)
    expect(labels).toEqual(['Lodul', 'ogre', 'ogre'])
  })

  it('combines same-key monsters into one row when they sort equal', () => {
    // Sanity check the inverse case — two ogres with identical fields land in
    // one group of 2 and render as a single "2 ogres" row. Guards against an
    // overzealous fix that would split groups apart.
    const store = new MapStore()
    store.merge([
      { x: 2, y: 2, g: 'O', mon: {
        id: 2, name: 'ogre', plural: 'ogres', att: 0, type: 7,
        typedata: { avghp: 80 },
      } },
      { x: 3, y: 3, g: 'O', mon: {
        id: 3, name: 'ogre', plural: 'ogres', att: 0, type: 7,
        typedata: { avghp: 80 },
      } },
    ])

    const view = new MonsterListView(store)
    view.setRenderMode('tiles')
    view.update(store.getMonsters())

    const rows = view.element.querySelectorAll('.ml-row')
    expect(rows.length).toBe(1)
    const label = view.element.querySelector('.ml-name')?.textContent
    expect(label).toBe('2 ogres')
  })

  it('suppresses the gutter bar on non-hostile clientid monsters', () => {
    // Regression: spectrals / zombies / bound souls all carry a clientid
    // (DCSS uses it as a per-entity sort key, not a uniqueness marker), so
    // `isNamed` alone would paint a bar on every ally row — including a
    // red bar on an allied iron troll zombie whose threat tier is 3 by HD.
    const store = new MapStore()
    store.merge([
      // Friendly named (bound soul) — would have triggered isNamed.
      { x: 1, y: 1, g: '@', mon: {
        id: 1, name: 'Zenata the bound human', att: 4, type: 1,
        typedata: { avghp: 60 }, threat: 2, clientid: 7,
      } },
      // Friendly threat-3 zombie — would have triggered isNasty.
      { x: 2, y: 2, g: 'Z', mon: {
        id: 2, name: 'iron troll zombie', att: 4, type: 2,
        typedata: { avghp: 90 }, threat: 3, clientid: 8,
      } },
      // Hostile threat-3 — control: SHOULD still get a bar.
      { x: 3, y: 3, g: 'L', mon: {
        id: 3, name: 'lich', att: 0, type: 3,
        typedata: { avghp: 80 }, threat: 3, clientid: 9,
      } },
    ])

    const view = new MonsterListView(store)
    view.update(store.getMonsters())
    // monsterSort orders by attitude ASC, so hostile lich comes first,
    // then the friendlies; iron troll zombie outranks Zenata on avghp.
    const rows = Array.from(view.element.querySelectorAll('.ml-row'))
    const labels = rows.map((r) => r.querySelector('.ml-name')?.textContent)
    expect(labels).toEqual(['lich', 'iron troll zombie', 'Zenata the bound human'])
    expect(rows[0].classList.contains('ml-bar')).toBe(true)   // hostile
    expect(rows[1].classList.contains('ml-bar')).toBe(false)  // ally
    expect(rows[2].classList.contains('ml-bar')).toBe(false)  // ally
  })

  it('trims rows when groups shrink between renders', () => {
    // Renders with three groups, then with one, asserts the DOM is trimmed
    // to one row. Catches a regression where the position-indexed array
    // doesn't pop trailing entries.
    const store = new MapStore()
    store.merge([
      { x: 1, y: 1, g: 'C', mon: {
        id: 1, name: 'Lodul', att: 0, type: 5,
        typedata: { avghp: 100 }, clientid: 42,
      } },
      { x: 2, y: 2, g: 'O', mon: {
        id: 2, name: 'ogre', att: 0, type: 7,
        typedata: { avghp: 80 },
      } },
      { x: 3, y: 3, g: 'O', mon: {
        id: 3, name: 'ogre', att: 0, type: 7,
        typedata: { avghp: 50 },
      } },
    ])

    const view = new MonsterListView(store)
    view.setRenderMode('tiles')
    view.update(store.getMonsters())
    expect(view.element.querySelectorAll('.ml-row').length).toBe(3)

    store.merge([
      { x: 2, y: 2, mon: null },
      { x: 3, y: 3, mon: null },
    ])
    view.update(store.getMonsters())
    expect(view.element.querySelectorAll('.ml-row').length).toBe(1)
    expect(view.element.querySelector('.ml-name')?.textContent).toBe('Lodul')
  })
})
