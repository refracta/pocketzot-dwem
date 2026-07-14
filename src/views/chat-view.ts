import { cncUserinfo } from '../dwem/cnc-userinfo'

// WebTiles chat: bottom-sheet history + input, an entry chip (spectator count
// + unread badge), and a transient pill previewing messages while the sheet
// is closed. One instance per game view; game-view.ts feeds it `chat` and
// `update_spectators` messages and mounts chip/sheet/pill where the role
// (player vs spectator) wants them.
//
// Glyph conventions (no emoji — they fight the CRT aesthetic and render
// differently per platform): ⊙ = spectators (an eye), # = chat (IRC channel),
// * prefix = meta/server notices, » = send.

const HISTORY_CAP = 200
const PILL_MS = 4000
// Matches the #chat-pill opacity transition in style.css.
const PILL_FADE_MS = 400
const CNC_CHAT_ENTITY_RE = /^https:\/\/chat\.nemelex\.cards\/entities\/\d+\/?$/

export interface ChatViewOpts {
  onSend: (text: string) => void
  /** Sheet title. Defaults to the regular game chat channel. */
  title?: string
  /** Render CNC public-chat usernames with banner styling and the § prefix. */
  cncStyle?: boolean
  /** Unit tests can disable profile polling; live views should leave it on. */
  trackCncProfiles?: boolean
  /** Preserve leading whitespace for hosts that route " public" specially. */
  preserveSendWhitespace?: boolean
  /** Spectator role: chat is a primary feature of watching, so the chip is
   *  always present. Player role omits this — the chip earns its pixels only
   *  once someone is actually watching (fallback-only). */
  alwaysShowChip?: boolean
  /** Guest sessions can read chat but the server refuses their sends —
   *  lock the input with a sign-in hint instead of letting them find out
   *  by trying. */
  readOnly?: boolean
  /** Host veto for the transient pill — e.g. while a server overlay owns
   *  the screen, a floating preview over it is noise. Vetoed messages
   *  still count toward the unread badge, so nothing is lost. */
  pillAllowed?: () => boolean
}

export interface ChatHandleOpts {
  public?: boolean
  rich?: boolean
}

interface ChatLine {
  sender: string   // '' for meta/notice lines
  text: string
  meta: boolean
  public?: boolean
}

interface ParsedChat {
  sender: string
  text: string
  json?: Record<string, unknown>
}

interface CncChatEntity {
  type?: string
  file?: string
  item?: string
  color?: string
}

// The server sends pre-formatted HTML (`<span class='chat_sender'>…`). Parse
// it detached and rebuild from textContent — mirrors the reference client,
// which also re-renders the message text rather than trusting the HTML.
export function parseChatContent(content: string): ParsedChat {
  const div = document.createElement('div')
  div.innerHTML = content
  const sender = div.querySelector('.chat_sender')?.textContent ?? ''
  const msgSpan = div.querySelector('.chat_msg')
  const text = (msgSpan?.textContent ?? div.textContent ?? '').trim()
  let json: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      json = parsed as Record<string, unknown>
    }
  } catch {
    // Plain chat text.
  }
  return { sender, text, json }
}

export function findCncChatEntityUrl(text: string): string | null {
  const url = text.trim()
  return CNC_CHAT_ENTITY_RE.test(url) ? url : null
}

// Linkify bare http(s) URLs in message text — people paste morgue and
// scoring links constantly. Mirrors the reference (chat.js runs linkify
// over the chat_msg text), minus its ftp/irc schemes, dead weight on a
// phone. Text-parsed with DOM-built anchors, so no HTML risk.
const URL_RE = /https?:\/\/\S+/g

// Trim trailing characters that belong to the surrounding sentence, not the
// URL. Plain punctuation always goes; a closing bracket goes only when it's
// unbalanced within the URL — so `…/Vault_(DCSS)` keeps its `)` while a link
// wrapped like `(see …/foo)` sheds the stray one. (GitHub's autolink rule.)
function trimUrlTail(url: string): string {
  let end = url.length
  while (end > 0) {
    const c = url[end - 1]
    if (')]'.includes(c)) {
      const open = c === ')' ? '(' : '['
      const inner = url.slice(0, end)
      const opens = inner.split(open).length - 1
      const closes = inner.split(c).length - 1
      if (closes <= opens) break  // balanced — the bracket is part of the path
    } else if (!`.,!?;:'"`.includes(c)) {
      break
    }
    end--
  }
  return url.slice(0, end)
}

