import type { ClientMsg, ServerMsg } from '../ws/types'

export type IncomingMessage = ServerMsg & Record<string, unknown>
export type OutgoingMessage = ClientMsg & Record<string, unknown>

type IncomingHandler = (msg: IncomingMessage) => boolean | void
type OutgoingHandler = (msgName: string, data: OutgoingMessage) => boolean | void
type IncomingSink = (msg: IncomingMessage) => void
type OutgoingSink = (msg: OutgoingMessage) => void

interface HandlerEntry<T> {
  identifier: string
  handler: T
  priority: number
}

class HandlerList<T> {
  handlers: HandlerEntry<T>[] = []

  addHandler(identifier: string, handler: T, priority = 0): void {
    this.removeHandler(identifier)
    this.handlers.push({ identifier, handler, priority })
    this.handlers.sort((a, b) => b.priority - a.priority)
  }

  removeHandler(identifier: string): void {
    this.handlers = this.handlers.filter((entry) => entry.identifier !== identifier)
  }
}

interface IncomingHook {
  (msg: IncomingMessage): void
  before: HandlerList<IncomingHandler>
  after: HandlerList<IncomingHandler>
}

interface OutgoingHook {
  (msgName: string, data: OutgoingMessage): void
  before: HandlerList<OutgoingHandler>
  after: HandlerList<OutgoingHandler>
}

export class IOHook {
  readonly handle_message: IncomingHook
  readonly send_message: OutgoingHook

  private incomingSink: IncomingSink = () => {}

  constructor() {
    const incoming = ((msg: IncomingMessage) => this.handleMessage(msg)) as IncomingHook
    incoming.before = new HandlerList<IncomingHandler>()
    incoming.after = new HandlerList<IncomingHandler>()
    this.handle_message = incoming

    const outgoing = ((msgName: string, data: OutgoingMessage) => {
      this.sendMessage({ ...data, msg: msgName } as OutgoingMessage, () => {})
    }) as OutgoingHook
    outgoing.before = new HandlerList<OutgoingHandler>()
    outgoing.after = new HandlerList<OutgoingHandler>()
    this.send_message = outgoing
  }

  setIncomingSink(sink: IncomingSink): void {
    this.incomingSink = sink
  }

  clearIncomingSink(sink: IncomingSink): void {
    if (this.incomingSink === sink) this.incomingSink = () => {}
  }

  handleMessage(msg: IncomingMessage): void {
    let cancel = false
    for (const { handler } of this.handle_message.before.handlers) {
      try {
        cancel = Boolean(handler(msg)) || cancel
      } catch (err) {
        console.error('[DWEM][IOHook] incoming before handler failed', err)
      }
    }
    if (cancel) return

    this.incomingSink(msg)

    for (const { handler } of this.handle_message.after.handlers) {
      try {
        handler(msg)
      } catch (err) {
        console.error('[DWEM][IOHook] incoming after handler failed', err)
      }
    }
  }

  sendMessage(msg: OutgoingMessage, sink: OutgoingSink): boolean {
    const msgName = String(msg.msg)
    let cancel = false
    for (const { handler } of this.send_message.before.handlers) {
      try {
        cancel = Boolean(handler(msgName, msg)) || cancel
      } catch (err) {
        console.error('[DWEM][IOHook] outgoing before handler failed', err)
      }
    }
    if (cancel) return false

    sink(msg)

    for (const { handler } of this.send_message.after.handlers) {
      try {
        handler(msgName, msg)
      } catch (err) {
        console.error('[DWEM][IOHook] outgoing after handler failed', err)
      }
    }
    return true
  }
}

export const ioHook = new IOHook()
