import type { ClientMsg, ServerMsg } from './types'
import { ioHook, type IncomingMessage, type OutgoingMessage } from '../dwem/io-hook'

export type MessageHandler = (msg: ServerMsg) => void
export type StateHandler = () => void

export class WsConnection {
  private socket: WebSocket | null = null
  private url: string

  onMessage: MessageHandler = () => {}
  onOpen: StateHandler = () => {}
  onClose: StateHandler = () => {}
  // Connection-scoped hook for the rotating session token. Set once after
  // a successful login so the cookie can be persisted regardless of which
  // view currently owns onMessage.
  onLoginCookie: (cookie: string, expiresDays: number) => void = () => {}

  constructor(url: string) {
    this.url = url
  }

  get wsUrl(): string {
    return this.url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Request no-compression to keep message handling simple.
      // The server will fall back gracefully if the subprotocol is unsupported.
      this.socket = new WebSocket(this.url, 'no-compression')

      this.socket.onopen = () => {
        this.onOpen()
        resolve()
      }

      this.socket.onerror = (e) => {
        reject(new Error(`WebSocket error connecting to ${this.url}`))
        console.error('WS error', e)
      }

      this.socket.onclose = () => {
        this.socket = null
        this.onClose()
      }

      this.socket.onmessage = (event) => {
        this.handleRawMessage(event.data as string)
      }

      if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>
        w['__dcssSimulateIn'] = (m: unknown) => this.dispatch(m as ServerMsg)
      }
    })
  }

  send(msg: ClientMsg): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    ioHook.sendMessage(msg as OutgoingMessage, (next) => {
      if (import.meta.env.DEV) devLog('out', redactForLog(next))
      this.socket?.send(JSON.stringify(next))
    })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  private handleRawMessage(data: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      console.warn('Non-JSON WS message (ignoring):', data.slice(0, 80))
      return
    }

    const obj = parsed as Record<string, unknown>

    // Server can batch messages as { msgs: [...] }
    if (Array.isArray(obj['msgs'])) {
      for (const m of obj['msgs'] as ServerMsg[]) {
        this.dispatch(m)
      }
    } else {
      this.dispatch(obj as unknown as ServerMsg)
    }
  }

  private dispatch(msg: ServerMsg): void {
    if (import.meta.env.DEV) devLog('in', redactForLog(msg))
    // Handle ping at the connection level — always respond immediately.
    if (msg.msg === 'ping') {
      this.send({ msg: 'pong' })
      return
    }
    if (msg.msg === 'login_cookie') {
      this.onLoginCookie(msg.cookie, msg.expires)
      return
    }
    const sink = (next: IncomingMessage) => this.onMessage(next as ServerMsg)
    ioHook.setIncomingSink(sink)
    ioHook.handleMessage(msg as IncomingMessage)
  }
}

// Dev-only circular WS message log accessible via window.__dcssWsLog
type LogEntry = { dir: 'in' | 'out'; ts: number; msg: unknown }
const MAX_LOG = 200
function devLog(dir: 'in' | 'out', msg: unknown): void {
  const w = window as unknown as Record<string, unknown>
  if (!Array.isArray(w['__dcssWsLog'])) w['__dcssWsLog'] = []
  const log = w['__dcssWsLog'] as LogEntry[]
  log.push({ dir, ts: Date.now(), msg })
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
}

// Strip password/cookie fields before any debug logging, so a screenshare
// or co-located devtools snoop can't read them out of __dcssWsLog.
const SENSITIVE_FIELDS = new Set(['password', 'cookie'])
function redactForLog(msg: unknown): unknown {
  if (!msg || typeof msg !== 'object') return msg
  const src = msg as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) {
    out[k] = SENSITIVE_FIELDS.has(k) ? '[redacted]' : src[k]
  }
  return out
}
