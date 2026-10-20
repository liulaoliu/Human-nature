// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStorageQuotaToast } from './useStorageQuotaToast'
import { STORAGE_ERROR_EVENT } from './useLocalStorageState'

const fire = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT))
  })

afterEach(() => vi.useRealTimers())

describe('useStorageQuotaToast（本机存储写失败提示）', () => {
  it('收到写失败事件就提示一次', () => {
    const flash = vi.fn()
    renderHook(() => useStorageQuotaToast(flash))
    fire()
    expect(flash).toHaveBeenCalledTimes(1)
    expect(flash.mock.calls[0][0]).toContain('本机存储已满')
  })

  it('5 秒内连续多次只提示一次（一次操作会连写好几个键）', () => {
    vi.useFakeTimers()
    const flash = vi.fn()
    renderHook(() => useStorageQuotaToast(flash))
    fire()
    fire()
    fire()
    expect(flash).toHaveBeenCalledTimes(1)
  })

  it('过了 5 秒再失败还会提示（不是只提示一次就永久闭嘴）', () => {
    vi.useFakeTimers()
    const flash = vi.fn()
    renderHook(() => useStorageQuotaToast(flash))
    fire()
    act(() => vi.advanceTimersByTime(6000))
    fire()
    expect(flash).toHaveBeenCalledTimes(2)
  })

  it('卸载后不再提示', () => {
    const flash = vi.fn()
    const { unmount } = renderHook(() => useStorageQuotaToast(flash))
    unmount()
    fire()
    expect(flash).not.toHaveBeenCalled()
  })
})
