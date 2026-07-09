/* Temporary dev readout for the safe-area migration.
 *
 * dev-material/vertical-space-savings.md gates the viewport-fit=cover
 * migration on measuring what env(safe-area-inset-*) actually reports
 * on-device, in both a Safari tab and the installed (standalone) app.
 * The chip shows the four raw insets, the resolved --safe-bottom
 * (min(env, 25px), the value the layout actually consumes), the display
 * mode, and viewport geometry (innerHeight vs screen etc. — to catch the
 * mixed state where the content origin moves to the physical top but the
 * layout viewport keeps its old pre-cover height, leaving a dead band at
 * the bottom). Delete this file once the matrix is settled.
 *
 * Mounting: `?safearea=1` shows it (and persists the flag for later loads);
 * `?safearea=0` clears the flag. Installed PWAs launch at the manifest's
 * start_url so a query can't reach them — DEV builds therefore auto-show
 * the chip whenever running standalone. Tap the chip to dismiss it (also
 * clears the persisted flag).
 */
const FLAG_KEY = 'pocketzot:safearea'

export function maybeMountSafeAreaProbe(): void {
  const q = new URLSearchParams(location.search).get('safearea')
  if (q === '0') {
    localStorage.removeItem(FLAG_KEY)
    return
  }
  if (q !== null) localStorage.setItem(FLAG_KEY, '1')

  const standalone =
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  const flagged = q !== null || localStorage.getItem(FLAG_KEY) === '1'
  if (!flagged && !(import.meta.env.DEV && standalone)) return

  // env() can't be read from JS directly — resolve it through computed
  // padding on a throwaway fixed element.
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
    'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);'
  const resolved = document.createElement('div')
  resolved.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-bottom:var(--safe-bottom,0px);padding-top:var(--safe-top,0px);'
  // Viewport-unit rulers: on iOS standalone cold start the dynamic viewport
  // (dvh) sticks at the pre-cover size while vh resolves the real screen —
  // these two lines are the direct proof/refutation on-device.
  const vhRuler = document.createElement('div')
  vhRuler.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:100vh;'
  const dvhRuler = document.createElement('div')
  dvhRuler.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:100dvh;'

  const chip = document.createElement('div')
  chip.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
    'background:rgba(0,0,0,0.85);color:#fce94f;border:1px solid #8f5902;border-radius:6px;' +
    'padding:0.5rem 0.7rem;font:12px/1.5 monospace;cursor:pointer;white-space:pre;'
  chip.addEventListener('click', () => {
    localStorage.removeItem(FLAG_KEY)
    probe.remove()
    resolved.remove()
    vhRuler.remove()
    dvhRuler.remove()
    chip.remove()
  })

  document.body.append(probe, resolved, vhRuler, dvhRuler, chip)

  const update = (): void => {
    const p = getComputedStyle(probe)
    const appH = document.getElementById('app')?.getBoundingClientRect().height ?? 0
    // Which display-mode the OS actually granted (the manifest may ask for
    // fullscreen and be silently downgraded to standalone).
    const dm = ['fullscreen', 'standalone', 'minimal-ui', 'browser'].find(m =>
      window.matchMedia(`(display-mode: ${m})`).matches,
    )
    chip.textContent =
      `mode: ${standalone ? 'installed' : 'tab'} (display-mode: ${dm ?? '?'})\n` +
      `env top:    ${p.paddingTop}\n` +
      `env right:  ${p.paddingRight}\n` +
      `env bottom: ${p.paddingBottom}\n` +
      `env left:   ${p.paddingLeft}\n` +
      `--safe-bottom: ${getComputedStyle(resolved).paddingBottom}` +
      `  --safe-top: ${getComputedStyle(resolved).paddingTop}\n` +
      `innerH: ${window.innerHeight}  clientH: ${document.documentElement.clientHeight}\n` +
      `visualVp: ${window.visualViewport ? Math.round(window.visualViewport.height) : 'n/a'}` +
      `  screen: ${screen.height}\n` +
      `100vh: ${Math.round(vhRuler.getBoundingClientRect().height)}` +
      `  100dvh: ${Math.round(dvhRuler.getBoundingClientRect().height)}\n` +
      `#app: ${Math.round(appH)}\n` +
      `(tap to dismiss)`
  }
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
  window.visualViewport?.addEventListener('resize', update)
}
