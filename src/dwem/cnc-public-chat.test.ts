// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CncPublicChatClient, CNC_PUBLIC_CHAT_BOT, isCncPublicChatAvailable } from './cnc-public-chat'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CncPublicChatClient', () => {
  it('token-logins, watches the public chat bot, receives chat, and sends public chat', () => {
    const sockets: FakeWebSocket[] = []
    vi.stubGlobal('WebSocket', makeFakeWebSocket(sockets))
    const chats: string[] = []
    const statuses: string[] = []
    const cookies: Array<{ cookie: string; days: number }> = []

    const client = new CncPublicChatClient(
      'wss://crawl.nemelex.cards/socket',
      () => 'cookie-1',
      {
        onChat: (content) => chats.push(content),
        onStatus: (text) => statuses.push(text),
        onLoginCookie: (cookie, days) => cookies.push({ cookie, days }),
      },
    )
    client.connect()

    const socket = sockets[0]!
    socket.onopen?.()
    expect(socket.sent.map(parseSent)).toEqual([
      { msg: 'token_login', cookie: 'cookie-1' },
      { msg: 'set_login_cookie' },
    ])

    socket.emit(JSON.stringify({ msg: 'login_success', username: 'labter' }))
    socket.emit(JSON.stringify({ msg: 'login_cookie', cookie: 'cookie-2', expires: 7 }))
    socket.emit(JSON.stringify({ msgs: [
      { msg: 'ping' },
      { msg: 'watching_started', username: CNC_PUBLIC_CHAT_BOT },
      { msg: 'chat', content: '<span class="chat_msg">hello</span>' },
    ] }))

    expect(client.sendChat(' public hello ')).toBe(true)
    expect(socket.sent.map(parseSent)).toEqual([
      { msg: 'token_login', cookie: 'cookie-1' },
      { msg: 'set_login_cookie' },
      { msg: 'watch', username: CNC_PUBLIC_CHAT_BOT },
      { msg: 'pong' },
      { msg: 'chat_msg', text: 'public hello' },
    ])
    expect(chats).toEqual(['<span class="chat_msg">hello</span>'])
    expect(statuses).toContain('Connected to CNC public chat.')
    expect(cookies).toEqual([{ cookie: 'cookie-2', days: 7 }])
  })

  it('reports availability only for CNC-compatible servers', () => {
    expect(isCncPublicChatAvailable('wss://crawl.nemelex.cards/socket')).toBe(true)
    expect(isCncPublicChatAvailable('wss://test.nemelex.cards/socket')).toBe(true)
    expect(isCncPublicChatAvailable('wss://crawl.akrasiac.org:8443/socket')).toBe(false)
  })
})

function parseSent(raw: string): unknown {
  return JSON.parse(raw) as unknown
}

function makeFakeWebSocket(sockets: FakeWebSocket[]): typeof WebSocket {
  return class extends FakeWebSocket {
    constructor(url: string, protocol?: string | string[]) {
      super(url, protocol)
      sockets.push(this)
    }
  } as unknown as typeof WebSocket
}

class FakeWebSocket {
  static readonly OPEN = 1
  readonly sent: string[] = []
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(
    readonly url: string,
    readonly protocol?: string | string[],
  ) {}

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  emit(data: string): void {
    this.onmessage?.({ data })
  }
}
