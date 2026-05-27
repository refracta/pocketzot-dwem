import type { ClientMsg } from '../ws/types'
import { ioHook, type IncomingMessage, type OutgoingMessage } from './io-hook'
import { siteInformation } from './site-information'

interface RCHandlers {
  onGameInitialize?: (rcfile: string) => void | Promise<void>
  onGameStart?: () => void | Promise<void>
  onGameEnd?: () => void | Promise<void>
}

interface HandlerEntry {
  identifier: string
  handlers: RCHandlers
  priority: number
}

interface PlaySession {
  type: 'play' | 'watch'
  username?: string
  game_id?: string
}

type Phase = 'idle' | 'initializing' | 'active'

export class RCManager {
  readonly locations: Record<string, string> = {
    'crawl.nemelex.cards': 'https://archive.nemelex.cards/rcfiles',
    'test.nemelex.cards': 'https://test-archive.nemelex.cards/rcfiles',
    'crawl.dcss.io': 'https://crawl.dcss.io/crawl/rcfiles',
    'crawl.akrasiac.org:8443': 'https://crawl.akrasiac.org/rcfiles',
    'underhound.eu:8080': 'https://underhound.eu/crawl/rcfiles',
    'cbro.berotato.org:8443': 'https://cbro.berotato.org/rcfiles',
    'cbro.berotato.org': 'https://cbro.berotato.org/rcfiles',
    'crawl.xtahua.com': 'https://crawl.xtahua.com/crawl/rcfiles',
    'crawl.project357.org': 'https://crawl.project357.org/rc-files',
  }

  private handlersList: HandlerEntry[] = []
  private installed = false
  private phase: Phase = 'idle'
  private queue: IncomingMessage[] = []
  private session: PlaySession | null = null
  private rcResolver: ((contents: string) => void) | null = null
  private versionText: string | null = null
  private versionResolver: ((text: string) => void) | null = null

  onLoad(): void {
    if (this.installed) return
    this.installed = true

    ioHook.send_message.before.addHandler('rc-manager', (_msgName, data) => {
      this.captureSession(data)
      return false
    }, 100)

    ioHook.handle_message.before.addHandler('rc-manager', (data) => this.beforeIncoming(data), 100)
  }

  addHandlers(identifier: string, handlers: RCHandlers, priority = 0): void {
    this.removeHandlers(identifier)
    this.handlersList.push({ identifier, handlers, priority })
    this.handlersList.sort((a, b) => b.priority - a.priority)
  }

  removeHandlers(identifier: string): void {
    this.handlersList = this.handlersList.filter((entry) => entry.identifier !== identifier)
  }

