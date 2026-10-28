// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useDictationSnapshot } from './useDictationSnapshot'
import { installFakeStorage } from '../testStorage'

const KEY = 'reader:dictSession'

describe('useDictationSnapshot', () => {
  let restoreStorage: () => void
  beforeEach(() => {
    restoreStorage = installFakeStorage()
  })
  afterEach(() => {
    restoreStorage()
    vi.restoreAllMocks()
  })

  it('会话变化时落盘，刷新后按快照恢复并对齐模式', async () => {
    const setMode = vi.fn()
    const first = renderHook(() => useDictationSnapshot({ mode: 'cloze', setMode }))
    act(() => {
      first.result.current.setQueue([{ id: 'a', text: 'Hello world.' }])
      first.result.current.setIndex(0)
      first.result.current.setInput('Hello')
    })
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').input).toBe('Hello')
    })

    const second = renderHook(() => useDictationSnapshot({ mode: 'full', setMode }))
    expect(second.result.current.restored?.queue[0].text).toBe('Hello world.')
    expect(second.result.current.input).toBe('Hello')
    await waitFor(() => expect(setMode).toHaveBeenCalledWith('cloze'))
  })

  it('坏快照当作没有，不把半截结构带进业务', () => {
    localStorage.setItem(KEY, '{"v":1,"queue":[{"id":""}],"mode":"cloze"}')
    const { result } = renderHook(() => useDictationSnapshot({ mode: 'full', setMode: vi.fn() }))
    expect(result.current.restored).toBeNull()
    expect(result.current.queue).toBeNull()
  })
})
