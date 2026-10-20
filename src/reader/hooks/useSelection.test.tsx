// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { VocabLibrary } from '../../types/document'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useSelection, type UseSelectionParams } from './useSelection'

// jsdom 没有 CSS.escape；focusEntry/scrollToSid 的 rAF 回调里会用到
beforeEach(() => {
  const css = (globalThis.CSS ?? {}) as { escape?: (s: string) => string }
  css.escape ??= (s: string) => s.replace(/["\\\]]/g, '\\$&')
  globalThis.CSS = css as unknown as typeof globalThis.CSS
})

function library(items = [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })]): VocabLibrary {
  return { schemaVersion: 1, items }
}

function setup(over: Partial<UseSelectionParams> = {}) {
  const params: UseSelectionParams = {
    selectedId: null,
    setSelectedId: vi.fn(),
    exact: '',
    setExact: vi.fn(),
    setUseExact: vi.fn(),
    selSid: null,
    setSelSid: vi.fn(),
    selIndices: [],
    setSelIndices: vi.fn(),
    ctrlHeld: false,
    altHeld: false,
    peekSid: null,
    setPeekSid: vi.fn(),
    lastPicked: null,
    setLastPicked: vi.fn(),
    setBubblePos: vi.fn(),
    batch: [],
    addToBatch: vi.fn(),
    sentence: sentenceFixture('s1', 'Run fast.'),
    vocabMode: false,
    editing: false,
    doc: { sentences: [sentenceFixture('s1', 'Run fast.'), sentenceFixture('s2', 'Walk slow.')] },
    library: library(),
    persist: vi.fn(),
    articleIdentity: 'file:a.md',
    articleTitle: 'A',
    articleKey: 'a.md',
    setFocusLemma: vi.fn(),
    articleRef: { current: null },
    sideRef: { current: null },
    applyingDom: { current: false },
    rightDownRef: { current: false },
    sessionPickedRef: { current: 0 },
    navVocabRef: { current: () => {} },
    stopReadAll: vi.fn(),
    fontSize: '18px',
    bold: false,
    serif: false,
    flash: vi.fn(),
    ...over,
  }
  const hook = renderHook(() => useSelection(params))
  return { ...hook, params }
}

describe('useSelection：点句 / A-D 导航', () => {
  it('点新句子 → 停止朗读并选中', () => {
    const { result, params } = setup()
    result.current.selectSentence('s2')
    expect(params.stopReadAll).toHaveBeenCalled()
    expect(params.setSelectedId).toHaveBeenCalledWith('s2')
  })

  it('再点同一句 → 只停朗读，不重复写选中', () => {
    const { result, params } = setup({ selectedId: 's1' })
    result.current.selectSentence('s1')
    expect(params.stopReadAll).toHaveBeenCalled()
    expect(params.setSelectedId).not.toHaveBeenCalled()
  })

  it('A/D：没有游标时从头/从尾开始，有游标时循环', () => {
    const first = setup()
    first.result.current.navigateVocab(1)
    expect(first.params.setPeekSid).toHaveBeenCalledWith('s1')

    const last = setup()
    last.result.current.navigateVocab(-1)
    expect(last.params.setPeekSid).toHaveBeenCalledWith('s2')

    const next = setup({ peekSid: 's2' })
    next.result.current.navigateVocab(1)
    expect(next.params.setPeekSid).toHaveBeenCalledWith('s1')
  })
})

