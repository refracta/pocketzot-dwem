import { renderMarkdown, type MdOptions } from '../util/markdown'
import { mountCardOverlay } from './overlay'

// A self-contained, full-screen modal that renders a markdown document.
// Mounted on document.body (via the shared card shell) so it floats above
// whichever view is active (login, lobby), and removed on close.
export function openDocView(title: string, markdown: string, opts?: MdOptions): void {
  const { body } = mountCardOverlay(title, { body: 'doc-body' })
  body.innerHTML = renderMarkdown(markdown, opts)
}
