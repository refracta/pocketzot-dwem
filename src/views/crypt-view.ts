import { listAllAvatars } from '../avatars'
import { paintAvatars } from './avatar-tiles'
import { pickCryptLine } from './crypt-flavor'
import { mountOverlay } from './overlay'

// Full-screen "crypt": the complete retained character history (../avatars),
// painted as a vertical-scrolling 4-wide grid of doll sprites. An opaque full
// screen, not a modal card — so it's dismissed with a "← Back" ghost button (the
// same chrome as the lobby), top-left; Escape also closes it (mountOverlay).
// Mounted on document.body above the login view, opened by tapping the login doll
// strip. The grid mirrors the strip's newest-first order (newest top-left), so the
// strip reads as the crypt's top row.
//
// Heading: a random thematic line (./crypt-flavor) shown on each open, in the
// smaller flavor style (it's prose, not a wordmark).
export function openCrypt(): void {
  if (document.querySelector('.crypt-view')) return // already open — ignore re-taps
  const view = document.createElement('div')
  view.className = 'crypt-view'
  view.innerHTML = `
    <header class="crypt-header">
      <div class="crypt-topbar">
        <button type="button" class="crypt-back lobby-btn-ghost" aria-label="Back">← Back</button>
      </div>
      <p class="crypt-flavor"></p>
    </header>
    <div class="crypt-grid"></div>
  `
  // Set via textContent (the flavor lines are author-written plain text).
  view.querySelector<HTMLElement>('.crypt-flavor')!.textContent = pickCryptLine()

  const close = mountOverlay(view) // body-mount + Escape-to-close
  // Scale 2.5 (80px): bigger than the login strip's 64px teaser, but small enough
  // that four fit per row on a phone (the .crypt-grid wraps at 4-ish, centered).
  void paintAvatars(view.querySelector<HTMLElement>('.crypt-grid')!, listAllAvatars(), 2.5, 'crypt-doll')

  const backBtn = view.querySelector<HTMLElement>('.crypt-back')!
  backBtn.addEventListener('click', close)
  // Move focus off the trigger (the doll strip) into the dialog, so an Esc dismiss
  // doesn't flip the strip into :focus-visible and leave a focus ring on it.
  backBtn.focus({ preventScroll: true })
}
