type AnyRecord = Record<string, any>
type Processor = {
  match: (data: AnyRecord) => boolean
  extract: (data: AnyRecord) => string[]
  restore: (data: AnyRecord, values: string[], useClone?: boolean) => AnyRecord
}

interface PathSegment {
  key: string
  isArray: boolean
  isObjArray: boolean
}

export class TranslationDataManager {
  static tokenize(str: string): Array<{ type: 'tag' | 'text'; content: string }> {
    const tag = /<\/?[A-Za-z0-9_]+>/
    return str
      .split(/(<\/?[A-Za-z0-9_]+>)/)
      .filter(Boolean)
      .map((segment) => tag.test(segment)
        ? { type: 'tag', content: segment }
        : { type: 'text', content: segment })
  }

  static clone<T>(value: T): T {
    return structuredClone(value)
  }

  static parseSpec(spec: string): { msgType: string; path: PathSegment[]; option: string | null } {
    const [head, tail = ''] = spec.split('@')
    const [pathPart, option] = tail.split('#')
    const path = pathPart.split('.').map((segment) => {
      if (segment.endsWith('[]')) return { key: segment.slice(0, -2), isArray: true, isObjArray: false }
      if (segment.endsWith('[o]')) return { key: segment.slice(0, -3), isArray: true, isObjArray: true }
      return { key: segment, isArray: false, isObjArray: false }
    })
    return { msgType: head, path, option: option ?? null }
  }

  static collectValues(obj: AnyRecord | undefined, path: PathSegment[], result: string[] = []): string[] {
    if (!obj || path.length === 0) return result
    const [{ key, isArray, isObjArray }, ...rest] = path
    const value = obj[key]
    const nodes = isArray
      ? (isObjArray ? Object.values(value ?? {}) : value ?? [])
      : [value]

    for (const node of nodes) {
      if (rest.length) {
        TranslationDataManager.collectValues(node, rest, result)
      } else if (node !== undefined && node !== null) {
        result.push(String(node))
      }
    }
    return result
  }

  static restoreValues(obj: AnyRecord | undefined, path: PathSegment[], injector: (value: string) => string): void {
    if (!obj || path.length === 0) return
    const [{ key, isArray, isObjArray }, ...rest] = path
    const value = obj[key]
    const entries = isArray
      ? (isObjArray ? Object.entries(value ?? {}) : (value ?? []).map((node: unknown, index: number) => [index, node] as const))
      : [[null, value] as const]

    for (const [entryKey, node] of entries) {
      if (rest.length) {
        TranslationDataManager.restoreValues(node as AnyRecord, rest, injector)
      } else if (node !== undefined && node !== null) {
        const newValue = injector(String(node))
        if (isArray) {
          if (isObjArray) obj[key][entryKey as string] = newValue
          else obj[key][entryKey as number] = newValue
        } else {
          obj[key] = newValue
        }
      }
    }
  }

  static optionHooks: Record<string, {
    extract: (value: string) => string[]
    restore: (original: string, next: () => string) => string
  }> = {
    tokenize: {
      extract: (value) => TranslationDataManager.tokenize(value)
        .filter((token) => token.type === 'text')
        .map((token) => token.content),
      restore: (original, next) => TranslationDataManager.tokenize(original)
        .map((token) => token.type === 'text' ? next() : token.content)
        .join(''),
    },
    quote: {
      extract: (value) => {
        const match = value.match(/_{10,}\n\n<.+?>([\s\S]+?)\n<.+?>/)
        return match ? [match[1]] : []
      },
      restore: (original, next) => original.replace(/(_{10,}\n\n<.+?>)([\s\S]+?)(\n<.+?>)/, (_full, prefix: string, _body: string, suffix: string) => {
        return prefix + next() + suffix
      }),
    },
    lines: {
      extract: (value) => value.split('\n'),
      restore: (original, next) => {
        const hadTrailingNewline = original.endsWith('\n')
        const parts = hadTrailingNewline ? original.slice(0, -1).split('\n') : original.split('\n')
        const rebuilt = parts.map(() => next()).join('\n')
        return hadTrailingNewline ? rebuilt + '\n' : rebuilt
      },
    },
  }

