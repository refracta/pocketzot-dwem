import { describe, expect, it } from 'vitest'
import { getSoundMessageTexts, parseSoundLine } from './sound-support'

describe('parseSoundLine', () => {
  it('keeps legacy raw regex entries working', () => {
    const parsed = parseSoundLine('sound += You kill:se/Zdeath.mp3')
    expect(parsed?.path).toBe('se/Zdeath.mp3')
    expect(parsed?.regex.test('You kill the dart slug!')).toBe(true)
  })

  it('supports slash-delimited regex entries from sound packs', () => {
    const parsed = parseSoundLine('sound += /You kill/:se/Zdeath.mp3')
    expect(parsed?.path).toBe('se/Zdeath.mp3')
    expect(parsed?.regex.test('You kill the dart slug!')).toBe(true)
  })

  it('supports slash-delimited regex flags', () => {
    const parsed = parseSoundLine('sound += /you kill/i:se/Zdeath.mp3')
    expect(parsed?.regex.test('You kill the dart slug!')).toBe(true)
  })

  it('allows whitespace before the path delimiter for slash-delimited regexes', () => {
    const parsed = parseSoundLine('sound += /You kill/ : se/Zdeath.mp3')
    expect(parsed?.path).toBe('se/Zdeath.mp3')
    expect(parsed?.regex.test('You kill the dart slug!')).toBe(true)
  })

  it('does not split a slash-delimited regex on an internal colon', () => {
    const parsed = parseSoundLine('sound += /HP: [0-9]+/:se/warn.mp3')
    expect(parsed?.path).toBe('se/warn.mp3')
    expect(parsed?.regex.test('HP: 12')).toBe(true)
  })

  it('applies sound_file_path to parsed sound paths', () => {
    const parsed = parseSoundLine('sound += /You kill/:Zdeath.mp3', 'se/')
    expect(parsed?.path).toBe('se/Zdeath.mp3')
  })

  it('snapshots all message texts before async playback can yield to translation', () => {
    const messages = [
      { text: 'You hit the dart slug.' },
      { text: 'You kill the dart slug!' },
    ]
    const snapshot = getSoundMessageTexts(messages)
    messages[1].text = '당신은 다트 민달팽이를 죽였다!'

    expect(snapshot).toEqual(['You hit the dart slug.', 'You kill the dart slug!'])
  })
})
