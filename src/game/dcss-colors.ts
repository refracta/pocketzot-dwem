// The 16 named colours below are the standard terminal palette (Tango-
// derived) the DCSS server names in its markup; the client must use
// these exact values to render colours faithfully. See ATTRIBUTION.md.

export const DCSS_COLOR_MAP: Record<string, string> = {
  black:        '#000000',
  blue:         '#005afa',
  green:        '#4e9a06',
  cyan:         '#06989a',
  red:          '#b30009',
  magenta:      '#cd21cb',
  brown:        '#8f5902',
  lightgrey:    '#babdb6',
  darkgrey:     '#555753',
  lightblue:    '#5e78ff',
  lightgreen:   '#8ae234',
  lightcyan:    '#34e2e2',
  lightred:     '#ef2929',
  lightmagenta: '#fd59fa',
  yellow:       '#fce94f',
  white:        '#eeeeec',
  // Aliases used by `<w>...</w>` markup for highlighted text.
  w:            '#eeeeec',
  W:            '#eeeeec',
}

// Index-ordered names — defines the 0–15 mapping used by numeric `colour`
// fields. Sourced from DCSS_COLOR_MAP so the hex strings live in one place.
const DCSS_NAMES_BY_INDEX = [
  'black', 'blue', 'green', 'cyan',
  'red', 'magenta', 'brown', 'lightgrey',
  'darkgrey', 'lightblue', 'lightgreen', 'lightcyan',
  'lightred', 'lightmagenta', 'yellow', 'white',
] as const

export const DCSS_UI_COLOR: readonly string[] =
  DCSS_NAMES_BY_INDEX.map(n => DCSS_COLOR_MAP[n])

export function uiColor(index: number): string {
  return DCSS_UI_COLOR[index & 0xf] ?? DCSS_COLOR_MAP.lightgrey
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function dcssToHtml(text: string): string {
  const parts = text.split(/(<[^>]+>)/)
  const colorStack: string[] = []
  let spanOpen = false
  let out = ''
  for (const part of parts) {
    if (part.startsWith('<') && part.endsWith('>')) {
      const tag = part.slice(1, -1).toLowerCase()
      if (tag.startsWith('/')) {
        if (colorStack.length > 0) {
          if (spanOpen) { out += '</span>'; spanOpen = false }
          colorStack.pop()
          if (colorStack.length > 0) {
            out += `<span style="color:${colorStack[colorStack.length - 1]}">`
            spanOpen = true
          }
        }
      } else {
        const hex = DCSS_COLOR_MAP[tag]
        if (hex) {
          if (spanOpen) { out += '</span>'; spanOpen = false }
          colorStack.push(hex)
          out += `<span style="color:${hex}">`
          spanOpen = true
        }
      }
    } else {
      out += escHtml(part)
    }
  }
  if (spanOpen) out += '</span>'
  return out
}
