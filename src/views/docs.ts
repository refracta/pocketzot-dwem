import aboutMd from '../../ABOUT.md?raw'
import changelogMd from '../../CHANGELOG.md?raw'
import { openDocView } from './doc-view'

// The committed ABOUT.md / CHANGELOG.md are the canonical project surfaces: they
// ship inside the JS bundle, so every build — including forks — carries the
// source/license/attribution links and version history, with no gitignored HTML
// files or env flags required. The static public/*.html pages are just the
// operator's SEO/marketing mirrors.

const REPO = 'https://github.com/pocketzot/pocketzot'

// ABOUT.md uses repo-relative links (LICENSE, ATTRIBUTION.md) that only resolve
// on GitHub, and points at the donations page as /support. Rewrite them for web
// display; leave absolute http/mailto and root-absolute paths untouched.
function resolveAboutLink(href: string): string {
  if (/^(https?:|mailto:)/i.test(href)) return href
  if (href === '/support') return '/support.html'
  if (href.startsWith('/') || href.startsWith('#')) return href
  return `${REPO}/blob/main/${href}`
}

// Strip any leading HTML comment (maintainer note) and the leading H1, which is
// shown as the dialog title instead.
function prep(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*#\s+.*(?:\r?\n)?/, '')
}

export function openAboutDoc(): void {
  let md = aboutMd
  // The Support (donations) section points at the operator's wallet via the
  // gitignored /support page. Drop it from the open-source build so forks don't
  // surface a dead donation link.
  if (!import.meta.env.VITE_SITE_PAGES) {
    md = md.replace(/\n##\s+Support[\s\S]*$/, '\n')
  }
  openDocView('About', prep(md), { resolveLink: resolveAboutLink })
}

export function openChangelogDoc(): void {
  openDocView("What's new", prep(changelogMd))
}

// The Gestures section of ABOUT.md, as its own small doc (Settings → Help).
// Extracted rather than duplicated so the list has one source of truth; if
// the section heading ever changes, fall back to the full About doc rather
// than showing nothing.
export function openGesturesDoc(): void {
  const section = /\n## Gestures\r?\n([\s\S]*?)(?=\n## |$)/.exec(aboutMd)
  if (section) openDocView('Gestures', section[1].trim())
  else openAboutDoc()
}
