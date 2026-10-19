// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeStorage } from '../testStorage'
import { STORAGE_ERROR_EVENT, useLocalStorageState } from './useLocalStorageState'

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
})

afterEach(() => {
  restoreStorage()
  vi.restoreAllMocks()
})

describe('useLocalStorageState', () => {
  it('首次挂载不回写（避免默认值覆盖已有数据）', () => {
    const setItem = vi.spyOn(localStorage, 'setItem')
    renderHook(() => useLocalStorageState('reader:test', 'a'))
    expect(setItem).not.toHaveBeenCalled()
  })

  it('写入成功：落盘并广播 reader:local-state', () => {
    const onLocal = vi.fn()
    window.addEventListener('reader:local-state', onLocal)
    const { result } = renderHook(() => useLocalStorageState('reader:test', 'a'))
    act(() => result.current[1]('b'))
    expect(localStorage.getItem('reader:test')).toBe('"b"')
    expect(onLocal).toHaveBeenCalledWith(expect.objectContaining({ detail: { key: 'reader:test' } }))
    window.removeEventListener('reader:local-state', onLocal)
  })

  it('配额满：不静默，广播 reader:storage-error（界面负责提示）', () => {
    const onError = vi.fn()
    window.addEventListener(STORAGE_ERROR_EVENT, onError)
    const { result } = renderHook(() => useLocalStorageState('reader:test', 'a'))
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    act(() => result.current[1]('b'))
    // 内存里仍然更新（界面可用），但用户会被提示
    expect(result.current[0]).toBe('b')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ detail: { key: 'reader:test' } }))
    window.removeEventListener(STORAGE_ERROR_EVENT, onError)
  })
})
