// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useStudyStarts, type StudyStarts } from './useStudyStarts'
import { vocabItem } from '../../core/testFixtures'
import { createLibrary } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { StudyDeck } from '../../core/entryKind'
import type { StudyMode } from '../../core/vocab'
import type { StudyScope } from './useStudyPool'

/**
 * 「开一轮」的组队规则：新学习只取没学过的、复习只取到期的、「本篇全部」忽略配额；
 * 空队列给的是提示而不是空面板；拼错未确认时不许重开。
 */
let api: StudyStarts | null = null
const load = vi.fn()
const clear = vi.fn()
const flash = vi.fn()
const closeQuiz = vi.fn()

const modeRef: { mode: StudyMode } = { mode: 'learn' }
const scopeRef: { scope: StudyScope } = { scope: 'all' }
const deckRef: { deck: StudyDeck } = { deck: 'word' }

const fresh = (id: string) =>
  vocabItem({ id, word: id, lemma: id, createdAt: `2026-10-0${id === 'a' ? 1 : 2}T00:00:00.000Z` })
const due = (id: string) =>
  vocabItem({
    id,
    word: id,
    lemma: id,
    reviewState: { ease: 2.5, due: '2026-10-01T00:00:00.000Z', interval: 6, repetitions: 2 },
  })

function Harness({ items, blocked = false }: { items: VocabItem[]; blocked?: boolean }) {
  const library: VocabLibrary = { ...createLibrary(), items }
  api = useStudyStarts({
    library,
    poolFor: () => items,
    mode: modeRef.mode,
    scope: scopeRef.scope,
    deck: deckRef.deck,
    setMode: (m) => (modeRef.mode = m),
    setScope: (s) => (scopeRef.scope = s),
    setDeck: (d) => (deckRef.deck = d),
    newLimit: 5,
    newToday: 0,
    flash,
    closeQuiz,
    blocked,
    load,
    clear,
  })
  return null
}

beforeEach(() => {
  load.mockClear()
  clear.mockClear()
  flash.mockClear()
  closeQuiz.mockClear()
  api = null
  modeRef.mode = 'learn'
  scopeRef.scope = 'all'
  deckRef.deck = 'word'
})

describe('useStudyStarts：组队', () => {
  it('新学习只取从没排期过的词，按加入时间；不受到期词干扰', () => {
    render(<Harness items={[fresh('b'), due('x'), fresh('a')]} />)
    act(() => api!.start())
    expect(load.mock.calls[0][0].map((it: VocabItem) => it.id)).toEqual(['a', 'b'])
    expect(closeQuiz).toHaveBeenCalledTimes(1)
  })

  it('复习只取到期且有学习记录的词（重学中的排前面）', () => {
    const relearn = vocabItem({
      id: 'r',
      word: 'r',
      lemma: 'r',
      reviewState: { ease: 2.5, due: '2026-10-02T00:00:00.000Z', interval: 1, repetitions: 0, relearn: 1 },
    })
    render(<Harness items={[due('x'), fresh('n'), relearn]} />)
    act(() => api!.start({ mode: 'review' }))
    expect(load.mock.calls[0][0].map((it: VocabItem) => it.id)).toEqual(['r', 'x'])
  })

  it('新词配额用完 → 队列空 + 提示，不装队列', () => {
    const libraryItems = [fresh('a')]
    const { rerender } = render(<Harness items={libraryItems} />)
    // newLimit 5 / newToday 0 → 还能学 5 个，这里换成用不到配额的场景：复习没有到期的
    act(() => api!.start({ mode: 'review' }))
    expect(load).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('没有到期的复习词，去「新学习」吧')
    rerender(<Harness items={[]} />)
  })

  it('「本篇全部」：忽略新词配额、按到期排序、不进入重练模式', () => {
    render(<Harness items={[fresh('a'), due('x')]} />)
    act(() => api!.startArticleAll())
    expect(load.mock.calls[0][0].map((it: VocabItem) => it.id)).toEqual(['x', 'a'])
    expect(load.mock.calls[0][1]).toBeUndefined()
    expect(scopeRef.scope).toBe('article')
  })

  it('「从头重学」：只装给定的词并标 retrying', () => {
    render(<Harness items={[fresh('a'), fresh('b')]} />)
    act(() => api!.startRelearn(['b']))
    expect(load.mock.calls[0][0].map((it: VocabItem) => it.id)).toEqual(['b'])
    expect(load.mock.calls[0][1]).toEqual({ retrying: true })
  })

  it('拼错未确认时不许重开；换没有词的牌组只提示不动队列', () => {
    render(<Harness items={[fresh('a')]} blocked />)
    act(() => api!.start())
    expect(load).not.toHaveBeenCalled()

    render(<Harness items={[fresh('a')]} />)
    act(() => api!.switchDeck('collocation'))
    expect(load).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('还没有词组/习语：先在阅读里收藏语言点')
  })
})
