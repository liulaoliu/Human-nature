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
  it('E 下一个、Q 上一个；组末先拼写（学多少拼多少），拼完才进完成页', () => {
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

    // 最后一组的组末：E 不再直接翻页，而是停下做组末拼写（默认每组 = 范围全部）
    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.roundTest).toEqual({ index: 0, total: 2 })
    expect(api!.index).toBe(1)

    act(() => api!.onRoundInputChange('one'))
    act(() => api!.onRoundCheck())
    act(() => api!.onRoundInputChange('two'))
    act(() => api!.onRoundCheck())
    expect(api!.roundTest).toBeNull()
    expect(api!.index).toBe(2) // 拼完 = 本轮完成页

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
  /**
   * 用「学过但排期后又忘了」的词（有 due、repetitions 仍是 0）而不是新词：
   * 新词在学习模式里走「4 条释义」那条路（见下一个 describe），
   * 只有有学习记录的词才走复习门禁。
   */
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
            reviewState: {
              ease: 2.5,
              due: '2020-01-01T00:00:00.000Z',
              interval: 0,
              repetitions: 0,
              lapses: 1,
            },
          }),
          vocabItem({ id: 'w2', word: 'walk', lemma: 'walk', meaning: '走' }),
          vocabItem({ id: 'w3', word: 'say', lemma: 'say', meaning: '说' }),
          vocabItem({ id: 'w4', word: 'see', lemma: 'see', meaning: '看' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'review', scope: 'all' }))
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

