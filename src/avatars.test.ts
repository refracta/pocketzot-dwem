import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listAllAvatars, listAvatars, saveAvatar, type Avatar } from './avatars'

// avatars.ts reads the global `localStorage`. This env's built-in one (Node's
// experimental impl, enabled without a valid file) is unusable — and avatars.ts
// swallows storage errors, so it'd silently no-op. Stub a minimal in-memory
// Storage so the persistence behaviour is exercised deterministically.
function makeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
  } as Storage
}

// Recency is insertion order (saveAvatar unshifts), so no clock stubbing is
// needed — ordering is deterministic from call order alone.
beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage())
})
afterEach(() => { vi.unstubAllGlobals() })

// Minimal recipe; the doll content is opaque to the store (it's just persisted).
function rec(over: Partial<Omit<Avatar, 'turn'>> = {}): Omit<Avatar, 'turn'> {
  return {
    wsUrl: 'wss://crawl.dcss.io/socket',
    username: 'tdpma',
    gameId: 'dcss-0.34',
    charName: 'tdpma',
    httpBase: 'https://crawl.dcss.io',
    version: 'hashA',
    doll: [[100, 32]],
    mcache: null,
    ...over,
  }
}

describe('avatars store', () => {
  it('starts empty', () => {
    expect(listAvatars()).toEqual([])
  })

  it('stores and returns a saved avatar', () => {
    saveAvatar(rec())
    const list = listAvatars()
    expect(list).toHaveLength(1)
    expect(list[0].gameId).toBe('dcss-0.34')
    expect(list[0].doll).toEqual([[100, 32]])
  })

  // The reported bug: a 0.34 character and a trunk character must NOT collapse
  // into one slot just because DCSS names both after the account.
  it('keeps different game_ids as separate characters (same account/name)', () => {
    saveAvatar(rec({ gameId: 'dcss-0.34', doll: [[1, 32]] }))
    saveAvatar(rec({ gameId: 'dcss-git', doll: [[2, 32]] }))
    const list = listAvatars()
    expect(list).toHaveLength(2)
    expect(new Set(list.map((a) => a.gameId))).toEqual(new Set(['dcss-0.34', 'dcss-git']))
  })

  // Same character continuing (gear change, post-rebuild replay) — the turn count
  // holds or advances, so it upserts in place, no dup.
  it('upserts the same character as its turn advances', () => {
    saveAvatar(rec({ doll: [[1, 32]], version: 'hashA' }), { turn: 100 })
    saveAvatar(rec({ doll: [[2, 18]], version: 'hashB' }), { turn: 250 }) // same char, later turn + rebuilt version
    const list = listAllAvatars()
    expect(list).toHaveLength(1)
    expect(list[0].doll).toEqual([[2, 18]])
    expect(list[0].version).toBe('hashB') // atlas URL refreshed on replay
  })

  // The new-character path: a reroll resets the turn counter below the slot's
  // current entry, so it appends rather than overwriting — the fallen char is kept.
  it('appends a reroll (turn reset) as a new entry in the same slot', () => {
    saveAvatar(rec({ doll: [[1, 32]] }), { turn: 500 }) // character A, well into a game
    saveAvatar(rec({ doll: [[2, 32]] }), { turn: 0 })   // A died, B starts at turn 0
    const list = listAllAvatars()
    expect(list).toHaveLength(2)
    expect(list.map((a) => a.doll)).toEqual([[[2, 32]], [[1, 32]]]) // B newest, A kept
  })

  // After a reroll, resuming the slot must upsert the *replacement* (the slot's
  // current/most-recent entry) as its turn advances — not the fallen character.
  it('resume after a reroll upserts the replacement, leaving the fallen one', () => {
    saveAvatar(rec({ doll: [[1, 32]] }), { turn: 500 }) // character A
    saveAvatar(rec({ doll: [[2, 32]] }), { turn: 0 })   // B starts
    saveAvatar(rec({ doll: [[2, 18]] }), { turn: 40 })  // B changes gear later in its life
    const list = listAllAvatars()
    expect(list).toHaveLength(2)
    expect(list.map((a) => a.doll)).toEqual([[[2, 18]], [[1, 32]]]) // B updated, A untouched
  })

  // Without turn info (e.g. a capture before the turn count is known) it can't tell
  // a reroll from the same character, so it upserts — degrading to one-per-slot
  // rather than risking a bogus duplicate.
  it('upserts when turn is unknown on both sides', () => {
    saveAvatar(rec({ doll: [[1, 32]] }))
    saveAvatar(rec({ doll: [[2, 32]] }))
    expect(listAllAvatars()).toHaveLength(1)
    expect(listAllAvatars()[0].doll).toEqual([[2, 32]])
  })

  it('separates by server and by account', () => {
    saveAvatar(rec())
    saveAvatar(rec({ wsUrl: 'wss://crawl.akrasiac.org:8443/socket' }))
    saveAvatar(rec({ username: 'someone-else' }))
    expect(listAllAvatars()).toHaveLength(3)
  })

  // The login row shows only the newest 4; the history retains more behind it.
  // (Distinct slots, so each is its own first entry → appends.)
  it('shows 4 on the row but retains the deeper history', () => {
    for (let i = 0; i < 6; i++) {
      saveAvatar(rec({ gameId: `dcss-g${i}`, doll: [[i, 32]] }))
    }
    expect(listAvatars()).toHaveLength(4)        // visible row
    expect(listAllAvatars()).toHaveLength(6)     // full history
    expect(listAvatars().map((a) => a.doll)).toEqual([[[5, 32]], [[4, 32]], [[3, 32]], [[2, 32]]])
  })

  it('caps the history at 20, evicting the oldest', () => {
    for (let i = 0; i < 21; i++) {
      saveAvatar(rec({ gameId: `dcss-g${i}`, doll: [[i, 32]] }))
    }
    const dolls = listAllAvatars().map((a) => a.doll)
    expect(dolls).toHaveLength(20)
    expect(dolls[0]).toEqual([[20, 32]])  // newest kept
    expect(dolls).not.toContainEqual([[0, 32]]) // oldest rolled off
  })

  it('orders newest-first (strip paints in order → newest at left)', () => {
    saveAvatar(rec({ gameId: 'dcss-0.31' }))
    saveAvatar(rec({ gameId: 'dcss-0.32' }))
    saveAvatar(rec({ gameId: 'dcss-0.33' }))
    expect(listAvatars().map((a) => a.gameId)).toEqual(['dcss-0.33', 'dcss-0.32', 'dcss-0.31'])
  })

  it('bumps a re-saved character to most-recent', () => {
    saveAvatar(rec({ gameId: 'dcss-0.31' }))
    saveAvatar(rec({ gameId: 'dcss-0.32' }))
    saveAvatar(rec({ gameId: 'dcss-0.31' })) // touch the older one again
    expect(listAvatars().map((a) => a.gameId)).toEqual(['dcss-0.31', 'dcss-0.32'])
  })
})
