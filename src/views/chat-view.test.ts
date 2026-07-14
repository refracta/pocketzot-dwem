// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest'
import { ChatView, findCncChatEntityUrl, type ChatViewOpts } from './chat-view'

// Wire shapes below are verbatim captures from crawl.dcss.io (2026-07):
// the server pre-formats chat as sender/msg spans, marks notices with
// meta:true (no sender span), and linkifies spectator names to scoring pages.
const WIRE_CHAT =
  "<span class='chat_sender'>gammafunk</span>: <span class='chat_msg'>oh nice, a MiFi with a broad axe already</span>"
const WIRE_META =
  "<span class='chat_msg'>rakuen is now watching</span>"
const WIRE_NAMES_LINKIFIED =
  "<a href='http://crawl.akrasiac.org/scoring/players/roinerr.html' target='_blank' class='player'>RoinerR</a>, " +
  "<a href='http://crawl.akrasiac.org/scoring/players/tdpma.html' target='_blank' class='watcher'>tdpma</a>"

function make(opts: Omit<ChatViewOpts, 'onSend'> = {}) {
  const sent: string[] = []
  const view = new ChatView({ onSend: (t) => sent.push(t), trackCncProfiles: false, ...opts })
  // Connected DOM so events bubble like in the app.
  document.body.append(view.sheet, view.chip, view.pill)
  return { view, sent }
}