describe('useStudySession：学习模式的「4 条释义」', () => {
  /** 4 个不同释义：够出「正确 + 3 干扰项」。 */
  const freshLib = () =>
    lib([
      vocabItem({ id: 'n1', word: 'run', lemma: 'run', meaning: '跑' }),
      vocabItem({ id: 'n2', word: 'walk', lemma: 'walk', meaning: '走' }),
      vocabItem({ id: 'n3', word: 'say', lemma: 'say', meaning: '说' }),
      vocabItem({ id: 'n4', word: 'see', lemma: 'see', meaning: '看' }),
    ])

  it('新词先出 4 条释义；看答案判不认识，停在单词卡等「下一词」（不自动跳）', () => {
    const seen: VocabLibrary[] = []
    const { unmount } = render(<Harness library={freshLib()} onPersist={(l) => seen.push(l)} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.learnPhase).toBe(true)

    act(() => api!.revealLearnAnswer())
    // 判完不跳下一张：Spec 要求停住等用户点「下一词」
    expect(api!.index).toBe(0)
    expect(api!.learnGraded).toBe(true)
    const saved = seen.at(-1)!.items.find((it) => it.id === 'n1')!
    expect(saved.reviewState.relearn).toBe(1) // again → 进入重学
    expect(saved.reviewState.meaningPasses).toBeUndefined() // 判不认识 → 选对次数归零（0 不写字段）

    act(() => api!.continueLearn())
    expect(api!.revealed).toBe(true) // 打断停留 → 进单词卡
    unmount()
  })

  it('选对：首次判模糊并记一次「没看答案就选对」，直接进单词卡', () => {
    const seen: VocabLibrary[] = []
    const { unmount } = render(<Harness library={freshLib()} onPersist={(l) => seen.push(l)} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.answerLearn(2, true))
    const saved = seen.at(-1)!.items.find((it) => it.id === 'n1')!
    expect(saved.reviewState.repetitions).toBe(1) // hard：不算「真认识」
    expect(saved.reviewState.meaningPasses).toBe(1)
    expect(api!.revealed).toBe(true)
    expect(api!.index).toBe(0) // 仍要等「下一词」
    unmount()
  })

  it('选错：判不认识，停在释义页等「继续」（不自动进单词卡）', () => {
    const { unmount } = render(<Harness library={freshLib()} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.answerLearn(1, false))
    expect(api!.learnReveal?.wrong).toBe(1)
    expect(api!.learnReveal?.auto).toBe(false)
    expect(api!.revealed).toBe(false)
    act(() => api!.continueLearn())
    expect(api!.revealed).toBe(true)
    unmount()
  })

  it('判完之后空格 = 下一词，不再二次评分', () => {
    const { unmount } = render(<Harness library={freshLib()} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.answerLearn(0, true))
    fireEvent.keyDown(window, { key: ' ' })
    expect(api!.index).toBe(1)
    unmount()
  })

  it('词库不足 4 个不同释义：不出 4 选项，退回普通卡流程', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'a', word: 'aa', lemma: 'aa', meaning: '甲' }),
          vocabItem({ id: 'b', word: 'bb', lemma: 'bb', meaning: '乙' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.learnPhase).toBe(false)
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

describe('useStudySession：复习模式三键', () => {
  /** 到期的复习词（有学习记录 + due 过期）。 */
  const dueLib = () =>
    lib([
      vocabItem({
        id: 'r1',
        word: 'run',
        lemma: 'run',
        meaning: '跑',
        reviewState: { ease: 2.5, due: '2020-01-01T00:00:00.000Z', interval: 6, repetitions: 2 },
      }),
      vocabItem({
        id: 'r2',
        word: 'walk',
        lemma: 'walk',
        meaning: '走',
        reviewState: { ease: 2.5, due: '2020-01-02T00:00:00.000Z', interval: 6, repetitions: 2 },
      }),
    ])

  it('认识：不翻面直接判 good 并换下一张', () => {
    const seen: VocabLibrary[] = []
    const { unmount } = render(<Harness library={dueLib()} onPersist={(l) => seen.push(l)} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))
    expect(api!.reviewKeys).toBe(true)
    expect(api!.revealed).toBe(false)

    fireEvent.keyDown(window, { key: '1' })
    expect(seen.at(-1)!.items.find((it) => it.id === 'r1')!.reviewState.repetitions).toBe(3)
    expect(api!.index).toBe(1)
    expect(api!.reviewKeys).toBe(true) // 新卡重新可判
    unmount()
  })

  it('模糊：先不写库、摊开卡；点「下一词」才按 hard 落库并推进', () => {
    const seen: VocabLibrary[] = []
    const { unmount } = render(<Harness library={dueLib()} onPersist={(l) => seen.push(l)} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    act(() => api!.answerReview('hard'))
    expect(seen).toHaveLength(0) // 模糊不落库
    expect(api!.reviewFuzzy).toBe(true)
    expect(api!.revealed).toBe(true)
    expect(api!.index).toBe(0)

    act(() => api!.chooseReview('next'))
    expect(seen.at(-1)!.items.find((it) => it.id === 'r1')!.reviewState.repetitions).toBe(3)
    expect(api!.reviewFuzzy).toBe(false)
    expect(api!.index).toBe(1)
    unmount()
  })

  it('模糊后「记错了」：改成不认识（again + 重学），停在卡上看答案', () => {
    const seen: VocabLibrary[] = []
    const { unmount } = render(<Harness library={dueLib()} onPersist={(l) => seen.push(l)} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    act(() => api!.answerReview('hard'))
    act(() => api!.chooseReview('missed'))
    const saved = seen.at(-1)!.items.find((it) => it.id === 'r1')!
    expect(saved.reviewState.relearn).toBe(1)
    expect(saved.reviewState.repetitions).toBe(0)
    expect(api!.reviewGraded).toBe(true)
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: ' ' }) // 空格 = 下一词
    expect(api!.index).toBe(1)
    unmount()
  })

  it('忘记了：立刻判不认识并停卡，1/2/3 不再二次评分', () => {
    const seen: VocabLibrary[] = []
    const { unmount } = render(<Harness library={dueLib()} onPersist={(l) => seen.push(l)} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    act(() => api!.answerReview('again'))
    expect(seen).toHaveLength(1)
    expect(api!.reviewGraded).toBe(true)
    fireEvent.keyDown(window, { key: '1' })
    expect(seen).toHaveLength(1) // 没再写库
    expect(api!.index).toBe(0)
    unmount()
  })

  it('复习模式也有组末拼写：本组最后一张评完先拼写，拼完才进完成页', () => {
    const { unmount } = render(<Harness library={dueLib()} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    act(() => api!.answerReview('good'))
    expect(api!.index).toBe(1)
    act(() => api!.answerReview('good'))
    // 组末：停下拼写本组两个词，index 还没推到完成页
    expect(api!.roundTest).toEqual({ index: 0, total: 2 })
    expect(api!.index).toBe(1)

    act(() => api!.onRoundInputChange('run'))
    act(() => api!.onRoundCheck())
    act(() => api!.onRoundInputChange('walk'))
    act(() => api!.onRoundCheck())
    expect(api!.roundTest).toBeNull()
    expect(api!.index).toBe(2)
    unmount()
  })
})

describe('useStudySession：快捷键覆盖面板上的每个按钮', () => {
  const reviewed = (id: string, word: string) =>
    vocabItem({
      id,
      word,
      lemma: word,
      meaning: '释义' + id,
      reviewState: { ease: 2.5, due: '2020-01-01T00:00:00.000Z', interval: 6, repetitions: 2 },
    })

  it('H = 看答案（学习模式的四选项），与 A/D 切换选项不冲突', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'n1', word: 'run', lemma: 'run', meaning: '跑' }),
          vocabItem({ id: 'n2', word: 'walk', lemma: 'walk', meaning: '走' }),
          vocabItem({ id: 'n3', word: 'say', lemma: 'say', meaning: '说' }),
          vocabItem({ id: 'n4', word: 'see', lemma: 'see', meaning: '看' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.learnPhase).toBe(true)

    fireEvent.keyDown(window, { key: 'a' }) // A 是选项左移，不能顺手判「不认识」
    expect(api!.learnGraded).toBe(false)

    fireEvent.keyDown(window, { key: 'h' })
    expect(api!.learnGraded).toBe(true)
    unmount()
  })

  it('U = 不认识：卡片摊开时按 U 等于点「不认识」（写 again + 打标签）', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={lib([reviewed('w1', 'run')])} onPersist={onPersist} />)
    // 直接把有学习记录的词装进队列（学习模式下不进四选项）
    act(() => api!.startRelearn(['w1']))
    act(() => api!.setRevealed(true))

    fireEvent.keyDown(window, { key: 'u' })
    const saved = onPersist.mock.calls.at(-1)![0] as VocabLibrary
    expect(saved.items[0].tags).toContain('不认识')
    expect(saved.items[0].reviewState.relearn).toBe(1)
    unmount()
  })

  it('复习模式：空格 = 看一眼释义（可收起），不会误判成「认识」', () => {
    const { unmount } = render(<Harness library={lib([reviewed('w1', 'run'), reviewed('w2', 'walk')])} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    fireEvent.keyDown(window, { key: ' ' })
    expect(api!.revealed).toBe(true)
    expect(api!.index).toBe(0)
    fireEvent.keyDown(window, { key: ' ' })
    expect(api!.revealed).toBe(false)
    unmount()
  })

  it('M = 记错了：模糊摊卡后按 M 改成「不认识」', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={lib([reviewed('w1', 'run'), reviewed('w2', 'walk')])} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    fireEvent.keyDown(window, { key: '2' }) // 模糊：不落库、摊卡
    expect(api!.reviewFuzzy).toBe(true)
    expect(onPersist).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'm' })
    const saved = onPersist.mock.calls.at(-1)![0] as VocabLibrary
    expect(saved.items.find((it) => it.id === 'w1')!.reviewState.relearn).toBe(1)
    expect(api!.reviewGraded).toBe(true)
    unmount()
  })
})
