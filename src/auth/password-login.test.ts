// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../test/fake-storage'
import type { ClientMsg, ServerMsg } from '../ws/types'
import { loadSession } from './session'
import { passwordLogin, type PasswordLoginConn } from './password-login'

vi.stubGlobal('localStorage', fakeStorage())
vi.stubGlobal('sessionStorage', fakeStorage())

const WS_URL = 'wss://test.example/socket'
const USER = 'tester'

function fakeConn(): { conn: PasswordLoginConn; sent: ClientMsg[]; feed: (m: ServerMsg) => void } {
  const sent: ClientMsg[] = []
  const conn: PasswordLoginConn = {
    send: (m) => { sent.push(m) },
    onMessage: () => {},
    onLoginCookie: () => {},
  }
  return { conn, sent, feed: (m) => conn.onMessage(m) }
}

afterEach(() => {
  localStorage.clear()
})

describe('passwordLogin', () => {
  it('logs in with username/password and requests a rotating token', () => {
    const { conn, sent, feed } = fakeConn()
    const successes: string[] = []
    passwordLogin(conn, { wsUrl: WS_URL, username: USER, password: 'pw' }, {
      onSuccess: (username) => successes.push(username),
      onFail: () => { throw new Error('unexpected') },
    })

    expect(sent).toEqual([{ msg: 'login', username: USER, password: 'pw' }])
    feed({ msg: 'login_success', username: 'Tester' })
    expect(sent.at(-1)).toEqual({ msg: 'set_login_cookie' })
    expect(successes).toEqual(['Tester'])
  })

  it('persists the rotating token under the canonical username', () => {
    const { conn, feed } = fakeConn()
    passwordLogin(conn, { wsUrl: WS_URL, username: USER, password: 'pw' }, {
      onSuccess: () => {},
      onFail: () => { throw new Error('unexpected') },
    })

    feed({ msg: 'login_success', username: 'Tester' })
    conn.onLoginCookie('cookie-2', 7)
    expect(loadSession(WS_URL, 'Tester')?.cookie).toBe('cookie-2')
  })

  it('buffers pre-login messages until the destination handler is installed', () => {
    const { conn, feed } = fakeConn()
    let flushFn: (() => void) | null = null
    passwordLogin(conn, { wsUrl: WS_URL, username: USER, password: 'pw' }, {
      onSuccess: (_username, flush) => { flushFn = flush },
      onFail: () => { throw new Error('unexpected') },
    })

    feed({ msg: 'lobby_complete' })
    feed({ msg: 'login_success', username: USER })
    flushFn!()
    const seen: ServerMsg[] = []
    conn.onMessage = (m) => seen.push(m)
    flushFn!()
    expect(seen.map(m => m.msg)).toEqual(['lobby_complete'])
  })

  it('reports login failures', () => {
    const { conn, feed } = fakeConn()
    let failure = ''
    passwordLogin(conn, { wsUrl: WS_URL, username: USER, password: 'pw' }, {
      onSuccess: () => { throw new Error('unexpected') },
      onFail: (message) => { failure = message },
    })

    feed({ msg: 'login_fail', message: 'bad password' })
    expect(failure).toBe('bad password')
  })
})
