// Per-server login-cookie persistence. The DCSS WebTiles server issues a
// rotating session token via {msg:"login_cookie", cookie, expires} after a
// successful password login (when the client asks for one with
// {msg:"set_login_cookie"}). The token can later be exchanged for a session
// with {msg:"token_login", cookie}, avoiding a password prompt.
//
// Sessions are keyed by (wsUrl, username) so multiple accounts on the same
// server can be stored side-by-side. The delimiter is a NUL byte, which can
// appear in neither URLs nor DCSS usernames.

const KEY_PREFIX = 'pocketzot:login:'
const SEP = '\x00'

export interface StoredSession {
  wsUrl: string
  username: string
  cookie: string
  expiresAtMs: number
}

function storageKey(wsUrl: string, username: string): string {
  return KEY_PREFIX + wsUrl + SEP + username.toLowerCase()
}

export function loadSession(wsUrl: string, username: string): StoredSession | null {
  const k = storageKey(wsUrl, username)
  const raw = localStorage.getItem(k)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as StoredSession
    if (s.expiresAtMs <= Date.now()) {
      localStorage.removeItem(k)
      return null
    }
    return s
  } catch {
    localStorage.removeItem(k)
    return null
  }
}

export function saveSession(wsUrl: string, username: string, cookie: string, expiresDays: number): void {
  const s: StoredSession = {
    wsUrl,
    username,
    cookie,
    expiresAtMs: Date.now() + expiresDays * 86400_000,
  }
  localStorage.setItem(storageKey(wsUrl, username), JSON.stringify(s))
}

export function clearSession(wsUrl: string, username: string): void {
  localStorage.removeItem(storageKey(wsUrl, username))
}

export function listSessions(): StoredSession[] {
  const out: StoredSession[] = []
  const stale: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(KEY_PREFIX)) continue
    const raw = localStorage.getItem(k)
    if (!raw) continue
    try {
      const s = JSON.parse(raw) as StoredSession
      if (s.expiresAtMs > Date.now()) out.push(s)
      else stale.push(k)
    } catch { stale.push(k) }
  }
  for (const k of stale) localStorage.removeItem(k)
  return out
}
