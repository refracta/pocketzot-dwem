import { describe, it, expect } from 'vitest'
import { classifyTransition } from './transition'
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
