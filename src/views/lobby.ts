import type { WsConnection } from '../ws/connection'
import type { GameExit, LobbyEntry, ServerMsg } from '../ws/types'
import { clearSession, loadSession } from '../auth/session'
import { cncUserinfo } from '../dwem'
import { getTileLoader, type TileLoader } from '../game/tiles/tile-loader'
import type { SpectateTarget } from './game-view'
import { tagFor } from '../servers'
import { fitToWidth } from './fit-terminal'
import { openAboutDoc, openChangelogDoc } from './docs'

export function buildLobbyView(
  conn: WsConnection,
  username: string,
  guest: boolean,
  onGameStart: (spectating?: SpectateTarget) => void,
  onDisconnect: () => void,
  exit?: GameExit,
): HTMLElement {
  const games = new Map<string, LobbyEntry>()
  // Wall-clock timestamp at which each idle game first went idle. Server only
  // emits idle_time on the toggle, not continuously, so we interpolate locally
  // (mirrors the official client at static/scripts/client.js:1219).
  const idleSinceMs = new Map<string, number>()
  let complete = false
  // Per-version tile loader for the game we're about to spectate. game_client
  // lands here (before watching_started) while the lobby is still active; we
  // resolve the loader now and hand it to the game view, which the server
  // won't re-tell the version to.
  let activeLoader: TileLoader | null = null

  const view = document.createElement('div')
  view.id = 'lobby-view'

  const serverTag = tagFor(conn.wsUrl)
  const useCncUserinfo = cncUserinfo.isEnabledForServer(conn.wsUrl)
  const headerRight = guest
    ? `<div class="lobby-account-chip is-guest">
         <span class="lobby-chip-role">Guest</span>
         <span class="lobby-chip-sep">·</span>
         <span class="lobby-chip-tag">${escHtml(serverTag)}</span>
       </div>`
    : `
      <div class="lobby-account-chip-wrap">
        <button id="lobby-account-chip" class="lobby-account-chip" type="button"
                aria-haspopup="menu" aria-expanded="false">
          <span class="lobby-chip-user">${renderUsername(username)}</span>
          <span class="lobby-chip-sep">·</span>
          <span class="lobby-chip-tag">${escHtml(serverTag)}</span>
          <span class="lobby-chip-caret">▾</span>
        </button>
        <div id="lobby-account-menu" class="lobby-account-menu" hidden>
          <button id="lobby-about" type="button" class="lobby-account-menu-item">About</button>
          <button id="lobby-changelog" type="button" class="lobby-account-menu-item">What's new</button>
          <button id="lobby-logout" type="button" class="lobby-account-menu-item">Logout</button>
        </div>
      </div>
    `
  const gamesContainer = guest
    ? ''
    : '<div id="lobby-games" class="lobby-actions"><div class="lobby-loading">Loading games…</div></div>'

  view.innerHTML = `
    <div class="lobby-header">
      <button id="lobby-back" class="lobby-btn-ghost" aria-label="Back to login">← Back</button>
      ${headerRight}
    </div>
    <div id="lobby-notice" class="lobby-notice" hidden></div>
    ${gamesContainer}
    <h2 class="lobby-section-title">Active Games</h2>
    <div id="lobby-list" class="lobby-list">
      <div class="lobby-loading">Loading…</div>
    </div>
  `

  const listEl = view.querySelector<HTMLElement>('#lobby-list')!
  const gamesEl = view.querySelector<HTMLElement>('#lobby-games')
  const noticeEl = view.querySelector<HTMLElement>('#lobby-notice')!

  let closeAccountMenu: (() => void) | null = null

  view.querySelector('#lobby-back')!.addEventListener('click', () => {
    closeAccountMenu?.()
    conn.close()
    onDisconnect()
  })

  if (!guest) {
    const chip = view.querySelector<HTMLButtonElement>('#lobby-account-chip')!
    const menuEl = view.querySelector<HTMLElement>('#lobby-account-menu')!
    const logoutBtn = view.querySelector<HTMLButtonElement>('#lobby-logout')!

    function closeMenu(): void {
      if (menuEl.hidden) return
      menuEl.hidden = true
      chip.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', onOutside, true)
    }
    function openMenu(): void {
      menuEl.hidden = false
      chip.setAttribute('aria-expanded', 'true')
      document.addEventListener('pointerdown', onOutside, true)
    }
    function onOutside(e: Event): void {
      const t = e.target as Node | null
      if (!t) return
      if (chip.contains(t) || menuEl.contains(t)) return
      closeMenu()
    }
    chip.addEventListener('click', () => {
      if (menuEl.hidden) openMenu(); else closeMenu()
    })
    closeAccountMenu = closeMenu

    view.querySelector('#lobby-about')!.addEventListener('click', () => {
      closeMenu()
      openAboutDoc()
    })
    view.querySelector('#lobby-changelog')!.addEventListener('click', () => {
      closeMenu()
      openChangelogDoc()
    })

    logoutBtn.addEventListener('click', () => {
      closeMenu()
      const stored = loadSession(conn.wsUrl, username)
      if (stored) {
        conn.send({ msg: 'forget_login_cookie', cookie: stored.cookie })
        clearSession(conn.wsUrl, username)
      }
      conn.close()
      onDisconnect()
    })
  }

  conn.onMessage = handleMsg

  function handleMsg(msg: ServerMsg): void {
    switch (msg.msg) {
      case 'set_game_links':
        renderGameButtons((msg as unknown as { content: string }).content)
        break
      case 'lobby_entry': {
        const e = msg as ServerMsg & LobbyEntry
        const id = String(e.id)
        games.set(id, e)
        if (e.idle_time && e.idle_time > 0) {
          idleSinceMs.set(id, Date.now() - e.idle_time * 1000)
        } else {
          idleSinceMs.delete(id)
        }
        if (complete) renderList()
        break
      }
      case 'lobby_remove':
        games.delete(String(msg.id))
        idleSinceMs.delete(String(msg.id))
        if (complete) renderList()
        break
      case 'lobby_clear':
        games.clear()
        idleSinceMs.clear()
        break
      case 'lobby_complete':
        complete = true
        renderList()
        break
      case 'game_started':
        onGameStart()
        break
      case 'watching_started':
        onGameStart({ username: msg.username, loader: activeLoader ?? undefined })
        break
      case 'game_client': {
        // Sent on `watch` *before* `watching_started`, so it lands here while
        // the lobby is still active. Resolve this game's per-version loader now
        // and pass it to the game view via watching_started — the server won't
        // resend the version once we've mounted.
        const httpBase = conn.wsUrl.replace(/^ws/, 'http').replace(/\/socket\/?$/, '')
        if (msg.version) activeLoader = getTileLoader(httpBase, msg.version)
        break
      }
      case 'set_layer':
        if (msg.layer === 'game' || msg.layer === 'crt') onGameStart()
        break
      case 'close':
        onDisconnect()
        break
      case 'auth_error':
        noticeEl.textContent = msg.reason
        noticeEl.hidden = false
        break
    }
  }

  function renderGameButtons(html: string): void {
    if (!gamesEl) return
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = doc.querySelectorAll<HTMLAnchorElement>('a[href^="#play-"]')
    if (links.length === 0) return

    // Trust the server: every #play-<id> link the server advertises becomes a
    // button. We only decide *visibility* — main DCSS (latest stable + trunk)
    // is shown up front; everything else (older versions, sprint, seeded,
    // descent, ...) goes behind a "Show all versions" toggle so the lobby
    // stays compact on a phone.
    type Game = { gameId: string; label: string }
    const all: Game[] = []
    links.forEach(link => {
      const gameId = link.getAttribute('href')!.slice(6) // strip "#play-"
      const label = link.textContent?.trim() || gameId
      all.push({ gameId, label })
    })

    // Identify the "primary" main-DCSS games: trunk variant + highest stable.
    let trunkId: string | null = null
    let stableId: string | null = null
    let stableVer: [number, number] = [-1, -1]
    for (const g of all) {
      if (!/^dcss-/.test(g.gameId)) continue
      if (/^dcss-(trunk|git)$/.test(g.gameId)) {
        trunkId = g.gameId
      } else {
        const v = parseVersion(g.gameId)
        if (cmpVersion(v, stableVer) > 0) { stableVer = v; stableId = g.gameId }
      }
    }
    const primary = new Set([stableId, trunkId].filter((x): x is string => !!x))

    gamesEl.innerHTML = ''
    const primaryGames = all.filter(g => primary.has(g.gameId))
    const otherGames = all.filter(g => !primary.has(g.gameId))

    for (const g of primaryGames) gamesEl.appendChild(makeGameBtn(g, 'lobby-btn-primary'))

    if (otherGames.length > 0) {
      const details = document.createElement('details')
      details.className = 'lobby-more-games'
      const summary = document.createElement('summary')
      summary.textContent = `Show all versions (${otherGames.length})`
      details.appendChild(summary)
      const moreList = document.createElement('div')
      moreList.className = 'lobby-more-games-list'
      for (const g of otherGames) moreList.appendChild(makeGameBtn(g, 'lobby-btn-secondary'))
      details.appendChild(moreList)
      gamesEl.appendChild(details)
    }
  }

  function makeGameBtn(g: { gameId: string; label: string }, cls: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = cls
    btn.textContent = g.label
    btn.addEventListener('click', () => conn.send({ msg: 'play', game_id: g.gameId }))
    return btn
  }

  function renderList(): void {
    if (games.size === 0) {
      listEl.innerHTML = '<div class="lobby-empty">No active games.</div>'
      return
    }
    const all = [...games.values()]
    const active = all.filter(g => !idleSinceMs.has(String(g.id)))
    const idle = all.filter(g => idleSinceMs.has(String(g.id)))

    active.sort((a, b) =>
      a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
    )
    // Idle group: least-idle first (largest idleSince timestamp = went idle most recently).
    idle.sort((a, b) =>
      (idleSinceMs.get(String(b.id)) ?? 0) - (idleSinceMs.get(String(a.id)) ?? 0),
    )

    listEl.innerHTML = ''
    for (const g of active) listEl.appendChild(buildRow(g))
    if (active.length > 0 && idle.length > 0) {
      const div = document.createElement('div')
      div.className = 'lobby-section-divider'
      div.textContent = '─ idle ─'
      listEl.appendChild(div)
    }
    for (const g of idle) listEl.appendChild(buildRow(g))
  }

  function buildRow(g: LobbyEntry): HTMLElement {
    const parts: string[] = []
    const hasMeta = g.char || g.xl != null || g.place
    if (g.char) parts.push(escHtml(g.char))
    if (g.xl != null) parts.push(`XL${g.xl}`)
    if (g.place) parts.push(escHtml(g.place))
    if (!hasMeta && g.milestone) parts.push(`<i>${escHtml(g.milestone.replace(/^started /, ''))}</i>`)
    const ver = versionLabel(g.game_id)
    if (ver) parts.push(`<span class="lobby-game-version">${escHtml(ver)}</span>`)
    if (g.spectator_count && g.spectator_count > 0) {
      parts.push(`<span class="lobby-game-watchers">${g.spectator_count} spectator${g.spectator_count === 1 ? '' : 's'}</span>`)
    }
    const id = String(g.id)
    const isIdle = idleSinceMs.has(id)
    const row = document.createElement('div')
    row.className = 'lobby-game-row' + (isIdle ? ' is-idle' : '')
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.innerHTML = `
      <div class="lobby-game-main">
        <div class="lobby-game-toprow">
          <span class="lobby-game-user">${renderUsername(g.username)}</span>
          <span class="lobby-game-idle" data-id="${escHtml(id)}">${formatIdleFor(id)}</span>
        </div>
        <span class="lobby-game-info">${parts.join(' ')}</span>
      </div>
    `
    row.addEventListener('click', () => {
      conn.send({ msg: 'watch', username: g.username })
    })
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        conn.send({ msg: 'watch', username: g.username })
      }
    })
    return row
  }

  function renderUsername(rawUsername: string): string {
    return useCncUserinfo
      ? cncUserinfo.applyStyledUsername(rawUsername)
      : escHtml(rawUsername)
  }

  function formatIdleFor(id: string): string {
    const since = idleSinceMs.get(id)
    if (since == null) return ''
    return formatIdle(Date.now() - since)
  }

  function updateIdleLabels(): void {
    for (const el of view.querySelectorAll<HTMLElement>('.lobby-game-idle')) {
      const id = el.dataset['id']
      if (id) el.textContent = formatIdleFor(id)
    }
  }

  const ticker = window.setInterval(() => {
    if (!view.isConnected) { window.clearInterval(ticker); return }
    updateIdleLabels()
  }, 1000)

  if (exit) maybeShowExitDialog(view, exit)

  return view
}

