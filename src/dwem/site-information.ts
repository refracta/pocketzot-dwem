import type { WsConnection } from '../ws/connection'

export interface DwemContext {
  conn: WsConnection | null
  username: string
  guest: boolean
  spectating?: { username: string }
}

export class SiteInformation {
  conn: WsConnection | null = null
  current_user = ''
  watching = false
  watching_username = ''
  playing = false
  current_hash = '#lobby'

  setContext(ctx: DwemContext): void {
    this.conn = ctx.conn
    this.current_user = ctx.username
    this.watching = Boolean(ctx.spectating)
    this.watching_username = ctx.spectating?.username ?? ''
    this.playing = Boolean(ctx.conn) && !ctx.spectating && this.current_hash === '#game'
  }

  setLobby(conn: WsConnection | null, username: string, guest: boolean): void {
    this.current_hash = '#lobby'
    this.setContext({ conn, username, guest })
  }

  setGame(conn: WsConnection | null, username: string, guest: boolean, spectating?: { username: string }): void {
    this.current_hash = '#game'
    this.setContext({ conn, username, guest, spectating })
    this.playing = Boolean(conn) && !spectating
  }

  clear(): void {
    this.conn = null
    this.current_user = ''
    this.watching = false
    this.watching_username = ''
    this.playing = false
    this.current_hash = '#login'
  }
}

export const siteInformation = new SiteInformation()
