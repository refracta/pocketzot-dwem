// Minimal Markdown → HTML renderer for the in-app document views (About,
// What's new), rendered straight from the committed ABOUT.md / CHANGELOG.md so
// every build — including forks — carries them. Deliberately small: it only
// covers the constructs those two author-controlled files use (headings, simple
// lists with wrapped continuation lines, bold/italic/code, links and
// `<url>`/`<email>` autolinks). It is NOT a general-purpose or untrusted-input
// renderer; don't feed it server data — use dcssToHtml for DCSS colour markup.

export interface MdOptions {
  // Map a link href before it is emitted. Used to turn repo-relative links
  // (e.g. LICENSE, ATTRIBUTION.md) into absolute GitHub URLs for web display.
  resolveLink?: (href: string) => string
}

// NUL never occurs in the source markdown, so code-span placeholders wrapped in
// it can't collide with real text on restoration.
const NUL = String.fromCharCode(0)

export function renderMarkdown(src: string, opts: MdOptions = {}): string {
  const md = src.replace(/<!--[\s\S]*?-->/g, '')
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0

  const isList = (l: string): boolean => /^\s*-\s+/.test(l)
  const isHeading = (l: string): boolean => /^#{1,3}\s+/.test(l)

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i++; continue }

    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2].trim(), opts)}</h${level}>`)
      i++
      continue
    }

    if (isList(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const cur = lines[i]
        if (cur.trim() === '') { i++; break }
        if (isHeading(cur)) break
        const m = /^\s*-\s+(.*)$/.exec(cur)
        if (m) {
          items.push(m[1])
        } else if (items.length) {
          // Continuation line — fold into the current item (the source wraps
          // long bullets across lines).
          items[items.length - 1] += ' ' + cur.trim()
        }
        i++
      }
      out.push('<ul>' + items.map(t => `<li>${inline(t, opts)}</li>`).join('') + '</ul>')
      continue
    }

    // Paragraph: gather lines until a blank, heading, or list.
    const para: string[] = []
    while (i < lines.length) {
      const cur = lines[i]
      if (cur.trim() === '' || isHeading(cur) || isList(cur)) break
      para.push(cur.trim())
      i++
    }
    out.push(`<p>${inline(para.join(' '), opts)}</p>`)
  }

  return out.join('\n')
}

function inline(text: string, opts: MdOptions): string {
  const resolve = opts.resolveLink ?? ((h: string) => h)

  // Pull code spans out first so their contents are never touched by the
  // emphasis/link passes (e.g. a literal `*` inside `code`).
  const codes: string[] = []
  let t = text.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c)
    return `${NUL}${codes.length - 1}${NUL}`
  })

  t = esc(t)

  // <https://…> and <name@host> autolinks (operate on the escaped form).
  t = t.replace(/&lt;(https?:\/\/[^\s<>]+?)&gt;/g, (_m, u: string) =>
    `<a href="${attr(resolve(u))}" target="_blank" rel="noopener noreferrer">${u}</a>`)
  t = t.replace(/&lt;([^\s<>@]+@[^\s<>]+?)&gt;/g, (_m, e: string) =>
    `<a href="mailto:${attr(e)}">${e}</a>`)

  // [label](href)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    const resolved = resolve(href)
    const ext = /^https?:/i.test(resolved)
    return `<a href="${attr(resolved)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
  })

  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  t = t.replace(new RegExp(`${NUL}(\\d+)${NUL}`, 'g'), (_m, n: string) =>
    `<code>${esc(codes[+n])}</code>`)
  return t
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attr(s: string): string {
  return s.replace(/"/g, '&quot;')
}
