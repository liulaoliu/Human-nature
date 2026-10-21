// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { useStudySession } from './useStudySession'
import { createLibrary } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'
import type { VocabLibrary } from '../../types/document'

/**
 * 背单词会话的导航接线：Q/E 切上一张/下一张卡，且「背搭配」只组词组/习语。
 * 评分/排队算法本身在 core/vocab（已单测），这里只测 hook 的接线。
 */
let api: ReturnType<typeof useStudySession> | null = null

const flash = vi.fn()
const noop = vi.fn()
const docLemmas = new Set<string>()

function Harness({
  library,
  speak = noop,
}: {
  library: VocabLibrary
  speak?: (text: string) => void
}) {
  api = useStudySession({
    library,
    articleIdentity: 'A',
    docLemmas,
    closeQuiz: noop,
    flash,
    persist: noop,
    markStudied: noop,
    recordActivity: noop,
    addStudyTime: noop,
    speak,
    newLimit: 0,
    newToday: 0,
    onBumpNewToday: noop,
  })
  return null
}

const lib = (items: VocabLibrary['items']): VocabLibrary => ({ ...createLibrary(), items })

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  api = null
  flash.mockClear()
})

afterEach(() => {
  restoreStorage()
  vi.useRealTimers()
})

describe('useStudySession：单词之间切换', () => {
  it('E 下一个、Q 上一个；到边界不越界', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'one', lemma: 'one' }),
          vocabItem({ id: 'w2', word: 'two', lemma: 'two' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.index).toBe(1)

    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.index).toBe(2) // 最后一张再往后 = 本轮完成页

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(1)

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(0) // 第一张不再往前
    unmount()
  })
})

describe('useStudySession：标过「不认识」的复习门禁', () => {
  it('先过选释义；门禁期间 1/空格 不评分，放行后恢复', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({
            id: 'w1',
            word: 'run',
            lemma: 'run',
            meaning: '跑',
            tags: ['不认识'],
            reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0, lapses: 1 },
          }),
          vocabItem({ id: 'w2', word: 'walk', lemma: 'walk', meaning: '走' }),
          vocabItem({ id: 'w3', word: 'say', lemma: 'say', meaning: '说' }),
          vocabItem({ id: 'w4', word: 'see', lemma: 'see', meaning: '看' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.card?.id).toBe('w1')
    expect(api!.meaningGate).toBe(true)

    // 门禁期间快捷键交给 MeaningQuiz，不能直接翻面/评分
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: ' ' })
    expect(api!.revealed).toBe(false)

    act(() => api!.clearMeaningGate())
    expect(api!.meaningGate).toBe(false)
    fireEvent.keyDown(window, { key: ' ' })
    expect(api!.revealed).toBe(true)
    unmount()
  })
})

describe('useStudySession：背单词 / 背搭配分牌组', () => {  it('背单词只组单词，切到背搭配只组词组/习语', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'run', lemma: 'run', kind: 'word' }),
          vocabItem({ id: 'p1', word: 'fall back on', lemma: 'fall back on', kind: 'phrase' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.queue?.map((it) => it.id)).toEqual(['w1'])

    act(() => api!.switchDeck('collocation'))
    expect(api!.deck).toBe('collocation')
    expect(api!.queue?.map((it) => it.id)).toEqual(['p1'])
    unmount()
  })
})

describe('useStudySession：R 朗读当前单词', () => {
  it('R 和卡片右侧按钮走同一个朗读入口', () => {
    const speak = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} speak={speak} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))

    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).toHaveBeenCalledWith('one')
    unmount()
  })

  it('拼写模式判卷前不朗读（防剧透），判卷后可读', () => {
    const speak = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} speak={speak} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setSpelling(true))

    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).not.toHaveBeenCalled()

    act(() => api!.setChecked(true))
    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).toHaveBeenCalledWith('one')
    unmount()
  })
})

describe('useStudySession：加练总上限（每卡每轮最多 3 次）', () => {
  it('一直点「忘记了」最多出现 3 次，到上限给提示但评分照写', () => {
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.queue).toHaveLength(1)

    act(() => api!.grade('again'))
    expect(api!.queue).toHaveLength(2)
    act(() => api!.grade('again'))
    expect(api!.queue).toHaveLength(3)
    act(() => api!.grade('again'))
    expect(api!.queue).toHaveLength(3) // 第 4 次不再追加
    expect(api!.counts.forgot).toBe(3) // 评分没被篡改
    expect(flash).toHaveBeenCalledWith('本轮已练 3 次，按当前评分排期')
    unmount()
  })

  it('「重练忘记的」每轮只发起一次，计数跨重练保留', () => {
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.grade('again')) // 加练一次（本轮第 2 次出场）
    act(() => api!.grade('good')) // 本轮结束
    expect(api!.forgotCount).toBe(1)
    expect(api!.canRetryForgot).toBe(true)

    act(() => api!.retryForgot()) // 第 3 次出场
    expect(api!.queue).toHaveLength(1)
    expect(api!.canRetryForgot).toBe(false)

    act(() => api!.grade('again')) // 已到 3 次，不再追加
    expect(api!.queue).toHaveLength(1)
    expect(flash).toHaveBeenCalledWith('本轮已练 3 次，按当前评分排期')

    act(() => api!.retryForgot()) // 第二次发起被拒
    expect(api!.queue).toHaveLength(1)
    expect(flash).toHaveBeenCalledWith('本轮已经重练过忘记的词了')
    unmount()
  })

  it('过了释义门禁的卡，模糊/忘只写 SRS、不再追加', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({
            id: 'w1',
            word: 'run',
            lemma: 'run',
            meaning: '跑',
            tags: ['不认识'],
            reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0, lapses: 1 },
          }),
          vocabItem({ id: 'w2', word: 'walk', lemma: 'walk', meaning: '走' }),
          vocabItem({ id: 'w3', word: 'say', lemma: 'say', meaning: '说' }),
          vocabItem({ id: 'w4', word: 'see', lemma: 'see', meaning: '看' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.meaningGate).toBe(true)
    act(() => api!.clearMeaningGate())
    act(() => api!.grade('again'))
    expect(api!.queue?.filter((it) => it.id === 'w1')).toHaveLength(1)
    expect(flash).toHaveBeenCalledWith('已过释义关，这张卡按当前评分排期')
    unmount()
  })
})

describe('useStudySession：卡内编辑暂停计时', () => {
  it('编辑 10 秒两只表都不动，关闭编辑后继续', () => {
    vi.useFakeTimers()
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(api!.cardSeconds).toBe(3)

    act(() => api!.openEdit())
    expect(api!.editOpen).toBe(true)
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(api!.cardSeconds).toBe(3)
    expect(api!.liveSeconds).toBe(3)

    act(() => api!.setEditOpen(false))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(api!.cardSeconds).toBe(5)
    expect(api!.liveSeconds).toBe(5)
    unmount()
  })
})
