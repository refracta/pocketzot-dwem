import { describe, expect, it } from 'vitest'
import { TranslationDataManager } from './data-manager'
import { Translator } from './translator'

describe('DWEM translation special functions', () => {
  it('evaluates nested rune and josa functions', () => {
    const translator = new Translator([
      {
        category: 'test',
        raw: 'scroll',
        replaceValue: '{{JULOIR JIULOHO:TO_KOREAN_RUNE}:라고} 쓰인 두루마리',
      },
    ], TranslationDataManager.functions)

    const result = translator.translate('scroll', 'ko', 'test').translation

    expect(result).not.toContain('{')
    expect(result).not.toContain('TO_KOREAN_RUNE')
    expect(result).toContain('라고 쓰인 두루마리')
  })

  it('evaluates special functions after nested category substitution', () => {
    const translator = new Translator([
      {
        category: 'menu@items[].text',
        regex: '(\\w) ([-+])(\\s*)(the|an|a)?(\\s*)(?!.*Evoke)(.+)$',
        replaceValue: '$1 $2$3$6',
        groups: [null, null, null, null, null, ['items']],
      },
      {
        category: 'items',
        regex: 'scroll labelled (.+)',
        replaceValue: { ko: '{{$1:TO_KOREAN_RUNE}:라고} 쓰인 두루마리' },
        groups: [null],
      },
    ], TranslationDataManager.functions)

    const result = translator.translate('c - scroll labelled JULOIR JIULOHO', 'ko', 'menu@items[].text').translation

    expect(result).not.toContain('{')
    expect(result).not.toContain('TO_KOREAN_RUNE')
    expect(result).toContain('라고 쓰인 두루마리')
  })

  it('evaluates special functions through update-menu item-window indirection', () => {
    const translator = new Translator([
      {
        category: 'update_menu_items@items[].text',
        regex: '(.+)',
        replaceValue: '$1',
        groups: [['spell-window', 'items-window']],
        ignorePartTranslated: true,
      },
      {
        category: 'items-window',
        regex: '(\\w) ([-+])(\\s*)(the|an|a)?(\\s*)(.+)$',
        replaceValue: '$1 $2$3$6',
        groups: [null, null, null, null, null, 'items'],
      },
      {
        category: 'items',
        regex: 'scroll labelled (.+)',
        replaceValue: { ko: '{{$1:TO_KOREAN_RUNE}:라고} 쓰인 두루마리' },
        groups: [null],
      },
    ], TranslationDataManager.functions)

    const result = translator.translate('c - scroll labelled BALUHA BIKK', 'ko', 'update_menu_items@items[].text').translation

    expect(result).not.toContain('{')
    expect(result).not.toContain('TO_KOREAN_RUNE')
    expect(result).toContain('라고 쓰인 두루마리')
  })
})