function chipVisible(view: ChatView): boolean {
  return view.chip.style.display !== 'none'
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('wire parsing and rendering', () => {
  it('renders sender and text from the server-formatted spans', () => {
    const { view } = make()
    view.handleChat(WIRE_CHAT, false)
    const line = view.sheet.querySelector('.chat-line')!
    expect(line.textContent).toBe('gammafunk oh nice, a MiFi with a broad axe already')
    expect(line.querySelector('.chat-line-sender')!.textContent).toBe('gammafunk')
  })

  it('does not put the public-chat marker on room chat even when CNC support is enabled', () => {
    const { view } = make({ cncStyle: true })
    view.handleChat(WIRE_CHAT, false)
    const line = view.sheet.querySelector('.chat-line')!
    expect(line.textContent).toBe('gammafunk oh nice, a MiFi with a broad axe already')
    expect(line.querySelector('.cnc-profile-username')).toBeNull()
  })

  it('renders public CNC senders with the public-chat marker and banner span', () => {
    const { view } = make({ cncStyle: true })
    view.handleChat(WIRE_CHAT, false, { public: true })
    const line = view.sheet.querySelector('.chat-line')!
    expect(line.textContent).toBe('§gammafunk oh nice, a MiFi with a broad axe already')
    expect(line.querySelector('.cnc-profile-username')?.textContent).toBe('gammafunk')
  })

  it('renders meta notices dim with a * prefix', () => {
    const { view } = make({ cncStyle: true })
    view.handleChat(WIRE_META, true)
    const line = view.sheet.querySelector('.chat-line')!
    expect(line.classList.contains('chat-line-meta')).toBe(true)
    expect(line.textContent).toBe('* rakuen is now watching')
  })

  it('treats a senderless message as meta even without the flag', () => {
    // Defensive: some notices arrive with meta omitted; no sender span is
    // the other reliable signal.
    const { view } = make({ cncStyle: true })
    view.handleChat(WIRE_META, false)
    expect(view.sheet.querySelector('.chat-line-meta')).not.toBeNull()
  })

  it('renders message text as text, not HTML', () => {
    const { view } = make()
    view.handleChat(
      "<span class='chat_sender'>evil</span>: <span class='chat_msg'>&lt;img src=x onerror=alert(1)&gt;</span>",
      false,
    )
    expect(view.sheet.querySelector('.chat-line img')).toBeNull()
    expect(view.sheet.querySelector('.chat-line')!.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('extracts plain names from the linkified spectator list', () => {
    const { view } = make()
    view.handleSpectators(1, WIRE_NAMES_LINKIFIED)
    expect(view.sheet.querySelector('.chat-names')!.textContent).toBe('⊙ RoinerR, tdpma')
    expect(view.chip.textContent).toContain('⊙1')
  })

  it('clears the names row when the spectator list empties', () => {
    const { view } = make()
    view.handleSpectators(1, WIRE_NAMES_LINKIFIED)
    view.handleSpectators(0, '')
    expect(view.sheet.querySelector('.chat-names')!.textContent).toBe('')
  })

  it('tapping the spectator list unfolds it, tapping again (or closing) folds it', () => {
    const { view } = make()
    const names = view.sheet.querySelector('.chat-names') as HTMLElement
    view.openSheet()
    view.handleSpectators(2, WIRE_NAMES_LINKIFIED)
    names.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(names.classList.contains('chat-names-open')).toBe(true)
    // A join/leave update mid-read must not fold the list back.
    view.handleSpectators(3, WIRE_NAMES_LINKIFIED)
    expect(names.classList.contains('chat-names-open')).toBe(true)
    names.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(names.classList.contains('chat-names-open')).toBe(false)
    // Reopening starts compact.
    names.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    view.closeSheet()
    expect(names.classList.contains('chat-names-open')).toBe(false)
  })

  it('an empty names row has nothing to unfold', () => {
    const { view } = make()
    const names = view.sheet.querySelector('.chat-names') as HTMLElement
    names.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(names.classList.contains('chat-names-open')).toBe(false)
  })

  it('linkifies pasted URLs as safe anchors, keeping sentence punctuation out', () => {
    const { view } = make()
    view.handleChat(
      "<span class='chat_sender'>gammafunk</span>: <span class='chat_msg'>morgue at http://crawl.akrasiac.org/rawdata/rr/morgue-rr.txt, rip</span>",
      false,
    )
    const a = view.sheet.querySelector('.chat-line a') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('http://crawl.akrasiac.org/rawdata/rr/morgue-rr.txt')
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
    // The full line survives intact around the anchor — trailing ", rip"
    // stays text, and the comma is not part of the link.
    expect(view.sheet.querySelector('.chat-line')!.textContent)
      .toBe('gammafunk morgue at http://crawl.akrasiac.org/rawdata/rr/morgue-rr.txt, rip')
  })

  it('keeps a balanced trailing paren inside the URL, sheds an unbalanced one', () => {
    const { view } = make()
    // A wiki link whose path legitimately ends in ')' must survive whole…
    view.handleChat(
      "<span class='chat_sender'>x</span>: <span class='chat_msg'>see https://crawl.chaosforge.org/Vault_(DCSS)</span>",
      false,
    )
    // …while a link merely wrapped in parens sheds the stray closer.
    view.handleChat(
      "<span class='chat_sender'>x</span>: <span class='chat_msg'>(morgue: http://crawl.akrasiac.org/rawdata/rr/morgue-rr.txt)</span>",
      false,
    )
    const [balanced, wrapped] = view.sheet.querySelectorAll('.chat-line a')
    expect(balanced.getAttribute('href')).toBe('https://crawl.chaosforge.org/Vault_(DCSS)')
    expect(wrapped.getAttribute('href')).toBe('http://crawl.akrasiac.org/rawdata/rr/morgue-rr.txt')
  })

  it('does not linkify schemeless or non-http text', () => {
    const { view } = make()
    view.handleChat(
      "<span class='chat_sender'>x</span>: <span class='chat_msg'>see cbro.berotato.org or irc://irc.libera.chat/##crawl</span>",
      false,
    )
    expect(view.sheet.querySelector('.chat-line a')).toBeNull()
  })

  it('recognizes exact CNC rich-chat entity URLs', () => {
    expect(findCncChatEntityUrl('https://chat.nemelex.cards/entities/123')).toBe('https://chat.nemelex.cards/entities/123')
    expect(findCncChatEntityUrl('see https://chat.nemelex.cards/entities/123')).toBeNull()
    expect(findCncChatEntityUrl('https://example.com/entities/123')).toBeNull()
  })

  it('renders CNC item entity chat when rich mode is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        type: 'item',
        file: '/files/item.png',
        item: '+2 pair of gloves',
        color: 'rgb(255, 255, 0)',
      }),
    })))
    const { view } = make({ cncStyle: true })
    view.handleChat(
      "<span class='chat_sender'>labter</span>: <span class='chat_msg'>https://chat.nemelex.cards/entities/42</span>",
      false,
      { public: true, rich: true },
    )

    await vi.waitFor(() => {
      expect(view.sheet.querySelector('.chat-rich-item-name')?.textContent).toBe('+2 pair of gloves')
    })
    const line = view.sheet.querySelector('.chat-line')!
    expect(line.classList.contains('chat-line-public')).toBe(true)
    expect(line.textContent).toContain("§labter's Item")
    expect(line.querySelector('.cnc-profile-username')?.textContent).toBe('labter')
    expect(line.querySelector('img')?.getAttribute('src')).toBe('https://chat.nemelex.cards/files/item.png')
    expect(line.querySelector('img')?.getAttribute('loading')).toBeNull()
  })

  it('does not render room chat as CNC rich public chat', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { view } = make({ cncStyle: true })
    view.handleChat(
      "<span class='chat_sender'>labter</span>: <span class='chat_msg'>https://chat.nemelex.cards/entities/42</span>",
      false,
      { rich: true },
    )

    const line = view.sheet.querySelector('.chat-line')!
    expect(line.textContent).toBe('labter https://chat.nemelex.cards/entities/42')
    expect(line.querySelector('.cnc-profile-username')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders Discord bridge JSON chat when rich mode is enabled', async () => {
    const { view } = make()
    view.handleChat(
      '<span class="chat_sender">CNCPublicChat</span>: <span class="chat_msg">{"msg":"discord","sender":"stone_soup","text":"hello\\nhttps://example.com/a.png"}</span>',
      false,
      { public: true, rich: true },
    )

    await vi.waitFor(() => {
      expect(view.sheet.querySelector('.chat-line-discord')?.textContent).toBe('ⓓ')
    })
    expect(view.sheet.querySelector('.chat-line')?.textContent).toContain('ⓓstone_soup')
    expect(view.sheet.querySelector('.chat-line a')?.getAttribute('href')).toBe('https://example.com/a.png')
  })

  it('caps the history DOM at 200 lines', () => {
    const { view } = make()
    for (let i = 0; i < 205; i++) view.handleChat(WIRE_CHAT, false)
    expect(view.sheet.querySelectorAll('.chat-line').length).toBe(200)
  })
})

