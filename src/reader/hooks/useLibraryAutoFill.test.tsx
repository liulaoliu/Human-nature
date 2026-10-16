// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Sentence } from '../../types/document'
import { createLibrary, markWord } from '../../core/vocab'
import { useLibraryAutoFill } from './useLibraryAutoFill'
import { installFakeStorage } from '../testStorage'

/**
 * 词库自动补全的接线（**唯一写入口**）。
 *
 * 这层测试存在的理由就是踩坑 #1：以前「离线例句」和「语言点收藏」两个 effect 各自读库写库，
 * 谁后写谁覆盖，词库条目数会来回跳。这里用 renderHook 直接钉住「写几次、写的是什么」。
 */
const withLang = (id: string, text: string, phrases: string[], usage: string[] = []): Sentence => ({
  id,
  paraId: 'p01',
  text,
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  languages: [{ phrases, usage, source: 'ai' }],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
})

let restoreStorage: () => void = () => {}
beforeEach(() => {
  restoreStorage = installFakeStorage()
})
afterEach(() => restoreStorage())

function setup(over: Partial<Parameters<typeof useLibraryAutoFill>[0]> = {}) {
  const writes: number[] = []
  const libraryRef = { current: createLibrary() }
  const persist = vi.fn((lib: typeof libraryRef.current) => {
    libraryRef.current = lib
    writes.push(lib.items.length)
  })
  const props = {
    sentences: [withLang('s1', 'He falls back on it.', ['fall back on — 转而依靠'])] as Parameters<
      typeof useLibraryAutoFill
    >[0]['sentences'],
    saved: [],
    articleIdentity: 'A',
    libraryRef,
    libraryLoaded: true,
    persist,
    ...over,
  }
  const view = renderHook((p: typeof props) => useLibraryAutoFill(p), { initialProps: props })
  return { ...view, persist, writes, libraryRef, props }
}

describe('useLibraryAutoFill（唯一写入口）', () => {
  it('有语言点 → 收进词库，且**只写一次**', () => {
    const { persist, libraryRef } = setup()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(libraryRef.current.items).toHaveLength(1)
    expect(libraryRef.current.items[0].word).toBe('fall back on')
    expect(libraryRef.current.items[0].meaning).toBe('转而依靠')
    expect(libraryRef.current.items[0].langPointId).toBeTruthy()
  })

  it('重渲染（同样的素材）不再写库 —— 这就是「数量来回跳」的回归测试', () => {
    const { persist, rerender, props } = setup()
    expect(persist).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) rerender({ ...props })
    expect(persist).toHaveBeenCalledTimes(1) // 一次都没多
  })

  it('换一篇文章：只补新那篇的语言点（已收过的篇不动）', () => {
    const s1 = withLang('s1', 'He falls back on it.', ['fall back on — 转而依靠'])
    const s2 = withLang('s1', 'It takes its toll.', ['take its toll — 造成损害'])
    const { persist, rerender, libraryRef, props } = setup({ sentences: [s1], articleIdentity: 'A' })
    expect(persist).toHaveBeenCalledTimes(1)
    rerender({ ...props, sentences: [s2], articleIdentity: 'B' })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(libraryRef.current.items.map((it) => it.word).sort()).toEqual(['fall back on', 'take its toll'])
  })

  it('词库没读成功就绝不写 —— 「读失败→空库被覆盖」那次丢词事故的回归测试', () => {
    const { persist, rerender, props } = setup({ libraryLoaded: false })
    expect(persist).not.toHaveBeenCalled()
    rerender({ ...props, libraryLoaded: true })
    expect(persist).toHaveBeenCalledTimes(1)
    // 关键：failed 期间一次都没写（否则空库会覆盖回 IndexedDB，生词全丢）
  })

  it('没有语言点：一个字都不写', () => {
    const { persist } = setup({ sentences: [withLang('s1', 'Plain.', [])] })
    expect(persist).not.toHaveBeenCalled()
  })

  it('已保存的其它文章的语言点也收（跨文章累积语境）', () => {
    const { libraryRef, persist } = setup({
      articleIdentity: 'B',
      sentences: [],
      saved: [{ id: 'A', sentences: [withLang('s1', 'He falls back on it.', ['fall back on — 转而依靠'])] }],
    } as never)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(libraryRef.current.items[0].source?.fileName).toBe('A')
    expect(libraryRef.current.items[0].contexts).toHaveLength(1)
  })

  it('和普通单词共存：补全不会把已有单词弄丢', () => {
    const { libraryRef } = setup()
    act(() => {
      libraryRef.current = markWord(libraryRef.current, { word: 'run', articleId: 'A' }).library
    })
    expect(libraryRef.current.items.map((it) => it.word)).toContain('run')
  })
})

describe('useLibraryAutoFill：重收语言点', () => {
  it('调用后清掉「已收记账」→ effect 会重新收一遍', async () => {
    const { persist, result, rerender, props } = setup()
    expect(persist).toHaveBeenCalledTimes(1)
    // 假装已经收过（记账清掉后再渲染，effect 会重新收）
    act(() => result.current.recollectLanguagePoints())
    rerender({ ...props })
    await waitFor(() => expect(persist.mock.calls.length).toBeGreaterThanOrEqual(1))
    expect(result.current.languagePointCount).toBe(1)
  })
})
