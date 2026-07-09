import { SPECTATE_SERVERS } from './servers'

const KEY = 'pocketzot:prefs'

// Live-apply events, fired (on window) by setPref itself whenever the named
// pref actually changes — writers never dispatch by hand. Mirrors
// CONTROLS_CHANGED_EVENT in control-sets.ts.

// Lets a live game view swap renderers immediately when the settings page
// (or the two-finger gesture) changes mapRenderMode.
export const RENDER_MODE_CHANGED_EVENT = 'pocketzot:render-mode-changed'

const PREF_EVENTS: Partial<Record<keyof Prefs, string>> = {
  mapRenderMode: RENDER_MODE_CHANGED_EVENT,
}

export interface Prefs {
  lastGuestSpectateWsUrl: string | null
  monsterListCollapsed: boolean
  mapRenderMode: 'ascii' | 'tiles'
  controlSetId: string
}

const DEFAULTS: Prefs = {
  lastGuestSpectateWsUrl: null,
  monsterListCollapsed: false,
  mapRenderMode: 'ascii',
  controlSetId: 'standard',
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
  const prefs = load()
  if (JSON.stringify(prefs[k]) === JSON.stringify(v)) return  // no-op: no write, no event
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, [k]: v }))
  } catch {}
  const event = PREF_EVENTS[k]
  if (event) window.dispatchEvent(new Event(event))
}

export function getLastSpectateServer(): string | null {
  const v = getPref('lastGuestSpectateWsUrl')
  return v && SPECTATE_SERVERS.some(s => s.wsUrl === v) ? v : null
}

export function setLastSpectateServer(wsUrl: string): void {
  setPref('lastGuestSpectateWsUrl', wsUrl)
}
