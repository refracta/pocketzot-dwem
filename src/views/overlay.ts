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