  static makeProcessor(spec: string): Processor {
    const { msgType, path, option } = TranslationDataManager.parseSpec(spec)
    const hook = option ? TranslationDataManager.optionHooks[option] : undefined

    return {
      match: (data) => data?.msg === msgType && TranslationDataManager.collectValues(data, path).some((value) => value != null),
      extract: (data) => {
        const values = TranslationDataManager.collectValues(data, path)
        return hook ? values.flatMap((value) => hook.extract(value)) : values
      },
      restore: (data, values, useClone = false) => {
        const out = useClone ? TranslationDataManager.clone(data) : data
        const pending = [...values]
        const next = () => pending.shift() ?? ''
        TranslationDataManager.restoreValues(out, path, hook ? (node) => hook.restore(node, next) : next)
        return out
      },
    }
  }

  static register(specs: string[]): Record<string, Processor> {
    return Object.fromEntries(specs.map((spec) => [spec, TranslationDataManager.makeProcessor(spec)]))
  }

  static processors = TranslationDataManager.register([
    'game_ended@message',
    'map@cells[].mon.name',
    'map@cells[].mon.plural',
    'menu@alt_more',
    'menu@items[].text',
    'menu@more',
    'menu@title.text',
    'msgs@messages[].text',
    'msgs@messages[].text#tokenize',
    'player@god',
    'player@inv[o].inscription',
    'player@inv[o].name',
    'player@inv[o].qty_field',
    'player@inv[o].action_verb',
    'player@place',
    'player@quiver_desc',
    'player@species',
    'player@status[].desc',
    'player@status[].light',
    'player@status[].text',
    'player@title',
    'player@unarmed_attack',
    'txt@lines[o]',
    'ui-push@actions',
    'ui-push@description',
    'ui-push@favour',
    'ui-push@name',
    'ui-push@powers',
    'ui-push@powers_list',
    'ui-push@service_fee',
    'ui-push@wrath',
    'ui-push@desc',
    'ui-push@desc#quote',
    'ui-push@desc#lines',
    'ui-push@body',
    'ui-push@body#quote',
    'ui-push@body#lines',
    'ui-push@highlight',
    'ui-push@main-items.buttons[].description',
    'ui-push@main-items.buttons[].labels[]',
    'ui-push@main-items.labels[].label',
    'ui-push@more',
    'ui-push@prompt',
    'ui-push@quote',
    'ui-push@spellset[].label',
    'ui-push@spellset[].spells[].effect',
    'ui-push@spellset[].spells[].letter',
    'ui-push@spellset[].spells[].range_string',
    'ui-push@spellset[].spells[].schools',
    'ui-push@spellset[].spells[].title',
    'ui-push@sub-items.buttons[].description',
    'ui-push@sub-items.buttons[].label',
    'ui-push@text',
    'ui-push@text#lines',
    'ui-push@text#tokenize',
    'ui-push@feats[].title',
    'ui-push@feats[].body',
    'ui-push@title',
    'ui-state@highlight',
    'ui-state@text',
    'update_menu@alt_more',
    'update_menu@more',
    'update_menu@title.text',
    'update_menu_items@items[].text',
    'init_input@prompt',
    'version@text',
  ])

  static functions: Record<string, (...args: string[]) => string> = makeTranslationFunctions()
}

