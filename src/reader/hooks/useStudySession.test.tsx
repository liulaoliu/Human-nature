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
  onPersist = noop,
}: {
  library: VocabLibrary
  speak?: (text: string) => void
  onPersist?: (lib: VocabLibrary) => void
}) {
  api = useStudySession({
    library,
    articleIdentity: 'A',
    docLemmas,
    closeQuiz: noop,
    flash,
    persist: onPersist,
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

describe('useStudySession：忘记一直重排，直到认识 / 模糊', () => {
  it('连续点「忘记了」不封顶，看看能一直出场', () => {
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.queue).toHaveLength(1)

    for (let n = 2; n <= 6; n++) {
      act(() => api!.grade('again'))
      expect(api!.queue).toHaveLength(n)
    }
    expect(api!.card?.id).toBe('w1')
    expect(api!.counts.forgot).toBe(5)

    // 认识是收尾：不再追加，本轮结束
    act(() => api!.grade('good'))
    expect(api!.queue).toHaveLength(6)
    expect(api!.index).toBe(6)
    expect(api!.counts.know).toBe(1)
    unmount()
  })

  it('「模糊」就是收尾条件：不再追加到队尾', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'one', lemma: 'one' }),
          vocabItem({ id: 'w2', word: 'two', lemma: 'two' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.grade('hard'))
    expect(api!.queue).toHaveLength(2)
    expect(api!.index).toBe(1)
    expect(api!.counts.fuzzy).toBe(1)
    unmount()
  })

  it('「重练忘记的」每轮只发起一次，重练里评忘记仍会继续重排', () => {
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.grade('again')) // 本轮第 2 次出场
    act(() => api!.grade('good')) // 本轮结束
    expect(api!.forgotCount).toBe(1)
    expect(api!.canRetryForgot).toBe(true)

    act(() => api!.retryForgot())
    expect(api!.queue).toHaveLength(1)
    expect(api!.canRetryForgot).toBe(false)

    act(() => api!.grade('again')) // 重练里忘记：仍然追加
    expect(api!.queue).toHaveLength(2)

    act(() => api!.retryForgot()) // 第二次发起被拒
    expect(api!.queue).toHaveLength(2)
    expect(flash).toHaveBeenCalledWith('本轮已经重练过忘记的词了')
    unmount()
  })

  it('过了释义关后：模糊收尾，忘记（确认后）仍会重排', () => {
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
    expect(api!.pendingForgot).toBe(true)
    act(() => api!.confirmForgot())
    expect(api!.queue?.filter((it) => it.id === 'w1')).toHaveLength(2)
    expect(api!.index).toBe(1)
    unmount()
  })

  it('过了释义关点「模糊」：直接收尾，不再追加', () => {
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
    act(() => api!.clearMeaningGate())
    act(() => api!.grade('hard'))
    expect(api!.pendingForgot).toBe(false)
    expect(api!.queue?.filter((it) => it.id === 'w1')).toHaveLength(1)
    expect(api!.index).toBe(1)
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

describe('useStudySession：拼错即判「不认识」并从头重学', () => {
  it('拼错写 SRS again + 标签、重排到队尾；确认前锁住退出与切卡', () => {
    const onPersist = vi.fn()
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({
            id: 'w1',
            word: 'run',
            lemma: 'run',
            meaning: '跑',
            reviewState: { ease: 2.5, due: '2026-10-02T00:00:00.000Z', interval: 15, repetitions: 3 },
          }),
          vocabItem({ id: 'w2', word: 'walk', lemma: 'walk', meaning: '走' }),
        ])}
        onPersist={onPersist}
      />,
    )
    act(() => api!.start({ mode: 'review', scope: 'all' }))
    expect(api!.card?.id).toBe('w1')

    act(() => api!.setInput('ran'))
    act(() => api!.checkSpelling())
    expect(api!.spellMiss).toEqual({ input: 'ran', word: 'run', meaning: '跑', requeued: true })
    expect(api!.navLocked).toBe(true)
    expect(api!.queue).toHaveLength(2) // 重排回队尾

    const saved = onPersist.mock.calls.at(-1)![0] as VocabLibrary
    const w1 = saved.items.find((it) => it.id === 'w1')!
    expect(w1.tags).toContain('不认识')
    expect(w1.reviewState.relearn).toBe(1)
    expect(w1.reviewState.repetitions).toBe(0)

    // 不能靠退出 / 切卡吞掉判罚
    act(() => api!.close())
    expect(api!.queue).not.toBeNull()
    act(() => api!.forward())
    expect(api!.index).toBe(0)

    act(() => api!.ackSpellMiss())
    expect(api!.spellMiss).toBeNull()
    expect(api!.index).toBe(1)
    expect(api!.navLocked).toBe(false)
    unmount()
  })

  it('拼对不判错：只解锁评分，不写「不认识」', () => {
    const onPersist = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑' })])} onPersist={onPersist} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setInput('Run'))
    act(() => api!.checkSpelling())

    expect(api!.spellMiss).toBeNull()
    expect(api!.checked).toBe(true)
    expect(onPersist).not.toHaveBeenCalled()
    unmount()
  })

  it('重学卡：不直接考拼写；揭示后强制锤炼', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({
            id: 'w1',
            word: 'run',
            lemma: 'run',
            meaning: '跑',
            reviewState: { ease: 2.3, due: '2026-10-02T00:00:00.000Z', interval: 1, repetitions: 0, relearn: 1 },
          }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'review', scope: 'all' }))
    expect(api!.card?.id).toBe('w1')
    expect(api!.relearning).toBe(true)
    expect(api!.drillOn).toBe(false)

    act(() => api!.setRevealed(true))
    expect(api!.drillOn).toBe(true)
    unmount()
  })
})

