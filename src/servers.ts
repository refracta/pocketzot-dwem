// Hosts here must also be allowlisted in public/_headers (script-src + img-src)
// for tile sprites and tileinfo modules to load through the production CSP.
//
// `tag` is the official server acronym from the DCSS howto
// (https://crawl.develz.org/wordpress/howto), used as a compact label in
// places like the lobby header.
export interface KnownServer {
  label: string
  tag: string
  wsUrl: string
}

export const KNOWN_SERVERS: KnownServer[] = [
  { label: 'crawl.dcss.io', tag: 'CDI', wsUrl: 'wss://crawl.dcss.io/socket' },
  { label: 'crawl.akrasiac.org', tag: 'CAO', wsUrl: 'wss://crawl.akrasiac.org:8443/socket' },
  { label: 'cbro.berotato.org', tag: 'CBR2', wsUrl: 'wss://cbro.berotato.org:8443/socket' },
  { label: 'crawl.roguelikes.gg', tag: 'CRG', wsUrl: 'wss://crawl.roguelikes.gg/socket' },
  { label: 'crawl-br.roguelikes.gg', tag: 'CBRG', wsUrl: 'wss://crawl-br.roguelikes.gg/socket' },
  { label: 'crawl.xtahua.com', tag: 'CXC', wsUrl: 'wss://crawl.xtahua.com/socket' },
  { label: 'underhound.eu', tag: 'CUE', wsUrl: 'wss://underhound.eu:8080/socket' },
  { label: 'crawl.nemelex.cards', tag: 'CNC', wsUrl: 'wss://crawl.nemelex.cards/socket' },
  { label: 'crawl.project357.org', tag: 'CPO', wsUrl: 'wss://crawl.project357.org/socket' },
]

// CAO requires authentication for spectating, so it's excluded from the
// anonymous spectate dropdown.
export const SPECTATE_SERVERS: KnownServer[] = KNOWN_SERVERS.filter(
  s => s.tag !== 'CAO',
)

export function findServer(wsUrl: string): KnownServer | undefined {
  return KNOWN_SERVERS.find(s => s.wsUrl === wsUrl)
}

export function tagFor(wsUrl: string): string {
  return findServer(wsUrl)?.tag ?? new URL(wsUrl).hostname
}

export function labelFor(wsUrl: string): string {
  return findServer(wsUrl)?.label ?? wsUrl
}
