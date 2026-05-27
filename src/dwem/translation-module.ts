import { ioHook, type IncomingMessage } from './io-hook'
import { rcManager } from './rc-manager'
import { TranslationDataManager } from './translation/data-manager'
import { applySpecialPatterns, Translator, type TranslationMatcher } from './translation/translator'

interface TranslationConfig {
  language?: string
  translationLanguage?: string
  translationFile: string
  useTranslationFont: boolean
  translationDebug: boolean
}

interface TranslationBuild {
  matchers: TranslationMatcher[]
  time: number | string
  messages: string[]
}

export class TranslationModule {
  private config: TranslationConfig | null = null
  private translator: Translator | null = null
  private installed = false
  private debugReloadTimer: number | null = null

  onLoad(): void {
    if (this.installed) return
    this.installed = true

    rcManager.addHandlers('translation-handler', {
      onGameInitialize: async (rcfile) => {
        await this.initialize(rcfile)
      },
      onGameEnd: () => {
        this.unload()
      },
    })
  }

  private async initialize(rcfile: string): Promise<void> {
    this.unload()
    this.config = this.getTranslationConfig(rcfile)
    if (!this.config.translationLanguage) return

    if (this.config.useTranslationFont) this.loadTranslationFont(this.config.translationLanguage)

    try {
      const build = await fetchJsonWithTimeout<TranslationBuild>(this.config.translationFile, 5000)
      this.translator = new Translator(build.matchers, TranslationDataManager.functions, this.config.translationDebug)
      ioHook.handle_message.before.addHandler('translation-handler', (data) => {
        this.translateIncoming(data)
        return false
      }, 0)

      if (this.config.language && this.config.language !== 'en') {
        this.sendMessage(`<cyan>[TranslationModule]</cyan> <red>Do not use language = ${this.config.language} together with translation_language.</red>`)
      }
      const stamp = new Date(build.time).toLocaleString()
      this.sendMessage(`<cyan>[TranslationModule]</cyan> ${build.matchers.length} matcher data loaded successfully. (${stamp}) / Thanks to ${build.messages[0] ?? 'contributors'}`)

      if (this.config.translationDebug) this.startDebugReloader()
    } catch (err) {
      console.error('[DWEM][TranslationModule] failed to initialize', err)
      this.translator = null
    }
  }

  private unload(): void {
    ioHook.handle_message.before.removeHandler('translation-handler')
    this.unloadTranslationFont()
    if (this.debugReloadTimer !== null) {
      window.clearInterval(this.debugReloadTimer)
      this.debugReloadTimer = null
    }
    this.translator = null
    this.config = null
  }

  private getTranslationConfig(rcfile: string): TranslationConfig {
    return {
      language: rcManager.getRCOption(rcfile, 'language', 'string') as string | undefined,
      translationLanguage: rcManager.getRCOption(rcfile, 'translation_language', 'string') as string | undefined,
      translationFile: (rcManager.getRCOption(rcfile, 'translation_file', 'string', 'https://translation.nemelex.cards/build/latest.json') as string),
      useTranslationFont: (rcManager.getRCOption(rcfile, 'use_translation_font', 'boolean', true) as boolean),
      translationDebug: (rcManager.getRCOption(rcfile, 'translation_debug', 'boolean', false) as boolean),
    }
  }

  private translateIncoming(data: IncomingMessage): void {
    if (!this.config?.translationLanguage || !this.translator) return

    for (const [category, processor] of Object.entries(TranslationDataManager.processors)) {
      if (!processor.match(data)) continue
      const originals = processor.extract(data)
      const translated = originals.map((text) => {
        try {
          return this.translator!.translate(text, this.config!.translationLanguage!, category)
        } catch (err) {
          if (this.config?.translationDebug) {
            console.error('[DWEM][TranslationModule] translation failed', { category, text, err })
          }
          return { translation: text }
        }
      })
      if (this.config.translationDebug) {
        for (let i = 0; i < originals.length; i++) {
          console.log('[DWEM][TranslationModule]', category, originals[i], translated[i])
        }
      }
      processor.restore(data, translated.map((result) => applySpecialPatterns(result.translation, TranslationDataManager.functions)))
    }
  }

