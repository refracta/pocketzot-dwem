import type { ClientMsg, ServerMsg } from '../ws/types'
import { saveSession } from './session'

export interface PasswordLoginConn {
  send(msg: ClientMsg): void
  onMessage: (msg: ServerMsg) => void
  onLoginCookie: (cookie: string, expiresDays: number) => void
}

export interface PasswordLoginRequest {
  wsUrl: string
  username: string
  password: string
}

export interface PasswordLoginCallbacks {
  onSuccess: (username: string, flush: () => void) => void
  onFail: (message: string) => void
}

export function passwordLogin(conn: PasswordLoginConn, req: PasswordLoginRequest, cb: PasswordLoginCallbacks): void {
  const buffered: ServerMsg[] = []
  const flush = (): void => {
    if (conn.onMessage === pump) return
    for (let i = 0; i < buffered.length; i++) conn.onMessage(buffered[i]!)
    buffered.length = 0
  }
  const pump = (msg: ServerMsg): void => {
    if (msg.msg === 'login_success') {
      conn.onLoginCookie = (cookie, days) => saveSession(req.wsUrl, msg.username, cookie, days)
      conn.send({ msg: 'set_login_cookie' })
      cb.onSuccess(msg.username, flush)
    } else if (msg.msg === 'login_fail') {
      cb.onFail(msg.message || 'Login failed.')
    } else {
      buffered.push(msg)
    }
  }
  conn.onMessage = pump
  conn.send({ msg: 'login', username: req.username, password: req.password })
}