describe('useStudySession：刚过释义关点「忘记了」先确认', () => {
  const gatedLibrary = () =>
    lib([
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
    ])

  it('确认前什么都不写，快捷键也停用；确认后按 again 落库并进入重学', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={gatedLibrary()} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.clearMeaningGate())
    act(() => api!.grade('again'))

    expect(api!.pendingForgot).toBe(true)
    expect(api!.index).toBe(0)
    expect(api!.counts.forgot).toBe(0)
    expect(onPersist).not.toHaveBeenCalled()

    // 确认期间按评分快捷键不应绕过判断
    fireEvent.keyDown(window, { key: '1' })
    expect(api!.pendingForgot).toBe(true)
    expect(api!.index).toBe(0)
    expect(onPersist).not.toHaveBeenCalled()

    act(() => api!.confirmForgot())
    expect(api!.pendingForgot).toBe(false)
    expect(api!.index).toBe(1)
    expect(api!.counts.forgot).toBe(1)

    const saved = onPersist.mock.calls.at(-1)![0] as VocabLibrary
    const w1 = saved.items.find((it) => it.id === 'w1')!
    expect(w1.reviewState.relearn).toBe(1)
    expect(w1.reviewState.repetitions).toBe(0)
    expect(w1.reviewState.lapses).toBe(2)
    expect(w1.tags).toContain('不认识')
    unmount()
  })

  it('改按「模糊」：进度不清零、不进入重学', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={gatedLibrary()} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.clearMeaningGate())
    act(() => api!.grade('again'))
    act(() => api!.softenForgot())

    expect(api!.pendingForgot).toBe(false)
    expect(api!.counts.fuzzy).toBe(1)
    expect(api!.counts.forgot).toBe(0)
    const saved = onPersist.mock.calls.at(-1)![0] as VocabLibrary
    const w1 = saved.items.find((it) => it.id === 'w1')!
    expect(w1.reviewState.repetitions).toBe(1)
    expect(w1.reviewState.interval).toBe(1)
    expect(w1.reviewState.relearn).toBeUndefined()
    unmount()
  })

  it('返回重评：撤销确认，之后正常评分照旧', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={gatedLibrary()} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.clearMeaningGate())
    act(() => api!.grade('again'))
    act(() => api!.cancelForgot())

    expect(api!.pendingForgot).toBe(false)
    expect(api!.index).toBe(0)
    expect(onPersist).not.toHaveBeenCalled()

    act(() => api!.grade('good'))
    expect(api!.index).toBe(1)
    expect(api!.counts.know).toBe(1)
    unmount()
  })

  it('没过释义关的普通卡点「忘记了」不拦', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑' })])} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setRevealed(true))
    act(() => api!.grade('again'))

    expect(api!.pendingForgot).toBe(false)
    expect(api!.index).toBe(1)
    expect(onPersist).toHaveBeenCalled()
    unmount()
  })
})
