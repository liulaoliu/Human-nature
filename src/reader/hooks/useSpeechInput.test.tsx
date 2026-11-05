// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSpeechInput } from './useSpeechInput'

class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  started = false
  constructor() {
    FakeRecognition.last = this
  }
  start() {
    this.started = true
  }
  stop() {
    this.onend?.()
  }
  abort() {
    this.onend?.()
  }
}

afterEach(() => {
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition
  FakeRecognition.last = null
})

describe('useSpeechInput：浏览器语音输入', () => {
  it('没有 Web Speech API 时 supported=false，start 只报错', () => {
    const { result } = renderHook(() => useSpeechInput({ onText: () => {} }))
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.listening).toBe(false)
    expect(result.current.error).toContain('不支持语音输入')
  })

  it('只把最终结果交给 onText，停止后复位', () => {
    ;(window as Window & { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition
    const onText = vi.fn()
    const { result } = renderHook(() => useSpeechInput({ lang: 'en-US', onText }))
    expect(result.current.supported).toBe(true)

    act(() => result.current.start())
    expect(result.current.listening).toBe(true)
    expect(FakeRecognition.last?.lang).toBe('en-US')

    act(() => {
      FakeRecognition.last?.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: false, 0: { transcript: 'half' } },
          { isFinal: true, 0: { transcript: 'final sentence' } },
        ],
      })
    })
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledWith('final sentence')

    act(() => result.current.stop())
    expect(result.current.listening).toBe(false)
  })
})
