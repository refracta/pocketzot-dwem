// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundManager } from './sound-support'

interface FakeSource {
  buffer: AudioBuffer | null
  loop: boolean
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  sources: FakeSource[] = []
  suspend = vi.fn(async () => { this.state = 'suspended' })
  resume = vi.fn(async () => { this.state = 'running' })

  constructor() {
    contexts.push(this)
  }

  createGain(): GainNode {
    return {
      gain: {
        value: 0,
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    } as unknown as GainNode
  }

  createBufferSource(): AudioBufferSourceNode {
    const source: FakeSource = {
      buffer: null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    return {} as AudioBuffer
  }
}

let contexts: FakeAudioContext[] = []

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  contexts = []
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SoundManager visibility handling', () => {
  it('does not start new FX while the page is hidden', async () => {
    const manager = new SoundManager()

    manager.setPageVisible(false)
    await manager.play({} as AudioBuffer)

    expect(contexts).toHaveLength(0)
  })

  it('suspends existing audio while hidden and resumes it when visible', async () => {
    const manager = new SoundManager()

    await manager.playLoop({} as AudioBuffer)
    const context = contexts[0]!
    expect(context.sources[0]!.start).toHaveBeenCalledWith(0)

    manager.setPageVisible(false)
    await flushPromises()
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('suspended')

    manager.setPageVisible(true)
    await flushPromises()
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')
  })

  it('does not create a queued BGM source while hidden', async () => {
    const manager = new SoundManager()

    manager.setPageVisible(false)
    await manager.playLoop({} as AudioBuffer)

    expect(contexts).toHaveLength(0)
    expect(manager.currentlyLoopingBgm).toBe(false)
  })
})