function makeTranslationFunctions(): Record<string, (...args: string[]) => string> {
  const isHangul = (cp: number): boolean => cp >= 0xac00 && cp <= 0xd7a3
  const isUnicode = (char: string): boolean => /[^\u0000-\u00ff]/.test(char)
  const hasBatchim = (word: string): boolean => {
    const cp = word.charCodeAt(word.length - 1)
    return isHangul(cp) && (cp - 0xac00) % 28 !== 0
  }
  const jongIdx = (word: string): number => {
    const cp = word.charCodeAt(word.length - 1)
    return isHangul(cp) ? (cp - 0xac00) % 28 : -1
  }
  const josa = (withBatchim: string, withoutBatchim: string, paren = false) => (word: string, suffix = ''): string => {
    const cp = word.charCodeAt(word.length - 1)
    if (!isHangul(cp)) return paren ? `${word}${suffix}${withBatchim}(${withoutBatchim})` : word + withoutBatchim
    return word + suffix + (hasBatchim(word) ? withBatchim : withoutBatchim)
  }
  const padString = (padStart: boolean, htmlFormatted: boolean) => (original: string, rawSize: string): string => {
    const size = parseInt(rawSize, 10)
    if (size <= 0) return original
    let counted = original
    if (htmlFormatted) {
      counted = counted
        .replace(/<.+?>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
    }
    const currentSize = Array.from(counted).reduce((sum, char) => sum + (isUnicode(char) ? 2 : 1), 0)
    const padding = ' '.repeat(Math.max(0, size - currentSize))
    return padStart ? padding + original : original + padding
  }
  const toKoreanRune = (rawRune: string): string => {
    const map: Record<string, string> = {
      A: 'ㅏ', B: 'ㅂ', C: 'ㅋ', D: 'ㄷ', E: 'ㅔ', F: 'ㅍ',
      G: 'ㄱ', H: 'ㅎ', I: 'ㅣ', J: 'ㅈ', K: 'ㅋ', L: 'ㄹ',
      M: 'ㅁ', N: 'ㄴ', O: 'ㅗ', P: 'ㅍ', Q: 'ㅋ', R: 'ㄹ',
      S: 'ㅅ', T: 'ㅌ', U: 'ㅜ', V: 'ㅂ', W: 'ㅈ', X: 'ㅅ',
      Y: 'ㅡ', Z: 'ㅈ',
    }
    const cho = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
    const jung = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
    const jong = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
    const allowedJong = new Set([0, 1, 4, 8, 16, 17, 19, 21])
    const runeCharToJamo = (char: string): string => map[char.toUpperCase()] ?? char
    const composeSegment = (segment: string): string => {
      let output = ''
      for (let i = 0; i < segment.length - 1;) {
        const choIndex = cho.indexOf(segment[i])
        const jungIndex = jung.indexOf(segment[i + 1])
        if (choIndex !== -1 && jungIndex !== -1) {
          let jongIndex = 0
          const candidate = jong.indexOf(segment[i + 2])
          if (candidate !== -1 && allowedJong.has(candidate)) {
            jongIndex = candidate
            i += 1
          }
          output += String.fromCharCode(0xac00 + (choIndex * 21 + jungIndex) * 28 + jongIndex)
          i += 2
        } else {
          i += 1
        }
      }
      return output
    }

    return String(rawRune).split(/\r?\n/)
      .map((rawLine) => {
        const line = rawLine.trim()
        if (!line) return null
        const match = line.match(/-\s*[^A-Za-z]*([A-Za-z\s]+?)\|/)
        const rune = (match ? match[1] : line).replace(/["',]/g, '')
        const jamoLine = Array.from(rune).map(runeCharToJamo).join('')
        return jamoLine
          .split(/(\s+)/)
          .map((word) => /\s/.test(word) ? word : composeSegment(word))
          .join('')
          .replace(/\s{2,}/g, ' ')
      })
      .filter((line): line is string => Boolean(line))
      .join('\n')
  }

  return {
    '은': josa('은', '는', true),
    '는': josa('은', '는', true),
    '이': josa('이', '가', true),
    '가': josa('이', '가', true),
    '을': josa('을', '를', true),
    '를': josa('을', '를', true),
    '과': josa('과', '와'),
    '와': josa('과', '와'),
    '이랑': josa('이랑', '랑'),
    '랑': josa('이랑', '랑'),
    '이나': josa('이나', '나'),
    '나': josa('이나', '나'),
    '이라도': josa('이라도', '라도'),
    '라도': josa('이라도', '라도'),
    '이든': josa('이든', '든'),
    '든': josa('이든', '든'),
    '이든지': josa('이든지', '든지'),
    '든지': josa('이든지', '든지'),
    '이라고': josa('이라고', '라고'),
    '라고': josa('이라고', '라고'),
    '이라면': josa('이라면', '라면'),
    '라면': josa('이라면', '라면'),
    '이라서': josa('이라서', '라서'),
    '라서': josa('이라서', '라서'),
    '이며': josa('이며', '며'),
    '며': josa('이며', '며'),
    '이고': josa('이고', '고'),
    '고': josa('이고', '고'),
    '이냐': josa('이냐', '냐'),
    '냐': josa('이냐', '냐'),
    '이니': josa('이니', '니'),
    '니': josa('이니', '니'),
    '아': josa('아', '야'),
    '야': josa('아', '야'),
    '으로': (word) => word + ([0, 8, -1].includes(jongIdx(word)) ? '로' : '으로'),
    '로': (word) => word + ([0, 8, -1].includes(jongIdx(word)) ? '로' : '으로'),
    PAD_END: padString(false, false),
    PAD_START: padString(true, false),
    PAD_END_HTML: padString(false, true),
    PAD_START_HTML: padString(true, true),
    TO_KOREAN_RUNE: toKoreanRune,
  }
}
