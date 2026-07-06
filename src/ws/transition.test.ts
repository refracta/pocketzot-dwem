import { describe, it, expect } from 'vitest'
import { classifyTransition, isPreGameState } from './transition'
import type { ServerMsg } from './types'

describe('classifyTransition', () => {
  it.each<[ServerMsg, ReturnType<typeof classifyTransition>]>([
    [{ msg: 'game_client', version: '0.34', content: '' }, { type: 'capture-loader', version: '0.34' }],
    [{ msg: 'game_started' }, { type: 'game' }],
    [{ msg: 'watching_started', username: 'bob' }, { type: 'game', spectating: { username: 'bob' } }],
    [{ msg: 'layer', layer: 'game' }, { type: 'game' }],
    [{ msg: 'layer', layer: 'crt' }, { type: 'game' }],
    [{ msg: 'layer', layer: 'lobby' as 'game' }, null],
    [{ msg: 'map', cells: [] }, null],
  ])('%j', (msg, expected) => {
    expect(classifyTransition(msg)).toEqual(expected)
  })
})

describe('isPreGameState', () => {
  // The chat/watcher messages a spectate join delivers *before*
  // watching_started (CDI order, captured live: game_client →
  // update_spectators → watching_started). Lobby and resume must buffer
  // these for the game view; everything else is not theirs to hold.
  it.each<[ServerMsg, boolean]>([
    [{ msg: 'chat', content: 'x' }, true],
    [{ msg: 'update_spectators', count: 1, names: '' }, true],
    [{ msg: 'super_hide_chat' }, true],
    [{ msg: 'map', cells: [] }, false],
    [{ msg: 'game_started' }, false],
    [{ msg: 'lobby_complete' }, false],
  ])('%j', (msg, expected) => {
    expect(isPreGameState(msg)).toBe(expected)
  })
})
