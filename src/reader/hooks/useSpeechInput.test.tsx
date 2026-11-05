// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSpeechInput } from './useSpeechInput'

describe('useSpeechInput：不支持时不炸', () => {
  it('没有 Web Speech API 时 supported=false，start 只报错', () => {
    const { result } = renderHook(() => useSpeechInput({ onText: () => {} }))
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.listening).toBe(false)
    expect(result.current.error).toContain('不支持语音输入')
  })
})
