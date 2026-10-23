// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { dictionaryReady, loadDictionary } from '../../adapters/dictionary'
import { useDictionary } from './useDictionary'

vi.mock('../../adapters/dictionary', () => ({
  dictionaryReady: vi.fn(),
  loadDictionary: vi.fn(),
}))

const ready = vi.mocked(dictionaryReady)
const load = vi.mocked(loadDictionary)

beforeEach(() => {
  ready.mockReset()
  load.mockReset()
})

describe('useDictionary', () => {
  it('已就绪时不再重复加载', () => {
    ready.mockReturnValue(true)
    const { result } = renderHook(() => useDictionary())
    expect(result.current).toBe(true)
    expect(load).not.toHaveBeenCalled()
  })

  it('未就绪 → 加载成功后就绪', async () => {
    ready.mockReturnValue(false)
    load.mockResolvedValue(true)
    const { result } = renderHook(() => useDictionary())
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('加载失败保持未就绪（不重试、不报错）', async () => {
    ready.mockReturnValue(false)
    load.mockResolvedValue(false)
    const { result } = renderHook(() => useDictionary())
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('卸载后完成的加载不再回写状态', async () => {
    ready.mockReturnValue(false)
    let finish: (ok: boolean) => void = () => {}
    load.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)))
    const { unmount } = renderHook(() => useDictionary())
    // 词典现在是「空闲时再加载」，先等它真的启动，再模拟卸载
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    unmount()
    finish(true)
    await Promise.resolve()
    // 卸载后 resolve 不该再触发状态更新（React 会警告），调用次数也不该变
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('还没等到空闲就卸载：干脆不启动加载（不白烧几百毫秒解析）', async () => {
    ready.mockReturnValue(false)
    load.mockResolvedValue(true)
    const { unmount } = renderHook(() => useDictionary())
    unmount()
    await new Promise((r) => setTimeout(r, 400))
    expect(load).not.toHaveBeenCalled()
  })
})
