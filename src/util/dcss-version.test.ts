import { describe, expect, it } from 'vitest'
import { parseDcssVersion, isBelowSupportCutoff, formatDcssVersion } from './dcss-version'

describe('parseDcssVersion', () => {
  it('parses versioned game ids', () => {
    expect(parseDcssVersion('dcss-0.24')).toEqual({ major: 0, minor: 24 })
    expect(parseDcssVersion('seeded-0.34')).toEqual({ major: 0, minor: 34 })
    expect(parseDcssVersion('sprint-0.11')).toEqual({ major: 0, minor: 11 })
  })

  it('parses semantic gamedata dirs, ignoring the patch component', () => {
    expect(parseDcssVersion('0.24')).toEqual({ major: 0, minor: 24 })
    expect(parseDcssVersion('0.34.1')).toEqual({ major: 0, minor: 34 })
  })

  it('fails open (null) on trunk ids, fork names, and hash dirs', () => {
    expect(parseDcssVersion('dcss-web-trunk')).toBeNull()
    expect(parseDcssVersion('dcss-git')).toBeNull()
    expect(parseDcssVersion('bcrawl')).toBeNull()
    expect(parseDcssVersion('acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8')).toBeNull()
    expect(parseDcssVersion(undefined)).toBeNull()
    expect(parseDcssVersion()).toBeNull()
  })

  it('takes the first candidate that parses', () => {
    expect(parseDcssVersion('dcss-web-trunk', '0.23')).toEqual({ major: 0, minor: 23 })
    expect(parseDcssVersion('dcss-0.22', '0.34')).toEqual({ major: 0, minor: 22 })
  })
})

describe('isBelowSupportCutoff', () => {
  it('true only below 0.24', () => {
    expect(isBelowSupportCutoff({ major: 0, minor: 23 })).toBe(true)
    expect(isBelowSupportCutoff({ major: 0, minor: 11 })).toBe(true)
    expect(isBelowSupportCutoff({ major: 0, minor: 24 })).toBe(false)
    expect(isBelowSupportCutoff({ major: 0, minor: 34 })).toBe(false)
    expect(isBelowSupportCutoff({ major: 1, minor: 0 })).toBe(false)
  })

  it('unknown version is modern (fail open)', () => {
    expect(isBelowSupportCutoff(null)).toBe(false)
  })
})

describe('formatDcssVersion', () => {
  it('renders major.minor', () => {
    expect(formatDcssVersion({ major: 0, minor: 23 })).toBe('0.23')
  })
})
