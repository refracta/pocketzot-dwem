// Shrink a monospace block's font so its widest line fits the element's own
// width, preserving column alignment without horizontal scroll — the same
// treatment the morgue / official client use for fixed-width terminal screens.
// Works on any nowrap/`white-space: pre` block whose content overflows
// horizontally (the element itself, or block children that overflow it).
// line-height should be unitless so it scales with font-size, keeping the
// aspect ratio. The 7px floor keeps it legible; below that the content was
// never going to fit anyway. Reading scrollWidth/clientWidth forces a
// synchronous layout flush, so the scaled size lands before first paint.
export function fitToWidth(el: HTMLElement, minPx = 7): void {
  el.style.fontSize = ''
  const avail = el.clientWidth
  if (avail <= 0) return
  if (el.scrollWidth <= avail) return
  const basePx = parseFloat(getComputedStyle(el).fontSize)
  // 0.99 nudge absorbs sub-pixel rounding so the widest line never re-overflows.
  el.style.fontSize = `${Math.max(minPx, basePx * (avail / el.scrollWidth) * 0.99)}px`
}
