import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createShiftToggle } from './shift-state'

// shift-state.ts reads `performance.now()` directly for the double-tap window.
// Spy on it so tests can drive time deterministically without real waits.
let nowSpy: ReturnType<typeof vi.spyOn>
let currentTime = 0
beforeEach(() => {
  currentTime = 1000
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => currentTime)
})
afterEach(() => {
  nowSpy.mockRestore()
})
const advance = (ms: number) => { currentTime += ms }

describe('createShiftToggle — base state machine', () => {
  it('starts off', () => {
    const t = createShiftToggle()
    expect(t.state).toBe('off')
    expect(t.isOn).toBe(false)
  })

  it('tap from off → once', () => {
    const t = createShiftToggle()
    t.tap()
    expect(t.state).toBe('once')
    expect(t.isOn).toBe(true)
  })

  it('tap from once outside the double-tap window → off', () => {
    const t = createShiftToggle({ doubleTapMs: 300 })
    t.tap()           // off → once
    advance(500)
    t.tap()           // once + slow → off (fallthrough else)
    expect(t.state).toBe('off')
  })

  it('tap from once inside the double-tap window → lock', () => {
    const t = createShiftToggle({ doubleTapMs: 300 })
    t.tap()           // off → once
    advance(100)
    t.tap()           // once + quick → lock
    expect(t.state).toBe('lock')
  })

  it('tap from lock → off (cycle wraps)', () => {
    const t = createShiftToggle({ doubleTapMs: 300 })
    t.tap()           // off → once
    advance(50)
    t.tap()           // → lock
    t.tap()           // lock + anything → off (fallthrough else)
    expect(t.state).toBe('off')
  })

  it('doubleTapMs default is 300', () => {
    const t = createShiftToggle()
    t.tap()
    advance(299)
    t.tap()
    expect(t.state).toBe('lock')

    const t2 = createShiftToggle()
    t2.tap()
    advance(301)
    t2.tap()
    expect(t2.state).toBe('off')
  })
})

describe('createShiftToggle — consume()', () => {
  it('clears once → off', () => {
    const t = createShiftToggle()
    t.tap()
    t.consume()
    expect(t.state).toBe('off')
  })

  it('does NOT clear lock (sticky behavior)', () => {
    const t = createShiftToggle()
    t.tap()
    advance(50)
    t.tap()           // → lock
    t.consume()
    expect(t.state).toBe('lock')
  })

  it('no-op when already off', () => {
    const t = createShiftToggle()
    t.consume()
    expect(t.state).toBe('off')
  })
})

describe('createShiftToggle — reset()', () => {
  it('forces lock → off (e.g. menu closed)', () => {
    const t = createShiftToggle()
    t.tap()
    advance(50)
    t.tap()
    expect(t.state).toBe('lock')
    t.reset()
    expect(t.state).toBe('off')
  })
})

describe('createShiftToggle — onChange notifications', () => {
  it('fires only on actual state transitions', () => {
    const onChange = vi.fn()
    const t = createShiftToggle({ onChange })
    t.tap()             // off → once: fires
    advance(50)
    t.tap()             // once → lock: fires
    t.consume()         // lock → lock: no fire (consume keeps lock)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not fire when consume is called on off state', () => {
    const onChange = vi.fn()
    const t = createShiftToggle({ onChange })
    t.consume()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reset fires when state was non-off', () => {
    const onChange = vi.fn()
    const t = createShiftToggle({ onChange })
    t.tap()             // 1
    t.reset()           // 2
    t.reset()           // already off — no fire
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('createShiftToggle — guarantee both surfaces stay in sync', () => {
  // Two surfaces (virtual keyboard, in-menu ⇧) instantiate their own
  // toggles, but identical input sequences must produce identical state.
  // This is the contract that prevents drift between them.
  it('identical sequences yield identical state', () => {
    const a = createShiftToggle()
    const b = createShiftToggle()
    const sequence = () => {
      a.tap(); b.tap()
      advance(50)
      a.tap(); b.tap()    // both → lock
      a.consume(); b.consume()  // both still lock
    }
    sequence()
    expect(a.state).toBe(b.state)
    expect(a.state).toBe('lock')
  })
})
