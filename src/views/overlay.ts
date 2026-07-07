// Shared dismissal wiring for the full-screen surfaces mounted on document.body
// (the markdown doc viewer and the crypt). Appends `el` to the body, closes it on
// Escape, and returns a close() that removes the node and detaches the listener.
// Each caller supplies its own markup and any extra close triggers (a button, a
// backdrop tap) by wiring them to the returned handle.
export function mountOverlay(el: HTMLElement): () => void {
  document.body.appendChild(el)
  function close(): void {
    el.remove()
    document.removeEventListener('keydown', onKey)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey)
  return close
}

// Shared card-dialog shell (dimmed backdrop + centered card + titled header
// with ✕), used by the doc viewer and the settings page. Returns the empty
// body element for the caller to fill, plus close(); Escape (via
// mountOverlay), the ✕ button, and a backdrop tap all dismiss. The `cls`
// classes extend the doc-* base styling per surface.
export function mountCardOverlay(
  title: string,
  cls: { backdrop?: string; card?: string; body?: string } = {},
): { body: HTMLElement; close: () => void } {
  const backdrop = document.createElement('div')
  backdrop.className = 'doc-backdrop' + (cls.backdrop ? ` ${cls.backdrop}` : '')
  const card = document.createElement('div')
  card.className = 'doc-card' + (cls.card ? ` ${cls.card}` : '')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', title)
  const header = document.createElement('div')
  header.className = 'doc-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'doc-title'
  titleEl.textContent = title
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'doc-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.textContent = '✕'
  header.appendChild(titleEl)
  header.appendChild(closeBtn)
  const body = document.createElement('div')
  body.className = cls.body ?? 'doc-body'
  card.appendChild(header)
  card.appendChild(body)
  backdrop.appendChild(card)
  const close = mountOverlay(backdrop)
  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close() })
  return { body, close }
}
