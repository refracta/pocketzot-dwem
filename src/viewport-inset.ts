/* Sticky top-inset calibration for installed (home-screen) mode.
 *
 * The layout reads the status-bar / Dynamic-Island clearance through
 * --safe-top (style.css), which defaults to env(safe-area-inset-top). On
 * iOS 26 that env value is flaky across cold starts: 59px one launch, 0px
 * the next, with identical build and geometry (observed on-device; the
 * fozzedout iPhone-PWA-game guide documents the same cold-start env
 * unreliability). A zero launch would let full-screen menus (#ui-overlay)
 * and the top floats slide back under the island.
 *
 * The hardware doesn't move between launches, so: whenever env reports a
 * real portrait top inset, persist it; on launches where env says 0, apply
 * the remembered value as an inline --safe-top override. Tab mode is left
 * alone — there the window sits below the browser chrome and 0 is the
 * truth, not a misreport.
 */
const STORE_KEY = 'pocketzot:safe-top'

/* Single source of truth for "running as an installed app" in TS; must stay
 * in sync with the `@media (display-mode: standalone), (display-mode:
 * fullscreen)` block in style.css. `navigator.standalone` is the legacy iOS
 * fallback. */
export function isInstalledDisplayMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

/* env()/viewport units aren't readable from JS directly — resolve them via
 * computed style on a hidden fixed-position element. */
export function hiddenProbe(style: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' + style
  return el
}

export function calibrateSafeTop(): void {
  if (!isInstalledDisplayMode()) return

  // Reads the raw env, never the override, so calibration can't feed on
  // itself.
  const probe = hiddenProbe('padding-top:env(safe-area-inset-top,0px);')
  document.body.appendChild(probe)

  const portrait = window.matchMedia('(orientation: portrait)')
  let stored = 0
  try {
    stored = parseFloat(localStorage.getItem(STORE_KEY) ?? '') || 0
  } catch {
    /* storage unavailable — fall back to raw env */
  }

  let applied: string | null = null
  const apply = (value: string | null): void => {
    if (value === applied) return
    applied = value
    if (value === null) document.documentElement.style.removeProperty('--safe-top')
    else document.documentElement.style.setProperty('--safe-top', value)
  }

  const update = (): void => {
    // Portrait-only: the stored value is the portrait status-bar depth, and
    // in landscape the top inset is genuinely 0 (the island sits on a side).
    if (!portrait.matches) {
      apply(null)
      return
    }
    const measured = parseFloat(getComputedStyle(probe).paddingTop) || 0
    if (measured > stored) {
      stored = measured
      try {
        localStorage.setItem(STORE_KEY, String(measured))
      } catch {
        /* storage unavailable — the value still applies this session */
      }
    }
    apply(stored > measured ? `${stored}px` : null)
  }
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}
