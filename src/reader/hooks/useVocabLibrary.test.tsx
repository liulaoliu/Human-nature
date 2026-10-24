// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { PERSIST_DELAY_MS, useVocabLibrary } from './useVocabLibrary'
import { MemoryVocabRepo } from '../../adapters/vocabRepo'
import { createLibrary } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import type { VocabRepoPort } from '../../core/ports'

/**
 * 词库持久化接线 —— **丢词事故的回归测试**。
 * 事故：IndexedDB 读失败 → 拿到空库 → 加载态被置 true → 自动补全把「空库 + 语言点」写回去 → 生词全丢。
 * 现在：读失败时 persist 硬拒绝写入，且提供「恢复上一版」。
 */
const lib = (n: number): VocabLibrary => ({
  ...createLibrary(),
  items: Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

/** 可编排的假仓储：想读成功就读成功，想失败就失败。 */
function fakeRepo(opts: { load?: () => Promise<VocabLibrary>; prev?: VocabLibrary | null } = {}) {
  const saved: VocabLibrary[] = []
  const repo: VocabRepoPort = {
    load: opts.load ?? (async () => lib(0)),
    save: async (l) => void saved.push(l),
    clear: async () => {},
    loadPrev: async () => opts.prev ?? null,
  }
  return { repo, saved }
}

const setup = (repoFactory: () => VocabRepoPort) => {
  const flash = vi.fn()
  return {
    flash,
    ...renderHook(() => useVocabLibrary({ flash, createRepo: repoFactory })),
  }
}

describe('useVocabLibrary：读成功', () => {
  it('读回来就是 ok，persist 能写、state 跟着变', async () => {
    const { repo, saved } = fakeRepo({ load: async () => lib(2) })
    const { result } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))
    expect(result.current.libraryLoaded).toBe(true)
    expect(result.current.library.items).toHaveLength(2)

    act(() => result.current.persist(lib(3)))
    expect(result.current.library.items).toHaveLength(3)
    expect(result.current.libraryRef.current.items).toHaveLength(3)
    // 落盘是合并写的（300ms 后），界面立刻更新不代表已经写出去
    await waitFor(() => expect(saved).toHaveLength(1))
  })
})

describe('useVocabLibrary：persistNow', () => {
  it('等真正落盘；失败抛给调用方，后续写入还能继续', async () => {
    let fail = true
    const saved: VocabLibrary[] = []
    const base = fakeRepo({ load: async () => lib(1) }).repo
    const repo: VocabRepoPort = {
      ...base,
      save: async (l) => {
        if (fail) throw new Error('409 conflict')
        saved.push(l)
      },
    }
    const { result } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    await act(async () => {
      await expect(result.current.persistNow(lib(2))).rejects.toThrow('409')
    })
    expect(result.current.library.items).toHaveLength(2)

    fail = false
    await act(async () => {
      await result.current.persistNow(lib(3))
    })
    expect(saved).toHaveLength(1)
    expect(saved[0].items).toHaveLength(3)
  })
})

describe('useVocabLibrary：写失败必须可见', () => {
  it('保存 reject → 提示用户，不静默吞掉', async () => {
    const base = fakeRepo({ load: async () => lib(1) }).repo
    const repo: VocabRepoPort = {
      ...base,
      save: async () => {
        throw new Error('quota exceeded')
      },
    }
    const { result, flash } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    act(() => result.current.persist(lib(2)))
    await waitFor(() => expect(flash).toHaveBeenCalledWith(expect.stringContaining('保存失败')))
    expect(result.current.library.items).toHaveLength(2)
  })
})

describe('useVocabLibrary：读失败（事故现场）', () => {
  it('读失败 → failed；persist **一次都不写**，只提示', async () => {
    const { repo, saved } = fakeRepo({ load: async () => { throw new Error('IDB blocked') } })
    const { result, flash } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('failed'))
    expect(result.current.libraryLoaded).toBe(false)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('词库读取失败'))

    act(() => result.current.persist(lib(5)))
    expect(saved).toHaveLength(0) // 关键：空库/半截库绝不落盘
    expect(result.current.library.items).toHaveLength(0)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('不写入'))
  })

  it('读失败后可以「恢复上一版」：写回备份、状态转 ok', async () => {
    const { repo, saved } = fakeRepo({
      load: async () => { throw new Error('boom') },
      prev: lib(9),
    })
    const { result, flash } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('failed'))

    await act(async () => {
      await result.current.restorePrev()
    })
    expect(result.current.library.items).toHaveLength(9)
    expect(result.current.libraryLoad).toBe('ok')
    expect(saved[0].items).toHaveLength(9)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('已恢复上一版词库：9 条'))
  })

  it('没有备份时恢复给个明确提示，不动数据', async () => {
    const { repo, saved } = fakeRepo({ load: async () => { throw new Error('boom') }, prev: null })
    const { result, flash } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('failed'))
    await act(async () => {
      await result.current.restorePrev()
    })
    expect(saved).toHaveLength(0)
    expect(result.current.library.items).toHaveLength(0)
    expect(flash).toHaveBeenCalledWith('没有可恢复的上一版')
  })
})