  private loadTranslationFont(language: string): void {
    this.unloadTranslationFont()
    const fontCss = translationFontCss(language)
    if (!fontCss) return

    const style = document.createElement('style')
    style.id = 'translation_font'
    style.textContent = `
      ${fontCss.fontFaces}
      #app, #app * { font-family: ${fontCss.family}; }
      .stat-bar, .stats-bar { min-height: 1.2em; }
    `
    document.head.appendChild(style)
  }

  private unloadTranslationFont(): void {
    document.querySelector('#translation_font')?.remove()
  }

  private sendMessage(text: string): void {
    ioHook.handle_message({ msg: 'msgs', messages: [{ text }] })
  }

  private startDebugReloader(): void {
    if (!this.config) return
    let stamp = ''
    const url = this.config.translationFile
    const reload = async (): Promise<void> => {
      try {
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
        const nextStamp = `${head.headers.get('last-modified') ?? ''}|${head.headers.get('content-length') ?? ''}`
        if (stamp && nextStamp !== stamp) {
          await this.initializeFromCurrentConfig()
        }
        stamp = nextStamp
      } catch (err) {
        console.warn('[DWEM][TranslationModule] debug reload check failed', err)
      }
    }
    void reload()
    this.debugReloadTimer = window.setInterval(() => void reload(), 1000)
  }

  private async initializeFromCurrentConfig(): Promise<void> {
    if (!this.config?.translationLanguage) return
    const build = await fetchJsonWithTimeout<TranslationBuild>(this.config.translationFile, 5000)
    this.translator = new Translator(build.matchers, TranslationDataManager.functions, this.config.translationDebug)
    this.sendMessage(`<cyan>[TranslationModule]</cyan> DebugAutoReload: ${build.matchers.length} matcher data loaded successfully. (${new Date(build.time).toLocaleString()})`)
  }
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    window.clearTimeout(timeout)
  }
}

export const translationModule = new TranslationModule()

function translationFontCss(language: string): { fontFaces: string; family: string } | null {
  if (language === 'ko') {
    return {
      family: '"Nanum Gothic Coding", "D2Coding", "Noto Sans Mono CJK KR", monospace',
      fontFaces: `
        @font-face {
          font-family: "Nanum Gothic Coding";
          font-style: normal;
          font-weight: 400;
          font-display: swap;
          src: url("https://fonts.gstatic.com/s/nanumgothiccoding/v27/8QIVdjzHisX_8vv59_xMxtPFW4IXROwsy6Q.ttf") format("truetype");
        }
        @font-face {
          font-family: "Nanum Gothic Coding";
          font-style: normal;
          font-weight: 700;
          font-display: swap;
          src: url("https://fonts.gstatic.com/s/nanumgothiccoding/v27/8QIYdjzHisX_8vv59_xMxtPFW4IXROws8xgecsU.ttf") format("truetype");
        }
      `,
    }
  }

  if (language === 'ja') {
    return {
      family: '"Noto Sans Mono CJK JP", "Yu Gothic", "MS Gothic", monospace',
      fontFaces: `
        @font-face {
          font-family: "Noto Sans Mono CJK JP";
          font-style: normal;
          font-weight: 400;
          font-display: swap;
          src:
            local("NotoSansMonoCJKjp-Regular"),
            local("Noto Sans Mono CJK JP Regular"),
            url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk/Sans/Mono/NotoSansMonoCJKjp-Regular.otf") format("opentype");
        }
        @font-face {
          font-family: "Noto Sans Mono CJK JP";
          font-style: normal;
          font-weight: 700;
          font-display: swap;
          src:
            local("NotoSansMonoCJKjp-Bold"),
            local("Noto Sans Mono CJK JP Bold"),
            url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk/Sans/Mono/NotoSansMonoCJKjp-Bold.otf") format("opentype");
        }
      `,
    }
  }

  return null
}
