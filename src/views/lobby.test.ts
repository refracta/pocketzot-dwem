// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { buildLobbyView } from './lobby'
import type { WsConnection } from '../ws/connection'
import type { ServerMsg } from '../ws/types'
import { getTileLoader } from '../game/tiles/tile-loader'

// Regression coverage for the tile loader hand-off across the lobby→game
// boundary. `game_client` (which carries the gamedata version) can arrive while
// the lobby is still the active message handler — always before
// `watching_started`, and before `game_started` on servers like CPO that send
// it ahead of the game-start signal. The lobby resolves the per-version loader
// then, and the server never resends the version once the game view mounts, so
// the lobby MUST forward what it captured on *every* transition path. A prior
// regression forwarded it only on the spectate path (`watching_started`),
// leaving played games on CPO-ordered servers stuck in ASCII because their
// loader was silently dropped.

// `buildLobbyView` derives the http base as
// wsUrl.replace(/^ws/,'http').replace(/\/socket\/?$/,''), so this maps to
// 'https://test.example'. getTileLoader memoizes by `${base}/gamedata/${ver}`,
// so calling it in the test returns the very instance the lobby created.
const WS_URL = 'wss://test.example/socket'
const HTTP_BASE = 'https://test.example'

function setupLobby(): {
  onGameStart: ReturnType<typeof vi.fn>
  dispatch: (msg: ServerMsg) => void
} {
  const conn = {
    wsUrl: WS_URL,
    httpBase: HTTP_BASE,
    onMessage: (() => {}) as (msg: ServerMsg) => void,
    onClose: () => {},
    onOpen: () => {},
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WsConnection
  const onGameStart = vi.fn()
  const onDisconnect = vi.fn()
  // buildLobbyView assigns conn.onMessage = its internal handler.
  buildLobbyView(conn, 'tester', false, onGameStart, onDisconnect)
  return { onGameStart, dispatch: (msg) => conn.onMessage(msg) }
}

describe('lobby tile-loader hand-off', () => {
  it('forwards the captured loader to a played game on game_started', () => {
    const { onGameStart, dispatch } = setupLobby()
    const VERSION = 'play-version'
    dispatch({ msg: 'game_client', version: VERSION, content: '' })
    dispatch({ msg: 'game_started' })

    const expected = getTileLoader(HTTP_BASE, VERSION)
    expect(onGameStart).toHaveBeenCalledTimes(1)
    const [spectating, loader] = onGameStart.mock.calls[0]
    expect(spectating).toBeUndefined() // not a spectated game
    expect(loader).toBe(expected) // same instance, not a fresh one
  })

  it('forwards the captured loader (and spectator identity) on watching_started', () => {
    const { onGameStart, dispatch } = setupLobby()
    const VERSION = 'watch-version'
    dispatch({ msg: 'game_client', version: VERSION, content: '' })
    dispatch({ msg: 'watching_started', username: 'bob' })

    const expected = getTileLoader(HTTP_BASE, VERSION)
    const [spectating, loader] = onGameStart.mock.calls[0]
    expect(spectating).toEqual({ username: 'bob' })
    expect(loader).toBe(expected)
  })

  it('forwards the captured loader on a set_layer:game transition', () => {
    const { onGameStart, dispatch } = setupLobby()
    const VERSION = 'layer-version'
    dispatch({ msg: 'game_client', version: VERSION, content: '' })
    dispatch({ msg: 'set_layer', layer: 'game' })

    const expected = getTileLoader(HTTP_BASE, VERSION)
    const [spectating, loader] = onGameStart.mock.calls[0]
    expect(spectating).toBeUndefined()
    expect(loader).toBe(expected)
  })

  it('forwards undefined when game_client has not arrived yet', () => {
    // CDI-ordered servers send game_client *after* game_started, so the lobby
    // has nothing to hand off; the game view resolves the loader itself from
    // the game_client it receives post-mount. The contract is "forward what was
    // captured" — undefined here, not a stale or fabricated loader.
    const { onGameStart, dispatch } = setupLobby()
    dispatch({ msg: 'game_started' })

    const [spectating, loader] = onGameStart.mock.calls[0]
    expect(spectating).toBeUndefined()
    expect(loader).toBeUndefined()
  })
})
