// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../test/fake-storage'
import { clearCredentials, loadCredentials, saveCredentials } from './credentials'

vi.stubGlobal('localStorage', fakeStorage())

const WS_URL = 'wss://test.example/socket'

afterEach(() => {
  localStorage.clear()
})

describe('stored credentials', () => {
  it('saves, loads, and clears credentials by server and username', () => {
    saveCredentials(WS_URL, 'Tester', 'pw')

    expect(loadCredentials(WS_URL, 'tester')).toMatchObject({
      wsUrl: WS_URL,
      username: 'Tester',
      password: 'pw',
    })

    clearCredentials(WS_URL, 'TESTER')
    expect(loadCredentials(WS_URL, 'tester')).toBeNull()
  })

  it('drops corrupt entries', () => {
    localStorage.setItem(`pocketzot:credentials:${WS_URL}\x00tester`, '{bad json')

    expect(loadCredentials(WS_URL, 'tester')).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})