interface SenderSpanOpts {
  cncStyle?: boolean
  profileUsername?: string
  trackCncProfiles?: boolean
}

// Sender tag in accent color; shared by history lines and the transient pill
// so the costume can't drift between them. CNC public chat mirrors DWEM: `§`
// plus the current banner-styled username. Plain room chat deliberately has
// no IRC angle brackets.
function senderSpan(name: string, opts: SenderSpanOpts = {}): HTMLSpanElement {
  const s = document.createElement('span')
  s.className = 'chat-line-sender'
  if (!opts.cncStyle) {
    s.textContent = name
    return s
  }

  const profileUsername = opts.profileUsername ?? name
  const clean = cncUserinfo.normalizeUsername(profileUsername)
  if (!clean) {
    s.textContent = name
    return s
  }

  s.append('§')
  const styled = document.createElement('span')
  styled.innerHTML = cncUserinfo.applyStyledUsername(clean, { track: opts.trackCncProfiles !== false })
  s.append(...Array.from(styled.childNodes))
  if (opts.profileUsername && name !== opts.profileUsername) {
    s.append(name.slice(opts.profileUsername.length))
  }
  return s
}

function appendLinkified(el: HTMLElement, text: string): void {
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrlTail(m[0])
    el.append(text.slice(last, m.index))
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = url
    el.append(a)
    last = m.index + url.length
  }
  el.append(text.slice(last))
}