// Expected end-of-game reasons; anything outside this set is "abnormal"
// (crash/error/disconnect/…) and gets a reason sentence even first-person.
// Matches the reference's normal_exit set (client.js:exit_reason_message).
const NORMAL_EXIT = new Set(['quit', 'won', 'bailed out', 'dead', 'saved', 'cancel'])

// Render the post-game exit dialog over the lobby. Mirrors the reference, which
// has no title — just body content: an optional reason sentence on top, then
// the summary blurb. The reason sentence appears only for abnormal (crash/
// error/disconnect) or spectated exits ("Unfortunately your game crashed." /
// "tdpma stopped playing (saved)."); a first-person normal exit (died/won/quit)
// lets the summary speak for itself. The summary is always shown when present,
// even when it repeats the game-over screen just seen, so the recap lives in
// one place. Suppressed only when there's nothing to say (a first-person normal
// exit with no summary, e.g. cancel), matching the reference's show condition.
function maybeShowExitDialog(view: HTMLElement, exit: GameExit): void {
  const abnormal = !NORMAL_EXIT.has(exit.reason)
  const sentence = abnormal || !!exit.spectated
  if (!sentence && !exit.message) return

  const reason = sentence
    ? reasonSentence(exit.reason, exit.spectated ? (exit.spectatedName ?? '') : null)
    : null

  const parts: string[] = []
  if (reason) parts.push(`<div class="lobby-exit-reason">${escHtml(reason)}</div>`)
  if (exit.message) {
    parts.push(`<pre class="lobby-exit-summary">${escHtml(dedent(exit.message))}</pre>`)
  }
  // Footer action row, separated from the recap by a hairline. Close sits left
  // and the morgue link is pushed right, matching the reference webtiles exit
  // dialog so returning players' muscle memory holds.
  const actions: string[] = ['<button type="button" class="lobby-exit-close">Close</button>']
  if (exit.dump) {
    const href = `${exit.dump}.txt`
    actions.push(
      `<a class="lobby-exit-link" href="${escHtml(href)}" target="_blank" rel="noopener">`
      + `${escHtml(dumpLabel(exit.reason))}</a>`,
    )
  }
  parts.push(`<div class="lobby-exit-footer">${actions.join('')}</div>`)

  const backdrop = document.createElement('div')
  backdrop.className = 'lobby-exit-backdrop'
  backdrop.innerHTML = `<div class="lobby-exit-card">${parts.join('')}</div>`
  view.appendChild(backdrop)

  const close = () => backdrop.remove()
  backdrop.querySelector('.lobby-exit-close')!.addEventListener('click', close)
  // Tapping the dimmed area outside the card dismisses it too.
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close() })

  const summary = backdrop.querySelector<HTMLElement>('.lobby-exit-summary')
  if (summary) requestAnimationFrame(() => fitToWidth(summary))
}

