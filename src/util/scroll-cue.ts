// Scroll-edge cue for a pinned bar + scrolling body: toggles `is-scrolled` on
// `headerEl` whenever `scrollEl` is scrolled off the top, so the CSS can draw a
// hairline under the bar only while content rides beneath it. The listener lives
// on `scrollEl` (a descendant of the view), so it's GC'd with the view subtree —
// no explicit teardown needed. Used by the lobby and the crypt.
export function attachScrollCue(headerEl: HTMLElement, scrollEl: HTMLElement): void {
  scrollEl.addEventListener('scroll', () => {
    headerEl.classList.toggle('is-scrolled', scrollEl.scrollTop > 0)
  }, { passive: true })
}