async function buildCncRichChat(
  parsed: ParsedChat,
  useCncStyle: boolean,
  trackCncProfiles: boolean,
): Promise<Array<Node | string> | null> {
  const discord = buildDiscordChat(parsed)
  if (discord) return discord

  const entityUrl = findCncChatEntityUrl(parsed.text)
  if (!entityUrl) return null

  const response = await fetch(entityUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const entity = await response.json() as CncChatEntity
  return buildEntityChat(parsed.sender, entity, useCncStyle, trackCncProfiles)
}

function buildDiscordChat(parsed: ParsedChat): Array<Node | string> | null {
  const json = parsed.json
  if (!json || typeof json['sender'] !== 'string') return null

  const sender = json['sender']
  const nodes: Array<Node | string> = []
  const discord = document.createElement('span')
  discord.className = 'chat-line-discord'
  discord.textContent = 'ⓓ'
  nodes.push(discord, senderSpan(sender), ' ')

  if (json['msg'] === 'discord-attachment') {
    const url = typeof json['url'] === 'string' ? json['url'] : ''
    const contentType = typeof json['contentType'] === 'string' ? json['contentType'] : ''
    if (url && contentType.startsWith('image/')) {
      nodes.push(renderChatImage(url))
    } else if (url) {
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = '[FILE URL]'
      nodes.push(link)
    }
  } else {
    const text = typeof json['text'] === 'string' ? json['text'] : parsed.text
    const body = document.createElement('span')
    body.className = 'chat-line-pre'
    appendLinkified(body, text)
    nodes.push(body)
  }

  return nodes
}

function buildEntityChat(
  sender: string,
  entity: CncChatEntity,
  useCncStyle: boolean,
  trackCncProfiles: boolean,
): Array<Node | string> | null {
  const file = entity.file ?? ''
  const type = entity.type ?? 'image'
  const owner = sender || 'Someone'
  const label = type === 'item'
    ? `${owner}'s Item`
    : `${owner}'s ${capitalize(type)}`

  const nodes: Array<Node | string> = [
    senderSpan(label, { cncStyle: useCncStyle, profileUsername: owner, trackCncProfiles }),
    ' ',
  ]
  if (type === 'item') {
    const item = document.createElement('span')
    item.className = 'chat-rich-item'
    const image = renderChatImage(file)
    image.classList.add('chat-rich-item-image')
    item.appendChild(image)
    const name = document.createElement('span')
    name.className = 'chat-rich-item-name'
    if (entity.color) name.style.color = entity.color
    name.textContent = entity.item ?? 'item'
    item.appendChild(name)
    nodes.push(item)
  } else {
    nodes.push(renderChatImage(file))
  }
  return nodes
}

function renderChatImage(url: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'chat-rich-image-wrap'
  if (!url) {
    wrap.textContent = '[missing image]'
    return wrap
  }
  const imageUrl = resolveCncChatAssetUrl(url)
  const loading = document.createElement('span')
  loading.className = 'chat-rich-loading'
  loading.textContent = 'Loading image...'
  const image = document.createElement('img')
  image.className = 'chat-rich-image'
  image.alt = ''
  image.hidden = true
  const showImage = (): void => {
    loading.remove()
    image.hidden = false
  }
  image.addEventListener('load', showImage)
  image.addEventListener('error', () => {
    loading.textContent = 'Failed to load image.'
  })
  image.addEventListener('click', () => {
    window.open(imageUrl, '_blank', 'noopener')
  })
  image.src = imageUrl
  if (image.complete && image.naturalWidth > 0) showImage()
  wrap.append(loading, image)
  return wrap
}

function resolveCncChatAssetUrl(url: string): string {
  try {
    return new URL(url, 'https://chat.nemelex.cards/').href
  } catch {
    return url
  }
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

export class ChatView {
  /** Bottom sheet (history + input). Mounted once, hidden until opened. */
  readonly sheet: HTMLElement
  /** Entry chip: `⊙N  #` with an unread badge. Host decides placement. */
  readonly chip: HTMLButtonElement
  /** Transient one-line preview shown while the sheet is closed. */
  readonly pill: HTMLElement

  private historyEl: HTMLElement
  private headerNamesEl: HTMLElement
  private inputEl: HTMLInputElement
  private chipEyeEl: HTMLElement
  private chipBadgeEl: HTMLElement
  private unread = 0
  private spectatorCount = 0
  private open_ = false
  private pillTimer: ReturnType<typeof setTimeout> | undefined
  private hidden = false  // super_hide_chat
  private opts: ChatViewOpts

  constructor(opts: ChatViewOpts) {
    this.opts = opts

    this.chip = document.createElement('button')
    this.chip.id = 'chat-chip'
    this.chip.setAttribute('aria-label', 'Chat')
    this.chipEyeEl = document.createElement('span')
    const hash = document.createElement('span')
    hash.className = 'chat-chip-hash'
    hash.textContent = '#'
    this.chipBadgeEl = document.createElement('span')
    this.chipBadgeEl.className = 'chat-chip-badge'
    this.chip.append(this.chipEyeEl, hash, this.chipBadgeEl)
    this.chip.addEventListener('click', () => this.toggle())
    this.chip.style.display = 'none'

    this.pill = document.createElement('div')
    this.pill.id = 'chat-pill'
    this.pill.style.display = 'none'
    this.pill.addEventListener('click', () => { this.hidePill(); this.openSheet() })

    this.sheet = document.createElement('div')
    this.sheet.id = 'chat-sheet'
    this.sheet.style.display = 'none'

    const header = document.createElement('div')
    header.className = 'chat-header'
    const title = document.createElement('span')
    title.className = 'chat-title'
    title.textContent = opts.title ?? '#chat'
    this.headerNamesEl = document.createElement('span')
    this.headerNamesEl.className = 'chat-names'
    // The one-line list ellipsizes past a few spectators; tapping it unfolds
    // the full list in place (wrapped, scroll-capped — see .chat-names-open),
    // tap again to fold. The ellipsis itself is the affordance; no chevron.
    this.headerNamesEl.addEventListener('click', () => {
      if (!this.headerNamesEl.textContent) return
      this.headerNamesEl.classList.toggle('chat-names-open')
    })
    const close = document.createElement('button')
    close.className = 'chat-close'
    close.setAttribute('aria-label', 'Close chat')
    close.textContent = '×'
    close.addEventListener('click', () => this.closeSheet())
    header.append(title, this.headerNamesEl, close)

    this.historyEl = document.createElement('div')
    this.historyEl.className = 'chat-history'

    const inputRow = document.createElement('div')
    inputRow.className = 'chat-input-row'
    this.inputEl = document.createElement('input')
    this.inputEl.className = 'chat-input'
    this.inputEl.type = 'text'
    this.inputEl.autocomplete = 'off'
    this.inputEl.autocapitalize = 'off'
    this.inputEl.spellcheck = false
    this.inputEl.placeholder = 'message…'
    // Keys typed into chat must never reach the game key handler
    // (document-level keydown) — a hardware-keyboard "hi" would otherwise
    // quaff a potion. Enter sends; Escape drops focus (second Escape, now
    // unfocused, falls to the host's chat-open check and closes the sheet).
    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') this.send()
      else if (e.key === 'Escape') this.inputEl.blur()
    })
    const sendBtn = document.createElement('button')
    sendBtn.className = 'chat-send'
    sendBtn.setAttribute('aria-label', 'Send')
    sendBtn.textContent = '»'
    sendBtn.addEventListener('click', () => this.send())
    if (opts.readOnly) {
      this.inputEl.disabled = true
      this.inputEl.placeholder = 'sign in to chat'
      sendBtn.disabled = true
    }
    inputRow.append(this.inputEl, sendBtn)

    this.sheet.append(header, this.historyEl, inputRow)
    // Taps inside the sheet must not fall through to #game-view's map/input
    // handlers underneath.
    this.sheet.addEventListener('pointerdown', (e) => e.stopPropagation())

    this.syncChip()
  }

  get isOpen(): boolean { return this.open_ }
  /** True while the user is typing in the chat input. Hosts must not pull
   *  focus elsewhere during this — a programmatic focus/blur drops the
   *  phone keyboard mid-word. */
  get inputFocused(): boolean { return document.activeElement === this.inputEl }

  handleChat(content: string, meta: boolean, opts: ChatHandleOpts = {}): void {
    if (this.hidden) return
    const parsed = parseChatContent(content)
    const { sender, text } = parsed
    if (!text) return
    const line: ChatLine = { sender, text, meta: meta || !sender, public: opts.public }
    const el = this.appendLine(line)
    if (opts.rich && line.public && !line.meta) {
      void this.renderRichLine(el, parsed, line.public).catch((err) => {
        console.warn('[PocketZot][Chat] failed to render rich chat message', err)
      })
    }
    if (!this.open_ && !line.meta) {
      this.unread++
      this.showPill(line)
    }
    this.syncChip()
  }

  handleSpectators(count: number, names: string): void {
    this.spectatorCount = count
    // names arrives as HTML (reference injects it wholesale); we only want
    // the display text.
    const div = document.createElement('div')
    div.innerHTML = names
    const plain = (div.textContent ?? '').trim()
    this.headerNamesEl.textContent = plain ? `⊙ ${plain}` : ''
    if (!plain) this.headerNamesEl.classList.remove('chat-names-open')
    this.syncChip()
  }

  /** super_hide_chat: remove all chat UI until the next game. */
  superHide(): void {
    this.hidden = true
    this.closeSheet()
    this.chip.style.display = 'none'
    this.hidePill()
  }

  openSheet(): void {
    if (this.hidden || this.open_) return
    this.open_ = true
    this.unread = 0
    this.hidePill()
    this.sheet.style.display = ''
    this.historyEl.scrollTop = this.historyEl.scrollHeight
    this.syncChip()
  }

  closeSheet(): void {
    if (!this.open_) return
    this.open_ = false
    this.inputEl.blur()
    // Fold the spectator list so the next open starts compact.
    this.headerNamesEl.classList.remove('chat-names-open')
    this.sheet.style.display = 'none'
    this.syncChip()
  }

  toggle(): void { this.open_ ? this.closeSheet() : this.openSheet() }

  private send(): void {
    const raw = this.inputEl.value
    const text = raw.trim()
    if (!text || this.opts.readOnly) return
    this.opts.onSend(this.opts.preserveSendWhitespace ? raw : text)
    this.inputEl.value = ''
    // The server echoes the message back to everyone including the sender,
    // so no local append — the round trip is the delivery receipt.
  }

  private appendLine(line: ChatLine): HTMLElement {
    const atBottom = this.historyEl.scrollHeight - this.historyEl.scrollTop
      - this.historyEl.clientHeight < 4
    const el = document.createElement('div')
    el.className = line.meta
      ? 'chat-line chat-line-meta'
      : `chat-line${line.public ? ' chat-line-public' : ''}`
    if (line.meta) {
      el.append('* ')
      appendLinkified(el, line.text)
    } else {
      // No ':' glue: sender style and message spacing are enough, and DCSS
      // game messages do not begin with a styled sender marker.
      el.append(this.senderSpan(line.sender, line.public), ' ')
      appendLinkified(el, line.text)
    }
    this.historyEl.appendChild(el)
    while (this.historyEl.childElementCount > HISTORY_CAP) {
      this.historyEl.firstElementChild?.remove()
    }
    if (atBottom) this.historyEl.scrollTop = this.historyEl.scrollHeight
    return el
  }

  private async renderRichLine(el: HTMLElement, parsed: ParsedChat, publicChat: boolean): Promise<void> {
    const rich = await buildCncRichChat(
      parsed,
      !!this.opts.cncStyle && publicChat,
      this.opts.trackCncProfiles !== false,
    )
    if (!rich || !el.isConnected) return
    const atBottom = this.historyEl.scrollHeight - this.historyEl.scrollTop
      - this.historyEl.clientHeight < 4
    el.replaceChildren(...rich)
    if (atBottom) this.historyEl.scrollTop = this.historyEl.scrollHeight
  }

  private showPill(line: ChatLine): void {
    if (this.opts.pillAllowed && !this.opts.pillAllowed()) return
    // Same <name> costume as the sheet's history lines. The inner div
    // carries the two-line clamp (see .chat-pill-text in style.css).
    const text = document.createElement('div')
    text.className = 'chat-pill-text'
    text.append(this.senderSpan(line.sender, line.public), ` ${line.text}`)
    this.pill.replaceChildren(text)
    // A message landing mid-fade recovers: removing the class transitions
    // opacity back up, and the fresh timer restarts the full display window.
    this.pill.classList.remove('chat-pill-fade')
    this.pill.style.display = ''
    clearTimeout(this.pillTimer)
    this.pillTimer = setTimeout(() => this.fadePill(), PILL_MS)
  }

  /** Expiry path: fade, then hide once the opacity transition lands. */
  private fadePill(): void {
    this.pill.classList.add('chat-pill-fade')
    this.pillTimer = setTimeout(() => this.hidePill(), PILL_FADE_MS)
  }

  /** Dismiss an in-flight pill instantly (tap-to-open does this, and the
   *  host calls it when a server overlay takes the screen). */
  hidePill(): void {
    clearTimeout(this.pillTimer)
    this.pill.classList.remove('chat-pill-fade')
    this.pill.style.display = 'none'
  }

  private syncChip(): void {
    if (this.hidden) return
    // Fallback-only (player role): the chip earns its pixels only while
    // someone is watching, or a real message went unread (a spectator may chat
    // and leave before the player looks). NOT mere history: the server sends
    // a meta "/help" notice on every game start, and join/leave notices are
    // meta too — none of that should summon chat UI for an unwatched player.
    // Spectator role opts out via alwaysShowChip.
    const show = this.opts.alwaysShowChip
      || this.spectatorCount > 0 || this.unread > 0
    this.chip.style.display = show ? '' : 'none'
    // No count yet (or genuinely zero): show a bare `#` rather than a
    // misleading ⊙0 — the join-time update_spectators can lag or be missed.
    this.chipEyeEl.textContent = this.spectatorCount > 0 ? `⊙${this.spectatorCount}` : ''
    const n = this.unread
    this.chipBadgeEl.textContent = n > 0 ? (n > 9 ? '9+' : String(n)) : ''
    this.chipBadgeEl.style.display = n > 0 ? '' : 'none'
    this.chip.classList.toggle('chat-chip-open', this.open_)
  }

  private senderSpan(name: string, publicChat = false): HTMLSpanElement {
    return senderSpan(name, {
      cncStyle: !!this.opts.cncStyle && publicChat,
      trackCncProfiles: this.opts.trackCncProfiles,
    })
  }
}