describe('useSelection：加入待选 / 直接入库', () => {
  it('有精确选区 → 加待选、计数、清空选区并提示', () => {
    const { result, params } = setup({ exact: 'run fast' })
    result.current.addSelectionToBatch()
    expect(params.addToBatch).toHaveBeenCalledWith(['run fast'], 'Run fast.', 's1')
    expect(params.sessionPickedRef.current).toBe(1)
    expect(params.setLastPicked).toHaveBeenCalledWith({ word: 'run fast', sid: 's1' })
    expect(params.setSelSid).toHaveBeenCalledWith(null)
    expect(params.setSelIndices).toHaveBeenCalledWith([])
    expect(params.flash).toHaveBeenCalledWith('已加入待选：run fast')
  })

  it('空选区 → 什么都不做', () => {
    const { result, params } = setup({ exact: '   ' })
    result.current.addSelectionToBatch()
    expect(params.addToBatch).not.toHaveBeenCalled()
    expect(params.flash).not.toHaveBeenCalled()
  })

  it('已在待选里的词不重复计数（词形相同）', () => {
    const { result, params } = setup({
      exact: 'running',
      batch: [{ word: 'run', sentence: 'x', sentenceId: null }],
    })
    result.current.addSelectionToBatch()
    expect(params.addToBatch).toHaveBeenCalled()
    expect(params.sessionPickedRef.current).toBe(0)
  })

  it('选词模式下右键 = 加入待选', () => {
    const { result, params } = setup({ vocabMode: true, exact: 'run' })
    const preventDefault = vi.fn()
    result.current.onContextMenu({ preventDefault } as never)
    expect(preventDefault).toHaveBeenCalled()
    expect(params.addToBatch).toHaveBeenCalledWith(['run'], 'Run fast.', 's1')
  })

  it('选词模式下没有精确选区也屏蔽原生菜单，但不加待选', () => {
    const { result, params } = setup({ vocabMode: true, exact: '   ' })
    const preventDefault = vi.fn()
    result.current.onContextMenu({ preventDefault } as never)
    expect(preventDefault).toHaveBeenCalled()
    expect(params.addToBatch).not.toHaveBeenCalled()
  })

  it('没开选词模式 → 不拦截原生右键菜单', () => {
    const { result, params } = setup({ vocabMode: false, exact: 'run' })
    const preventDefault = vi.fn()
    result.current.onContextMenu({ preventDefault } as never)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(params.addToBatch).not.toHaveBeenCalled()
  })

  it('mark：没选区只提示；有选区走唯一写入口 persist', () => {
    const empty = setup()
    empty.result.current.mark()
    expect(empty.params.flash).toHaveBeenCalledWith(expect.stringContaining('先划一个单词'))
    expect(empty.params.persist).not.toHaveBeenCalled()

    const { result, params } = setup({ exact: 'run', library: library([]) })
    result.current.mark()
    expect(params.persist).toHaveBeenCalledTimes(1)
    const next = vi.mocked(params.persist).mock.calls[0][0]
    expect(next.items.some((x) => x.lemma === 'run')).toBe(true)
    expect(params.flash).toHaveBeenCalledWith(expect.stringContaining('已加入'))
  })
})

describe('useSelection：回原文定位', () => {
  it('没有文章 → 直接返回', () => {
    const { result, params } = setup({ doc: null })
    result.current.jumpToSource(vocabItem({ id: 'v1', word: 'run', lemma: 'run' }))
    expect(params.setPeekSid).not.toHaveBeenCalled()
  })

  it('按来源句命中 → 定位且不写库', () => {
    const item = vocabItem({
      id: 'v1',
      word: 'run',
      lemma: 'run',
      source: { articleId: 'A', fileName: 'file:a.md', sentenceId: 's2', sentenceText: 'Walk slow.' },
    })
    const { result, params } = setup({ library: library([item]) })
    result.current.jumpToSource(item)
    expect(params.setPeekSid).toHaveBeenCalledWith('s2')
    expect(params.persist).not.toHaveBeenCalled()
  })

  it('来源句不在本篇 → 搜正文命中并回填来源', () => {
    const item = vocabItem({ id: 'v1', word: 'walk', lemma: 'walk' })
    const { result, params } = setup({ library: library([item]) })
    result.current.jumpToSource(item)
    expect(params.setPeekSid).toHaveBeenCalledWith('s2')
    expect(params.persist).toHaveBeenCalledTimes(1)
    const next = vi.mocked(params.persist).mock.calls[0][0]
    expect(next.items[0].source?.sentenceId).toBe('s2')
  })

  it('正文里也没有 → 提示「找不到」', () => {
    const { result, params } = setup()
    result.current.jumpToSource(vocabItem({ id: 'v1', word: 'zzz', lemma: 'zzz' }))
    expect(params.flash).toHaveBeenCalledWith('当前这篇里找不到这个词')
  })
})
