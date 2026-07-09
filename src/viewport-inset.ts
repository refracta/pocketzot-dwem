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

export function calibrateSafeTop(): void {
  const installed =
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  if (!installed) return

  // env() isn't readable from JS — resolve it via computed padding. Reads
  // the raw env, never the override, so calibration can't feed on itself.
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);'
  document.body.appendChild(probe)

  const update = (): void => {
    // Portrait-only: the stored value is the portrait status-bar depth, and
    // in landscape the top inset is genuinely 0 (the island sits on a side).
    if (!window.matchMedia('(orientation: portrait)').matches) {
      document.documentElement.style.removeProperty('--safe-top')
      return
    }
    const measured = parseFloat(getComputedStyle(probe).paddingTop) || 0
    let stored = 0
    try {
      stored = parseFloat(localStorage.getItem(STORE_KEY) ?? '') || 0
      if (measured > stored) {
        localStorage.setItem(STORE_KEY, String(measured))
        stored = measured
      }
    } catch {
      /* storage unavailable — fall back to raw env */
    }
    if (stored > measured) {
      document.documentElement.style.setProperty('--safe-top', `${stored}px`)
    } else {
      document.documentElement.style.removeProperty('--safe-top')
    }
  }
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}
