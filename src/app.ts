import type { WsConnection } from './ws/connection'
import type { GameExit } from './ws/types'
import { buildLoginView } from './views/login'
import { buildLobbyView } from './views/lobby'
import { buildGameView, type SpectateTarget } from './views/game-view'
import type { TileLoader } from './game/tiles/tile-loader'

type AppState = 'login' | 'lobby' | 'game'

let state: AppState = 'login'
let conn: WsConnection | null = null
let root: HTMLElement
let currentUsername = ''
let currentIsGuest = false

export function initApp(appEl: HTMLElement): void {
  root = appEl
  showLogin()
}

function showLogin(): void {
  conn?.close()
  conn = null
  state = 'login'
  setView(buildLoginView((result) => {
    conn = result.conn
    currentUsername = result.username
    currentIsGuest = result.guest ?? false
    conn.onClose = () => showLogin()
    showLobby(currentUsername, currentIsGuest)
  }))
}

function showLobby(username: string, guest: boolean, exit?: GameExit): void {
  state = 'lobby'
  setView(buildLobbyView(
    conn!,
    username,
    guest,
    (spectating, loader) => showGame(spectating, loader),
    () => showLogin(),
    exit,
  ))
}

function showGame(spectating?: SpectateTarget, loader?: TileLoader): void {
  state = 'game'
  setView(buildGameView(
    conn!,
    (exit) => showLobby(currentUsername, currentIsGuest, exit),
    spectating,
    loader,
  ))
}

function setView(el: HTMLElement): void {
  root.textContent = ''
  root.appendChild(el)
}

export { state }
