import type { ServerMsg } from '../ws/types'
import { cncUserinfo } from './cnc-userinfo'

export const CNC_PUBLIC_CHAT_BOT = 'CNCPublicChat'

export interface CncPublicChatHandlers {
  onChat: (content: string) => void
  onSpectators?: (count: number, names: string) => void
  onStatus?: (text: string) => void
  onLoginCookie?: (cookie: string, expiresDays: number) => void
}

export function isCncPublicChatAvailable(wsUrl: string): boolean {
  return cncUserinfo.isEnabledForServer(wsUrl)
}

export class CncPublicChatClient {
  private socket: WebSocket | null = null
  private closed = false
  private authenticated = false
  private authInFlight = false
  private pendingChat: string[] = []

  constructor(
    private readonly wsUrl: string,
    private readonly getLoginCookie: () => string | null | undefined,
    private readonly handlers: CncPublicChatHandlers,
  ) {}

  connect(): void {
    if (this.socket || this.closed) return
    const socket = new WebSocket(this.wsUrl, 'no-compression')
    this.socket = socket
    socket.onopen = () => this.authenticateOrWatch()
    socket.onmessage = (event) => this.handleRaw(String(event.data))
    socket.onerror = () => this.handlers.onStatus?.('CNC public chat connection failed.')
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      if (!this.closed) this.handlers.onStatus?.('CNC public chat disconnected.')
    }
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.socket = null
    this.pendingChat = []
  }

  sendChat(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    if (!this.authenticated) {
      if (!this.ensureAuthenticated()) return false
      this.pendingChat.push(trimmed)
      return true
    }
    return this.send({ msg: 'chat_msg', text: trimmed })
  }

  private authenticateOrWatch(): void {
    if (!this.ensureAuthenticated()) {
      this.watchBot()
    }
  }

  private ensureAuthenticated(): boolean {
    if (this.authenticated) return true
    if (this.authInFlight) return true
    const cookie = this.getLoginCookie()
    if (!cookie) return false
    if (!this.send({ msg: 'token_login', cookie })) return false
    this.send({ msg: 'set_login_cookie' })
    this.authInFlight = true
    return true
  }

  private handleRaw(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj['msgs'])) {
      for (const msg of obj['msgs']) this.handleMessage(msg as ServerMsg)
    } else {
      this.handleMessage(obj as ServerMsg)
    }
  }

  private handleMessage(msg: ServerMsg): void {
    switch (msg.msg) {
      case 'ping':
        this.send({ msg: 'pong' })
        break
      case 'login_success':
        this.authenticated = true
        this.authInFlight = false
        this.watchBot()
        this.flushPendingChat()
        break
      case 'login_cookie':
        this.handlers.onLoginCookie?.(msg.cookie, msg.expires)
        break
      case 'login_fail':
        this.authenticated = false
        this.authInFlight = false
        this.pendingChat = []
        this.handlers.onStatus?.('CNC public chat login failed.')
        this.watchBot()
        break
      case 'lobby_entry':
        if (msg.username === CNC_PUBLIC_CHAT_BOT) this.watchBot()
        break
      case 'watching_started':
        this.handlers.onStatus?.('Connected to CNC public chat.')
        break
      case 'chat':
        this.handlers.onChat(msg.content)
        break
      case 'update_spectators':
        this.handlers.onSpectators?.(msg.count, msg.names)
        break
    }
  }

  private watchBot(): void {
    this.send({ msg: 'watch', username: CNC_PUBLIC_CHAT_BOT })
  }

  private flushPendingChat(): void {
    for (const text of this.pendingChat.splice(0)) {
      this.send({ msg: 'chat_msg', text })
    }
  }

  private send(data: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(data))
    return true
  }
}
