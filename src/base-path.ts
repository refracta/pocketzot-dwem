// Vite's deployment base, normalized for runtime paths used outside bundled
// asset imports (service-worker registration, offline artifacts and gamedata).
// Vitest keeps the upstream root-path fixtures unchanged.
export const APP_BASE = import.meta.env.MODE === 'test' ? '/' : import.meta.env.BASE_URL

export function appPath(path: string): string {
  return APP_BASE + path.replace(/^\/+/, '')
}

export function appHttpBase(): string {
  return APP_BASE === '/' ? '' : APP_BASE.replace(/\/$/, '')
}
