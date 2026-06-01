import { SPECTATE_SERVERS } from './servers'

const KEY = 'pocketzot:prefs'

export interface Prefs {
  lastGuestSpectateWsUrl: string | null
  monsterListCollapsed: boolean
  mapRenderMode: 'ascii' | 'tiles'
}

const DEFAULTS: Prefs = {
  lastGuestSpectateWsUrl: null,
  monsterListCollapsed: false,
  mapRenderMode: 'tiles',
}

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function getPref<K extends keyof Prefs>(k: K): Prefs[K] {
  return load()[k]
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  const next = { ...load(), [k]: v }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}

export function getLastSpectateServer(): string | null {
  const v = getPref('lastGuestSpectateWsUrl')
  return v && SPECTATE_SERVERS.some(s => s.wsUrl === v) ? v : null
}

export function setLastSpectateServer(wsUrl: string): void {
  setPref('lastGuestSpectateWsUrl', wsUrl)
}
