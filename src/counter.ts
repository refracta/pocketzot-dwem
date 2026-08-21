// Anonymous usage events, one per type per page load, posted to the app's
// own origin. No identifiers, no payload beyond the event name. Design
// notes in dev-material.
export type CountedEvent = 'boot' | 'play' | 'spectate' | 'play-offline'
export interface CountFlags { ascii?: boolean }

const sent = new Set<CountedEvent>()

export function count(event: CountedEvent, flags: CountFlags = {}): void {
  // The endpoint is supplied by the root-hosted deployment. Static subpath
  // builds (such as GitHub Pages) have no /api/e backend, so avoid a 404 on
  // every page load while retaining upstream behaviour for root deploys.
  if (import.meta.env.DEV || import.meta.env.BASE_URL !== '/' || sent.has(event)) return
  sent.add(event)
  try {
    // flag letters mirror the endpoint's ?f= allowlist
    const f = flags.ascii ? 'A' : ''
    const pwa = new URLSearchParams(location.search).get('src') === 'pwa'
    navigator.sendBeacon(
      `/api/e?e=${event}${f ? `&f=${f}` : ''}${pwa ? '&src=pwa' : ''}`)
  } catch {
    // counting must never affect the app
  }
}
