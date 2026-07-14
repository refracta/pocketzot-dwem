// Optional password fallback persistence. Unlike the rotating login cookie in
// session.ts, this stores the user's password and is therefore only written
// when the login screen checkbox is explicitly enabled.

const KEY_PREFIX = 'pocketzot:credentials:'
const SEP = '\x00'

export interface StoredCredentials {
  wsUrl: string
  username: string
  password: string
  savedAtMs: number
}

function storageKey(wsUrl: string, username: string): string {
  return KEY_PREFIX + wsUrl + SEP + username.toLowerCase()
}

export function loadCredentials(wsUrl: string, username: string): StoredCredentials | null {
  const k = storageKey(wsUrl, username)
  const raw = localStorage.getItem(k)
  if (!raw) return null
  try {
    const c = JSON.parse(raw) as Partial<StoredCredentials>
    if (c.wsUrl !== wsUrl || typeof c.username !== 'string' || typeof c.password !== 'string') {
      localStorage.removeItem(k)
      return null
    }
    return {
      wsUrl,
      username: c.username,
      password: c.password,
      savedAtMs: typeof c.savedAtMs === 'number' ? c.savedAtMs : 0,
    }
  } catch {
    localStorage.removeItem(k)
    return null
  }
}

export function saveCredentials(wsUrl: string, username: string, password: string): void {
  const c: StoredCredentials = {
    wsUrl,
    username,
    password,
    savedAtMs: Date.now(),
  }
  localStorage.setItem(storageKey(wsUrl, username), JSON.stringify(c))
}

export function clearCredentials(wsUrl: string, username: string): void {
  localStorage.removeItem(storageKey(wsUrl, username))
}