  getRCOption(rcfile: string, name: string, type: 'string' | 'boolean' | 'number' | 'float' | 'integer' = 'string', defaultValue?: string | boolean | number): string | boolean | number | undefined {
    const regex = new RegExp(`^(?!\\s*#)\\s*${escapeRegExp(name)}\\s*=\\s*(\\S+)\\s*`, 'gm')
    const value = Array.from(rcfile.matchAll(regex)).pop()?.[1]

    if (type === 'boolean') return value === undefined ? defaultValue : value === 'true'
    if (type === 'number') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : defaultValue
    }
    if (type === 'float') {
      const parsed = parseFloat(value ?? '')
      return Number.isFinite(parsed) ? parsed : defaultValue
    }
    if (type === 'integer') {
      const parsed = parseInt(value ?? '', 10)
      return Number.isFinite(parsed) ? parsed : defaultValue
    }
    return value === undefined ? defaultValue : value
  }

  private captureSession(data: OutgoingMessage): void {
    if (data.msg === 'play') {
      this.session = {
        type: 'play',
        username: siteInformation.current_user,
        game_id: String(data.game_id ?? ''),
      }
    } else if (data.msg === 'watch') {
      this.session = {
        type: 'watch',
        username: String(data.username ?? ''),
      }
    } else if (data.msg === 'go_lobby') {
      void this.endGame()
    }
  }

  private beforeIncoming(data: IncomingMessage): boolean {
    if (data.initiator === 'rc-manager') return false

    if (data.msg === 'rcfile_contents') {
      const contents = String(data.contents ?? '')
      this.rcResolver?.(contents)
      this.rcResolver = null
      return this.phase === 'initializing'
    }

    if (data.msg === 'version' && typeof data.text === 'string') {
      this.versionText = data.text
      this.versionResolver?.(data.text)
      this.versionResolver = null
    }

    if (data.msg === 'go_lobby' || data.msg === 'game_ended' || data.msg === 'close') {
      void this.endGame()
      return false
    }

    if (this.phase === 'initializing') {
      this.queue.push(data)
      return true
    }

    if (data.msg === 'game_client' && this.phase === 'idle') {
      this.phase = 'initializing'
      this.versionText = null
      this.queue = [data]
      void this.initialize(data)
      return true
    }

    return false
  }

  private async initialize(gameClient: IncomingMessage): Promise<void> {
    let rcfile = ''
    try {
      rcfile = await this.loadRcfile(gameClient)
    } catch (err) {
      console.warn('[DWEM][RCManager] failed to load rcfile; continuing with empty config', err)
    }

    for (const { handlers } of this.handlersList) {
      try {
        await handlers.onGameInitialize?.(rcfile)
      } catch (err) {
        console.error('[DWEM][RCManager] onGameInitialize failed', err)
      }
    }

    this.phase = 'active'
    const queued = this.queue
    this.queue = []
    for (const msg of queued) {
      ioHook.handle_message({ ...msg, initiator: 'rc-manager' })
    }

    for (const { handlers } of this.handlersList) {
      try {
        await handlers.onGameStart?.()
      } catch (err) {
        console.error('[DWEM][RCManager] onGameStart failed', err)
      }
    }
  }

  private async endGame(): Promise<void> {
    if (this.phase === 'idle') return
    this.phase = 'idle'
    this.queue = []
    this.rcResolver = null
    this.versionResolver = null
    this.versionText = null
    for (const { handlers } of this.handlersList) {
      try {
        await handlers.onGameEnd?.()
      } catch (err) {
        console.error('[DWEM][RCManager] onGameEnd failed', err)
      }
    }
  }

  private async loadRcfile(gameClient: IncomingMessage): Promise<string> {
    const fromServer = await this.requestRcfileFromServer()
    if (fromServer !== null) return fromServer

    const versionText = this.versionText ?? await this.waitForVersionText(1500) ?? String(gameClient.version ?? '')
    const rcUrl = this.getRCURL(versionText, this.session?.username ?? siteInformation.current_user)
    if (!rcUrl) return ''
    return this.fetchRcURL(rcUrl)
  }

  private requestRcfileFromServer(): Promise<string | null> {
    const conn = siteInformation.conn
    const gameId = this.session?.game_id
    if (!conn || !gameId) return Promise.resolve(null)

    return new Promise((resolve) => {
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        this.rcResolver = null
        resolve(null)
      }, 4000)

      this.rcResolver = (contents: string) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve(contents)
      }

      conn.send({ msg: 'get_rc', game_id: gameId } as ClientMsg)
    })
  }

  private waitForVersionText(timeoutMs: number): Promise<string | null> {
    if (this.versionText) return Promise.resolve(this.versionText)
    return new Promise((resolve) => {
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        this.versionResolver = null
        resolve(null)
      }, timeoutMs)
      this.versionResolver = (text: string) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve(text)
      }
    })
  }

  private async fetchRcURL(url: string): Promise<string> {
    const proxyResponse = await fetch('https://rc-proxy.nemelex.cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (proxyResponse.ok) return proxyResponse.text()

    const direct = await fetch(url)
    return direct.ok ? direct.text() : ''
  }

  private getRCURL(version: string, username: string): string | undefined {
    if (!username) return undefined
    const host = wsHost(siteInformation.conn?.wsUrl)
    const baseURL = host ? this.locations[host] : undefined
    if (!baseURL) return undefined

    const identifier = this.identifierFromVersion(version) ?? this.identifierFromGameId(this.session?.game_id)
    if (!identifier) return undefined
    const safeUser = encodeURIComponent(username)

    if (host === 'crawl.project357.org') {
      const cpoId = identifier === 'git' ? 'trunk' : identifier
      return `${baseURL}/${cpoId}/${safeUser}.rc`
    }

    return `${baseURL}/crawl-${identifier}/${safeUser}.rc`
  }

  private identifierFromVersion(version: string): string | undefined {
    if (!version) return undefined
    if (/trunk|git|alpha|beta|a0|b0/i.test(version)) return 'git'
    const match = version.match(/(\d+\.\d+)/)
    return match?.[1]
  }

  private identifierFromGameId(gameId?: string): string | undefined {
    if (!gameId) return undefined
    if (/^dcss-(trunk|git)/.test(gameId)) return 'git'
    return gameId.match(/^dcss-(\d+\.\d+)/)?.[1]
  }
}

function wsHost(wsUrl?: string): string | undefined {
  if (!wsUrl) return undefined
  try {
    return new URL(wsUrl.replace(/^ws/, 'http')).host
  } catch {
    return undefined
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const rcManager = new RCManager()
