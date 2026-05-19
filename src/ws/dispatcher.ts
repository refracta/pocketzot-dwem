import type { ServerMsg } from './types'

type Handler<T extends ServerMsg> = (msg: T) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = Handler<any>

export class Dispatcher {
  private handlers = new Map<string, AnyHandler[]>()

  on<T extends ServerMsg>(type: T['msg'], handler: Handler<T>): () => void {
    const list = this.handlers.get(type) ?? []
    list.push(handler as AnyHandler)
    this.handlers.set(type, list)
    return () => this.off(type, handler)
  }

  off<T extends ServerMsg>(type: T['msg'], handler: Handler<T>): void {
    const list = this.handlers.get(type)
    if (!list) return
    const idx = list.indexOf(handler as AnyHandler)
    if (idx !== -1) list.splice(idx, 1)
  }

  dispatch(msg: ServerMsg): void {
    const list = this.handlers.get(msg.msg)
    if (!list) return
    for (const h of list) h(msg)
  }

  clear(): void {
    this.handlers.clear()
  }
}
