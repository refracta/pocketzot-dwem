import { renderMarkdown, type MdOptions } from '../util/markdown'

// A self-contained, full-screen modal that renders a markdown document. Mounted
// on document.body so it floats above whichever view is active (login, lobby),
// and removed on close. The backdrop/card styling mirrors the lobby exit dialog.
export function openDocView(title: string, markdown: string, opts?: MdOptions): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'doc-backdrop'
  backdrop.innerHTML = `
    <div class="doc-card" role="dialog" aria-modal="true" aria-label="${attr(title)}">
      <div class="doc-header">
        <span class="doc-title">${esc(title)}</span>
        <button type="button" class="doc-close" aria-label="Close">✕</button>
      </div>
      <div class="doc-body">${renderMarkdown(markdown, opts)}</div>
    </div>
  `
  document.body.appendChild(backdrop)

  function close(): void {
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey)
  backdrop.querySelector('.doc-close')!.addEventListener('click', close)
  // Tapping the dimmed area outside the card dismisses it.
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close() })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attr(s: string): string {
  return esc(s).replace(/"/g, '&quot;')
}
