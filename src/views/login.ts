import { WsConnection } from '../ws/connection'
import type { ServerMsg } from '../ws/types'
import { clearSession, listSessions, saveSession, type StoredSession } from '../auth/session'
import { findServer, KNOWN_SERVERS, SPECTATE_SERVERS, labelFor } from '../servers'
import { getLastSpectateServer, setLastSpectateServer } from '../prefs'
import { openAboutDoc, openChangelogDoc } from './docs'

export interface LoginResult {
  conn: WsConnection
  username: string
  guest?: boolean
}

export function buildLoginView(
  onLogin: (result: LoginResult) => void
): HTMLElement {
  const view = document.createElement('div')
  view.id = 'login-view'

  const sessions = listSessions()
  const hasSessions = sessions.length > 0

  // Reused form contents — wrapped in a `<details>` toggle when the user
  // already has saved sessions, or rendered as a plain Sign-in section when
  // they don't.
  const formInnerHtml = `
    <label class="login-label">
      Server
      <select id="server-select"></select>
    </label>
    <label class="login-label">
      Username
      <input id="login-user" type="text" autocomplete="username"
             spellcheck="false" autocorrect="off" autocapitalize="off" required />
    </label>
    <label class="login-label">
      Password
      <input id="login-pass" type="password" autocomplete="current-password" required />
    </label>
    <button id="login-btn" type="submit" class="login-btn">Connect</button>
  `

  // About / What's new are rendered in-app from the committed ABOUT.md /
  // CHANGELOG.md (see ./docs), so they ship in every build — this footer is the
  // always-present source/attribution surface required by the AGPL.
  const siteFooterHtml = `
    <div class="login-footer">
      <a href="#" id="login-about">About</a>
      <a href="#" id="login-changelog">What's new</a>
    </div>
  `

  const addAccountSection = hasSessions
    ? `
      <details id="add-account" class="login-section login-add-section">
        <summary class="login-add-toggle">+ Add another account</summary>
        <form id="login-form" autocomplete="on" novalidate class="login-add-form">
          ${formInnerHtml}
        </form>
      </details>
    `
    : `
      <section class="login-section login-signin-section">
        <div class="login-section-label">Sign in</div>
        <form id="login-form" autocomplete="on" novalidate>
          ${formInnerHtml}
        </form>
      </section>
    `

  view.innerHTML = `
    <div class="login-card">
      <h1 class="login-title">PocketZot</h1>

      ${hasSessions ? `
      <section id="resume-section" class="login-section">
        <div class="login-section-label">Your accounts</div>
        <div id="resume-list" class="login-account-list"></div>
      </section>
      ` : ''}

      <div id="login-error" class="login-error" style="display:none" role="alert"></div>

      ${addAccountSection}

      <section class="login-section login-spectate-section">
        <div class="login-section-label">Spectate as guest</div>
        <select id="spectate-select" class="login-spectate-select" aria-label="Server"></select>
        <div id="spectate-error" class="login-error" style="display:none" role="alert"></div>
        <button id="spectate-btn" type="button" class="login-btn login-btn-spectate">Spectate →</button>
      </section>

      ${siteFooterHtml}
    </div>
  `

  const formSelect = view.querySelector<HTMLSelectElement>('#server-select')!
  const spectateSelect = view.querySelector<HTMLSelectElement>('#spectate-select')!
  const userInput = view.querySelector<HTMLInputElement>('#login-user')!
  const passInput = view.querySelector<HTMLInputElement>('#login-pass')!
  const errorEl = view.querySelector<HTMLElement>('#login-error')!
  const spectateErrorEl = view.querySelector<HTMLElement>('#spectate-error')!
  const btn = view.querySelector<HTMLButtonElement>('#login-btn')!

  for (const s of KNOWN_SERVERS) {
    const o1 = document.createElement('option')
    o1.value = s.wsUrl; o1.textContent = s.label
    formSelect.appendChild(o1)
  }
  for (const s of SPECTATE_SERVERS) {
    const o2 = document.createElement('option')
    o2.value = s.wsUrl; o2.textContent = s.label
    spectateSelect.appendChild(o2)
  }

  // Login-form dropdown follows the most-recently-used session's server.
  // Spectate dropdown prefers the saved pref (last explicit guest pick),
  // falling back to the session-derived prior when that server is also
  // anonymously spectatable, otherwise the list top.
  const topSession = sessions[0]
  if (topSession && KNOWN_SERVERS.some(s => s.wsUrl === topSession.wsUrl)) {
    formSelect.value = topSession.wsUrl
  }
  const savedSpectate = getLastSpectateServer()
  if (savedSpectate) {
    spectateSelect.value = savedSpectate
  } else if (topSession && SPECTATE_SERVERS.some(s => s.wsUrl === topSession.wsUrl)) {
    spectateSelect.value = topSession.wsUrl
  }

  view.querySelector('#login-about')!.addEventListener('click', (e) => {
    e.preventDefault()
    openAboutDoc()
  })
  view.querySelector('#login-changelog')!.addEventListener('click', (e) => {
    e.preventDefault()
    openChangelogDoc()
  })

  renderResumeButtons()

  function renderResumeButtons(): void {
    const section = view.querySelector<HTMLElement>('#resume-section')
    const list = view.querySelector<HTMLElement>('#resume-list')
    if (!section || !list) return
    list.innerHTML = ''
    const ss = listSessions()
    for (const s of ss) {
      const server = findServer(s.wsUrl)
      const tag = server?.tag ?? new URL(s.wsUrl).hostname.split('.')[0].slice(0, 4).toUpperCase()
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'login-account-card'
      card.innerHTML = `
        <span class="login-account-tag">${escHtml(tag)}</span>
        <span class="login-account-username">${escHtml(s.username)}</span>
      `
      card.addEventListener('click', () => resumeWithToken(s, card))
      list.appendChild(card)
    }
    if (ss.length === 0) section.hidden = true
  }

  async function resumeWithToken(s: StoredSession, card: HTMLButtonElement): Promise<void> {
    clearErrors()
    card.disabled = true

    const conn = new WsConnection(s.wsUrl)
    try {
      await conn.connect()
    } catch {
      showError(`Could not connect to ${labelFor(s.wsUrl)}`)
      card.disabled = false
      return
    }

    // Refresh the rotating cookie on every successful (re)login.
    conn.onLoginCookie = (cookie, expiresDays) => {
      saveSession(s.wsUrl, s.username, cookie, expiresDays)
    }

    conn.send({ msg: 'token_login', cookie: s.cookie })

    listenOnce(conn, (msg) => {
      if (msg.msg === 'login_success') {
        conn.send({ msg: 'set_login_cookie' })
        onLogin({ conn, username: msg.username })
      } else if (msg.msg === 'login_fail') {
        clearSession(s.wsUrl, s.username)
        conn.close()
        showError('Saved session expired — please log in again.')
        renderResumeButtons()
      }
    })
  }

  const form = view.querySelector<HTMLFormElement>('#login-form')!
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearErrors()

    const wsUrl = formSelect.value
    const username = userInput.value.trim()
    const password = passInput.value

    if (!username) { showError('Please enter a username.'); return }
    if (!password) { showError('Please enter a password.'); return }

    btn.disabled = true
    btn.textContent = 'Connecting…'

    const conn = new WsConnection(wsUrl)
    try {
      await conn.connect()
    } catch {
      showError(`Could not connect to ${labelFor(wsUrl)}`)
      btn.disabled = false
      btn.textContent = 'Connect'
      return
    }

    conn.send({ msg: 'login', username, password })

    listenOnce(conn, (msg: ServerMsg) => {
      if (msg.msg === 'login_success') {
        conn.onLoginCookie = (cookie, expiresDays) => {
          saveSession(wsUrl, msg.username, cookie, expiresDays)
        }
        conn.send({ msg: 'set_login_cookie' })
        onLogin({ conn, username: msg.username })
      } else if (msg.msg === 'login_fail') {
        showError(msg.message || 'Login failed.')
        conn.close()
        btn.disabled = false
        btn.textContent = 'Connect'
      }
    })
  })

  const spectateBtn = view.querySelector<HTMLButtonElement>('#spectate-btn')!
  spectateBtn.addEventListener('click', async () => {
    clearErrors()
    const wsUrl = spectateSelect.value
    setLastSpectateServer(wsUrl)
    spectateBtn.disabled = true
    spectateBtn.textContent = 'Connecting…'

    const conn = new WsConnection(wsUrl)
    try {
      await conn.connect()
    } catch {
      showSpectateError(`Could not connect to ${labelFor(wsUrl)}`)
      spectateBtn.disabled = false
      spectateBtn.textContent = 'Spectate →'
      return
    }

    onLogin({ conn, username: '', guest: true })
  })

  function showError(msg: string): void {
    spectateErrorEl.style.display = 'none'
    errorEl.textContent = msg
    errorEl.style.display = ''
  }

  function showSpectateError(msg: string): void {
    errorEl.style.display = 'none'
    spectateErrorEl.textContent = msg
    spectateErrorEl.style.display = ''
  }

  function clearErrors(): void {
    errorEl.style.display = 'none'
    spectateErrorEl.style.display = 'none'
  }

  return view
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Install a one-shot handler that fires on the first login_success / login_fail.
// The handler typically swaps the view, which reassigns conn.onMessage to the
// next view's handler — in that case we leave the new handler in place. If the
// handler doesn't reassign (e.g. login_fail), restore the prior onMessage.
//
// The WebTiles server pushes the lobby snapshot (lobby_clear / lobby_entry /
// lobby_complete) immediately on socket open, before login_success arrives.
// Buffer those pre-login messages and replay them to whichever handler owns
// onMessage after the login handler runs, so the lobby view sees them.
function listenOnce(conn: WsConnection, handler: (msg: ServerMsg) => void): void {
  const prev = conn.onMessage
  const buffered: ServerMsg[] = []
  const wrapper = (msg: ServerMsg) => {
    if (msg.msg === 'login_success' || msg.msg === 'login_fail') {
      handler(msg)
      if (conn.onMessage === wrapper) conn.onMessage = prev
      const next = conn.onMessage
      for (const m of buffered) next(m)
      buffered.length = 0
    } else {
      buffered.push(msg)
    }
  }
  conn.onMessage = wrapper
}