describe('chip visibility — player role (fallback-only)', () => {
  it('starts hidden and stays hidden through meta-only traffic', () => {
    const { view } = make()
    expect(chipVisible(view)).toBe(false)
    // The server sends a meta "/help" notice on every game start — it must
    // not summon chat UI for an unwatched player.
    view.handleChat("<span class='chat_msg'>'/help' to see available chat commands</span>", true)
    expect(chipVisible(view)).toBe(false)
  })

  it('appears while watched, disappears when the spectator leaves', () => {
    const { view } = make()
    view.handleSpectators(1, WIRE_NAMES_LINKIFIED)
    expect(chipVisible(view)).toBe(true)
    expect(view.chip.textContent).toContain('⊙1')
    view.handleSpectators(0, '')
    expect(chipVisible(view)).toBe(false)
  })

  it('a real unread message keeps the chip alive after the spectator leaves', () => {
    const { view } = make()
    view.handleSpectators(1, WIRE_NAMES_LINKIFIED)
    view.handleChat(WIRE_CHAT, false)
    view.handleSpectators(0, '')
    expect(chipVisible(view)).toBe(true) // unread badge still owed
    view.openSheet() // reading it clears the debt…
    view.closeSheet()
    expect(chipVisible(view)).toBe(false) // …and the chip retires
  })
})

describe('chip visibility — spectator role (always on)', () => {
  it('is visible from construction, count-less until told otherwise', () => {
    const { view } = make({ alwaysShowChip: true })
    expect(chipVisible(view)).toBe(true)
    // Bare # rather than a misleading ⊙0 while the count is unknown.
    expect(view.chip.textContent).toBe('#')
    view.handleSpectators(2, WIRE_NAMES_LINKIFIED)
    expect(view.chip.textContent).toContain('⊙2')
  })
})

describe('unread badge', () => {
  const badge = (v: ChatView) => v.chip.querySelector('.chat-chip-badge') as HTMLElement

  it('counts closed-sheet messages, ignores meta, clears on open', () => {
    const { view } = make()
    view.handleChat(WIRE_CHAT, false)
    view.handleChat(WIRE_META, true)
    expect(badge(view).textContent).toBe('1')
    view.openSheet()
    expect(badge(view).style.display).toBe('none')
  })

  it('does not count messages while the sheet is open', () => {
    const { view } = make()
    view.openSheet()
    view.handleChat(WIRE_CHAT, false)
    expect(badge(view).style.display).toBe('none')
  })

  it('caps the display at 9+', () => {
    const { view } = make()
    for (let i = 0; i < 12; i++) view.handleChat(WIRE_CHAT, false)
    expect(badge(view).textContent).toBe('9+')
  })
})