// Strip the common leading-space margin shared by every non-empty line. The
// summary blurb is laid out for an 80-col terminal and arrives centred with a
// wide left margin; removing the shared indent shifts it flush-left (so it
// scales up larger) while leaving the relative column offsets — and thus the
// CRT alignment — untouched. Also drops trailing whitespace.
function dedent(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  let min = Infinity
  for (const l of lines) {
    if (!l.trim()) continue
    min = Math.min(min, l.match(/^ */)![0].length)
  }
  return min > 0 && Number.isFinite(min) ? lines.map(l => l.slice(min)).join('\n') : lines.join('\n')
}

// Reason sentence shown atop the dialog. `watched` is the spectated player's
// name, or null for first-person. Returns null when there's no sentence to show
// (the normal first-person/spectated outcomes), leaving the summary to speak
// for itself. Ports client.js:exit_reason_message.
function reasonSentence(reason: string, watched: string | null): string | null {
  if (watched) {
    switch (reason) {
      case 'quit': case 'won': case 'bailed out': case 'dead': return null
      case 'cancel': return `${watched} quit before creating a character.`
      case 'saved': return `${watched} stopped playing (saved).`
      case 'crash': return `${watched}'s game crashed.`
      case 'error': return `${watched}'s game was terminated due to an error.`
      case 'disconnect': return `${watched} has been disconnected.`
      default: return `${watched}'s game ended unexpectedly.`
        + (reason !== 'unknown' ? ` (${reason})` : '')
    }
  }
  switch (reason) {
    case 'quit': case 'won': case 'bailed out': case 'dead':
    case 'saved': case 'cancel': return null
    case 'crash': return 'Unfortunately your game crashed.'
    case 'error': return 'Unfortunately your game terminated due to an error.'
    case 'disconnect': return 'You have been disconnected.'
    default: return 'Unfortunately your game ended unexpectedly.'
      + (reason !== 'unknown' ? ` (${reason})` : '')
  }
}

// Morgue/dump link label, per reason (client.js:show_exit_dialog).
function dumpLabel(reason: string): string {
  if (reason === 'saved') return 'Character dump'
  if (reason === 'crash') return 'Crash log'
  return 'Morgue file'
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function versionLabel(gameId: string): string {
  return gameId.startsWith('dcss-') ? gameId.slice(5) : gameId
}

function formatIdle(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `idle ${s}s`
  if (s < 3600) return `idle ${Math.floor(s / 60)}m`
  return `idle ${Math.floor(s / 3600)}h`
}

// Extract a [major, minor] tuple from a game id like "dcss-0.34" or
// "dcss-0.34-trunk". Returns [0,0] when no version is present (e.g. "dcss-git"),
// which sorts below any explicit version — the trunk bucket is matched
// separately so this only matters for ordering within trunk variants.
function parseVersion(gameId: string): [number, number] {
  const m = /(\d+)\.(\d+)/.exec(gameId)
  if (!m) return [0, 0]
  return [parseInt(m[1], 10), parseInt(m[2], 10)]
}

function cmpVersion(a: [number, number], b: [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}
