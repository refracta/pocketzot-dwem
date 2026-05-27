export interface TranslationMatcher {
  category: string
  raw?: string
  regex?: string | { pattern: string; flags?: string }
  replaceValue?: string | Record<string, string>
  groups?: Array<string | string[] | null>
  priority?: number
  ignorePartTranslated?: boolean
  regexp?: RegExp
}

export interface TranslationResult {
  target: string
  translation: string
  status: 'translated' | 'untranslated'
  totalStatus: 'translated' | 'untranslated' | 'part-translated'
  translations?: TranslationResult[]
  matcher?: TranslationMatcher
  category?: string | null
}

interface TranslationCategory {
  matchers: TranslationMatcher[]
  rawMap: Record<string, TranslationMatcher>
}

export class Translator {
  private categories: Record<string, TranslationCategory> = {}

  constructor(
    matchers: TranslationMatcher[],
    private readonly functions: Record<string, (...args: string[]) => string>,
    private readonly debug = false,
  ) {
    for (const matcher of matchers) {
      try {
        if (typeof matcher.regex === 'string') {
          matcher.regexp = new RegExp(matcher.regex)
        } else if (matcher.regex && typeof matcher.regex === 'object') {
          matcher.regexp = new RegExp(matcher.regex.pattern, matcher.regex.flags)
        }
      } catch (err) {
        console.warn('[DWEM][TranslationModule] skipping invalid matcher regexp', err)
        continue
      }

      matcher.groups = matcher.groups?.map((group) => typeof group === 'string' ? [group] : group) ?? []
      this.categories[matcher.category] ??= { matchers: [], rawMap: {} }
      if (typeof matcher.raw === 'string') {
        this.categories[matcher.category].rawMap[matcher.raw] = matcher
      } else if (matcher.regexp) {
        this.categories[matcher.category].matchers.push(matcher)
      }
    }

    for (const category of Object.values(this.categories)) {
      category.matchers.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    }
  }

  translate(target: string, language: string, categoryName: string): TranslationResult {
    const result: TranslationResult = {
      target,
      translation: target,
      status: 'untranslated',
      totalStatus: 'untranslated',
    }

    const category = this.categories[categoryName]
    if (!category) return result

    const rawMatcher = category.rawMap[target]
    if (rawMatcher) {
      if (this.debug) result.matcher = rawMatcher
      const rawValue = replacementFor(rawMatcher, language, target)
      result.translation = applySpecialPatterns(rawValue, this.functions)
      result.status = 'translated'
      result.totalStatus = 'translated'
      return result
    }

    let translations: TranslationResult[] = []
    for (const matcher of category.matchers) {
      if (!matcher.regexp) continue
      const matchResults = target.match(matcher.regexp)
      if (!matchResults) continue

      if (this.debug) result.matcher = matcher
      let replaced = target.replace(matcher.regexp, replacementFor(matcher, language, target))

      for (let i = 1; i < matchResults.length; i++) {
        const capture = matchResults[i]
        const groupCategories = matcher.groups?.[i - 1]
        if (capture === undefined || !groupCategories) {
          translations.push({ target: capture ?? '', translation: capture ?? '', status: 'translated', totalStatus: 'translated' })
          continue
        }

        let translated = false
        for (const groupCategory of groupCategories) {
          if (!this.categories[groupCategory]) continue
          let subResult = this.translate(capture, language, groupCategory)
          if (this.debug) subResult = { category: groupCategory, ...subResult }
          if (subResult.status === 'translated') {
            replaced = replaceCapturePreservingSpecialPattern(replaced, capture, subResult.translation)
            translations.push(subResult)
            translated = true
            break
          }
        }
        if (!translated) {
          replaced = replaceCapturePreservingSpecialPattern(replaced, capture, capture)
          translations.push({ target: capture, translation: capture, status: 'untranslated', totalStatus: 'untranslated' })
        }
      }

      result.translation = applySpecialPatterns(replaced, this.functions)
      result.status = 'translated'
      const translatedCount = translations.filter((translation) => translation.totalStatus === 'translated').length
      result.totalStatus = translatedCount === translations.length ? 'translated' : 'part-translated'
      result.translations = translations

      if (matcher.ignorePartTranslated && result.totalStatus !== 'translated') {
        translations = []
        result.translation = target
        result.status = 'untranslated'
        result.totalStatus = 'untranslated'
        continue
      }
      break
    }

    result.translations = translations
    return result
  }

}

export function applySpecialPatterns(text: string, functions: Record<string, (...args: string[]) => string>): string {
  let currentText = text
  for (let i = 0; i < 8; i++) {
    let changed = false
    const nextText = currentText.replace(/\{((?:\\.|[^{}])+?):([\p{L}\p{N}_]+)\}/gu, (match, paramsText: string, functionName: string) => {
      const fn = functions[functionName]
      if (!fn) return match
      const params: string[] = []
      let current = ''
      let escaping = false
      for (const char of paramsText) {
        if (escaping) {
          current += char
          escaping = false
        } else if (char === '\\') {
          escaping = true
        } else if (char === ',') {
          params.push(current)
          current = ''
        } else {
          current += char
        }
      }
      params.push(current)
      const replacement = fn(...params.map((param) => param.replace(/\\(.)/gs, '$1')))
      changed ||= replacement !== match
      return replacement
    })
    currentText = nextText
    if (!changed) break
  }
  return currentText
}

function replacementFor(matcher: TranslationMatcher, language: string, fallback: string): string {
  return typeof matcher.replaceValue === 'string'
    ? matcher.replaceValue
    : matcher.replaceValue?.[language] ?? fallback
}

function replaceCapturePreservingSpecialPattern(text: string, capture: string, replacement: string): string {
  let escaped = false
  const inSpecial = text.replace(/\{(.+?):([\p{L}\p{N}_]+)\}/gu, (match, paramsText: string, functionName: string) => {
    if (!escaped && paramsText.includes(capture)) {
      escaped = true
      return `{${paramsText.replace(capture, replacement.replace(/([\\{}:,])/g, '\\$1'))}:${functionName}}`
    }
    return match
  })
  return escaped ? inSpecial : inSpecial.replace(capture, replacement)
}