describe('pill', () => {
  it('previews a closed-sheet message, fades on expiry, then hides', () => {
    vi.useFakeTimers()
    const { view } = make()
    view.handleChat(WIRE_CHAT, false)
    expect(view.pill.style.display).not.toBe('none')
    expect(view.pill.textContent).toBe('gammafunk oh nice, a MiFi with a broad axe already')
    vi.advanceTimersByTime(4100)
    // Expiry starts the opacity fade; the element hides after it lands.
    expect(view.pill.classList.contains('chat-pill-fade')).toBe(true)
    expect(view.pill.style.display).not.toBe('none')
    vi.advanceTimersByTime(500)
    expect(view.pill.style.display).toBe('none')
  })

  it('a message landing mid-fade recovers the pill for a fresh window', () => {
    vi.useFakeTimers()
    const { view } = make()
    view.handleChat(WIRE_CHAT, false)
    vi.advanceTimersByTime(4100) // fading…
    view.handleChat(WIRE_CHAT, false)
    expect(view.pill.classList.contains('chat-pill-fade')).toBe(false)
    vi.advanceTimersByTime(3900) // old hide timer would have long fired
    expect(view.pill.style.display).not.toBe('none')
  })

  it('never pills meta notices', () => {
    const { view } = make()
    view.handleChat(WIRE_META, true)
    expect(view.pill.style.display).toBe('none')
  })

  it('is vetoed by pillAllowed; the unread badge still counts the message', () => {
    let allowed = true
    const { view } = make({ pillAllowed: () => allowed })
    allowed = false
    view.handleChat(WIRE_CHAT, false)
    expect(view.pill.style.display).toBe('none')
    expect((view.chip.querySelector('.chat-chip-badge') as HTMLElement).textContent).toBe('1')
  })

  it('hidePill dismisses one already in flight (overlay taking the screen)', () => {
    const { view } = make()
    view.handleChat(WIRE_CHAT, false)
    expect(view.pill.style.display).not.toBe('none')
    view.hidePill()
    expect(view.pill.style.display).toBe('none')
  })

  it('is suppressed while the sheet is open, and tapping it opens the sheet', () => {
    const { view } = make()
    view.openSheet()
    view.handleChat(WIRE_CHAT, false)
    expect(view.pill.style.display).toBe('none')
    view.closeSheet()
    view.handleChat(WIRE_CHAT, false)
    view.pill.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(view.isOpen).toBe(true)
    expect(view.pill.style.display).toBe('none')
  })
})

describe('sending', () => {
  const input = (v: ChatView) => v.sheet.querySelector('.chat-input') as HTMLInputElement
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  it('Enter sends the trimmed text and clears the input (no local echo)', () => {
    const { view, sent } = make()
    view.openSheet()
    input(view).value = '  hi there  '
    press(input(view), 'Enter')
    expect(sent).toEqual(['hi there'])
    expect(input(view).value).toBe('')
    // The server echoes to everyone including the sender; the round trip is
    // the delivery receipt.
    expect(view.sheet.querySelectorAll('.chat-line').length).toBe(0)
  })

  it('can preserve leading whitespace for host-level public-chat routing', () => {
    const { view, sent } = make({ preserveSendWhitespace: true })
    view.openSheet()
    input(view).value = ' public hello '
    press(input(view), 'Enter')
    expect(sent).toEqual([' public hello '])
    expect(input(view).value).toBe('')
  })

  it('ignores empty sends', () => {
    const { view, sent } = make()
    input(view).value = '   '
    press(input(view), 'Enter')
    expect(sent).toEqual([])
  })

  it('the » button sends too', () => {
    const { view, sent } = make()
    input(view).value = 'za'
    ;(view.sheet.querySelector('.chat-send') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(sent).toEqual(['za'])
  })

  it('guest (readOnly) locks the input with a sign-in hint and never sends', () => {
    const { view, sent } = make({ readOnly: true, alwaysShowChip: true })
    const el = input(view)
    expect(el.disabled).toBe(true)
    expect(el.placeholder).toBe('sign in to chat')
    expect((view.sheet.querySelector('.chat-send') as HTMLButtonElement).disabled).toBe(true)
    // Belt and braces: even a programmatic send is refused.
    el.value = 'hi'
    press(el, 'Enter')
    expect(sent).toEqual([])
  })

  it('keystrokes in the input never reach document-level game handlers', () => {
    // A hardware-keyboard "q" typed into chat must not quaff a potion:
    // game-view's key handler listens on document.
    const { view } = make()
    const leaked: string[] = []
    const docListener = (e: KeyboardEvent) => leaked.push(e.key)
    document.addEventListener('keydown', docListener)
    press(input(view), 'q')
    press(input(view), 'Enter')
    document.removeEventListener('keydown', docListener)
    expect(leaked).toEqual([])
  })
})

describe('open/close and super_hide_chat', () => {
  it('reports open state both ways', () => {
    const { view } = make()
    view.openSheet()
    expect(view.isOpen).toBe(true)
    expect(view.sheet.style.display).not.toBe('none')
    view.closeSheet()
    expect(view.isOpen).toBe(false)
    expect(view.sheet.style.display).toBe('none')
  })

  it('super_hide_chat removes all chat UI and ignores further traffic', () => {
    const { view } = make({ alwaysShowChip: true })
    view.openSheet()
    view.superHide()
    expect(view.isOpen).toBe(false)
    expect(chipVisible(view)).toBe(false)
    view.handleChat(WIRE_CHAT, false)
    view.handleSpectators(3, WIRE_NAMES_LINKIFIED)
    expect(chipVisible(view)).toBe(false)
    expect(view.sheet.querySelectorAll('.chat-line').length).toBe(0)
  })
})