describe('useVocabLibrary：合并写（别每点一个词就全量重写 16MB）', () => {
  it('300ms 内连点多次只落一次盘，且写的是最新那版', async () => {
    const { repo, saved } = fakeRepo({ load: async () => lib(0) })
    const { result } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    act(() => {
      result.current.persist(lib(1))
      result.current.persist(lib(2))
      result.current.persist(lib(3))
    })
    // 界面立刻是最新的
    expect(result.current.library.items).toHaveLength(3)

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].items).toHaveLength(3)
    // 再等一会儿也不该补写第二、第三次
    await new Promise((r) => setTimeout(r, PERSIST_DELAY_MS + 100))
    expect(saved).toHaveLength(1)
  })

  it('卸载时把还没落盘的那版刷出去（别丢最后一次改动）', async () => {
    const { repo, saved } = fakeRepo({ load: async () => lib(0) })
    const { result, unmount } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    act(() => result.current.persist(lib(2)))
    expect(saved).toHaveLength(0) // 还在合并窗口里
    unmount()
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].items).toHaveLength(2)
  })

  it('连续操作不饿死：最迟 PERSIST_MAX_WAIT_MS 强制落一次盘', async () => {
    const { repo, saved } = fakeRepo({ load: async () => lib(0) })
    const { result } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    // 每 200ms 改一次，模拟一直有点击（300ms 的窗口会被不断重置）
    for (let i = 1; i <= 7; i++) {
      act(() => result.current.persist(lib(i)))
      await new Promise((r) => setTimeout(r, 200))
    }
    // 7 × 200ms = 1400ms > PERSIST_MAX_WAIT_MS，必须已经写过至少一次
    expect(saved.length).toBeGreaterThanOrEqual(1)
  })

  it('保存失败后自动退避重试，不需要用户再点一次', async () => {
    let attempts = 0
    const saved: number[] = []
    const repo: VocabRepoPort = {
      load: async () => lib(0),
      save: async (l) => {
        attempts++
        if (attempts === 1) throw new Error('network down')
        saved.push(l.items.length)
      },
      clear: async () => {},
      loadPrev: async () => null,
    }
    const { result, flash } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    act(() => result.current.persist(lib(2)))
    await waitFor(() => expect(flash).toHaveBeenCalledWith(expect.stringContaining('正在自动重试')), {
      timeout: 2000,
    })
    await waitFor(() => expect(saved).toEqual([2]), { timeout: 4000 })
    expect(attempts).toBe(2)
  })

  it('保存按顺序串行：前一次没回来不发下一次（否则必撞 409）', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const saved: number[] = []
    const repo: VocabRepoPort = {
      load: async () => lib(0),
      save: async (l) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 50))
        saved.push(l.items.length)
        inFlight--
      },
      clear: async () => {},
      loadPrev: async () => null,
    }
    const { result } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))

    act(() => result.current.persist(lib(1)))
    await new Promise((r) => setTimeout(r, PERSIST_DELAY_MS + 80))
    act(() => result.current.persist(lib(2)))
    await waitFor(() => expect(saved).toEqual([1, 2]))
    expect(maxInFlight).toBe(1)
  })
})

describe('useVocabLibrary：与真实内存仓储打通', () => {
  it('存/读/上一版/恢复 一条链', async () => {
    const repo = new MemoryVocabRepo()
    await repo.save(lib(4))
    const { result } = setup(() => repo)
    await waitFor(() => expect(result.current.libraryLoad).toBe('ok'))
    expect(result.current.library.items).toHaveLength(4)

    act(() => result.current.persist(lib(6)))
    await act(async () => {
      await result.current.restorePrev()
    })
    expect(result.current.library.items).toHaveLength(4) // 退回上一版
  })
})
