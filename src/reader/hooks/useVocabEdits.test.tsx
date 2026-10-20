// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { VocabLibrary } from '../../types/document'
import { createLibrary } from '../../core/vocab'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useVocabEdits } from './useVocabEdits'

/** 假 persist：同步更新 ref（与 useVocabLibrary.persist 的行为一致），并记下每次写入。 */
function setup(initial: VocabLibrary = createLibrary()) {
  const ref = { current: initial } as MutableRefObject<VocabLibrary>
  const persist = vi.fn((next: VocabLibrary) => {
    ref.current = next
  })
  const flash = vi.fn()
  const params = {
    libraryRef: ref,
    persist,
    article: { identity: 'a1', title: 'Article A', key: null as string | null },
    flash,
  }
  const hook = renderHook(() => useVocabEdits(params))
  return { ...hook, ref, persist, flash }
}

describe('useVocabEdits：批量直入', () => {
  it('跳过空白词，按 lemma 去重，只写一次；来源记到当前文章', () => {
    const { result, persist } = setup()
    act(() =>
      result.current.commitBatchItems([
        { word: ' running ', sentence: 'I run every day.', sentenceId: 's1' },
        { word: '   ', sentence: '空词', sentenceId: null },
      ]),
    )
    expect(persist).toHaveBeenCalledOnce()
    const saved = persist.mock.calls[0][0]
    expect(saved.items.map((i) => i.lemma)).toEqual(['run'])
    expect(saved.items[0].source).toMatchObject({
      articleId: 'Article A',
      fileName: 'a1',
      sentenceId: 's1',
      sentenceText: 'I run every day.',
    })
  })

  it('全是空词时一次都不写', () => {
    const { result, persist } = setup()
    act(() => result.current.commitBatchItems([{ word: '  ', sentence: '', sentenceId: null }]))
    expect(persist).not.toHaveBeenCalled()
  })

  it('用 ref 里的最新词库：连续两次不会互相覆盖', () => {
    const { result, persist } = setup()
    act(() => {
      result.current.commitBatchItems([{ word: 'quiet', sentence: 'Be quiet.', sentenceId: null }])
      result.current.commitBatchItems([{ word: 'calm', sentence: 'Stay calm.', sentenceId: null }])
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1][0].items.map((i) => i.lemma).sort()).toEqual(['calm', 'quiet'])
  })
})

describe('useVocabEdits：速读手动加词', () => {
  it('加成功提示数量；重复加入时提示「已在生词本」', () => {
    const { result, persist, flash } = setup()
    act(() => result.current.addItems([{ word: ' quiet ', sentenceId: 's1', sentenceText: 'Be quiet.' }]))
    expect(persist.mock.calls[0][0].items.map((i) => i.lemma)).toEqual(['quiet'])
    expect(flash).toHaveBeenCalledWith('已加入 1 个生词：quiet')

    act(() => result.current.addItems([{ word: 'quiet', sentenceId: 's1', sentenceText: 'Be quiet.' }]))
    expect(flash).toHaveBeenLastCalledWith('已在生词本：quiet')
  })

  it('空列表不写库、不提示', () => {
    const { result, persist, flash } = setup()
    act(() => result.current.addItems([{ word: '   ', sentenceId: null, sentenceText: '' }]))
    expect(persist).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  })
})

describe('useVocabEdits：语言点词组', () => {
  it('「英文 — 中文」拆成词条 + 释义，挂到当前句', () => {
    const { result, persist, flash } = setup()
    const sentence = sentenceFixture('s1', 'The plan will run out of money.')
    act(() => result.current.addPhrases(['run out — 用完', 'in the long run - 长远看'], sentence))
    const items = persist.mock.calls[0][0].items
    expect(items.map((i) => i.lemma).sort()).toEqual(['in the long run', 'run out'])
    const runOut = items.find((i) => i.lemma === 'run out')!
    expect(runOut.meaning).toBe('用完')
    expect(runOut.source).toMatchObject({ sentenceId: 's1', sentenceText: 'The plan will run out of money.' })
    expect(flash).toHaveBeenCalledWith('已加入 2 个词组 / 习语')
  })

  it('重复加入不产生重复词条；第二次提示都已在生词本', () => {
    const { result, persist, flash } = setup()
    act(() => result.current.addPhrases(['run out — 用完'], null))
    act(() => result.current.addPhrases(['run out — 用完'], null))
    // 第二次仍会 persist：markWord 会把来源句/context 合并进已有词条（不是无意义空写）
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1][0].items).toHaveLength(1)
    expect(flash).toHaveBeenLastCalledWith('这些词组 / 习语都已在生词本里（语言点会自动收藏）')
  })
})

describe('useVocabEdits：移出词库', () => {
  it('按 lemma 找到词条并移出（原词形保留在提示里）', () => {
    const initial = { ...createLibrary(), items: [vocabItem({ id: 'x', word: 'running', lemma: 'run' })] }
    const { result, persist, flash } = setup(initial)
    act(() => result.current.removeWord('run'))
    expect(persist.mock.calls[0][0].items).toHaveLength(0)
    expect(flash).toHaveBeenCalledWith('已移出生词本：running')
  })

  it('不在词库时只提示，不写库', () => {
    const { result, persist, flash } = setup()
    act(() => result.current.removeWord('absent'))
    expect(persist).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('不在生词本：absent')
  })
})

describe('useVocabEdits：复习评分 / 手动编辑', () => {
  it('评分只改指定词条，写回一次', () => {
    const initial = { ...createLibrary(), items: [vocabItem({ id: 'x', word: 'run', lemma: 'run' })] }
    const { result, persist } = setup(initial)
    act(() => result.current.reviewWord('x', 'good'))
    const saved = persist.mock.calls[0][0]
    expect(saved.items).toHaveLength(1)
    expect(saved.items[0].id).toBe('x')
    expect(saved.items[0].reviewState.due).not.toBeNull()
  })

  it('编辑按 id 合并补丁，并标记为 edited', () => {
    const initial = { ...createLibrary(), items: [vocabItem({ id: 'x', word: 'run', lemma: 'run' })] }
    const { result, persist } = setup(initial)
    act(() => result.current.editWord('x', { meaning: '跑；经营' }))
    const item = persist.mock.calls[0][0].items[0]
    expect(item.meaning).toBe('跑；经营')
    expect(item.status).toBe('edited')
    expect(item.word).toBe('run')
  })

  it('id 不存在时仍只写一次（内容不变，不抛错）', () => {
    const initial = { ...createLibrary(), items: [vocabItem({ id: 'x', word: 'run', lemma: 'run' })] }
    const { result, persist } = setup(initial)
    act(() => result.current.editWord('nope', { meaning: 'x' }))
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0][0].items[0].meaning).toBeNull()
  })
})
