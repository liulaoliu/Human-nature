// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import { Harness, api, lib, useFakeStorage, flash } from './studySessionHarness'

const storage = useFakeStorage()
beforeEach(storage.setup)
afterEach(storage.teardown)

/**
 * 评分这条路：忘记不封顶重排、拼错即判不认识、刚过释义关点忘记先确认、标过不认识的复习门禁。
 */

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

describe('useStudySession：忘记一直重排，直到认识 / 模糊', () => {
  it('连续点「忘记了」不封顶，看看能一直出场', () => {
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} />)
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
          vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' }),
          vocabItem({ id: 'w2', word: 'two', lemma: 'two', meaning: '二' }),
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
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} />)
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

  it('过了释义关后点「忘记」：直接落库并重排，不再二次确认', () => {
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
    // 选「忘记了」= 确实忘了，直接 again 落库 + 重排到队尾，不弹二次确认
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
    expect(api!.queue?.filter((it) => it.id === 'w1')).toHaveLength(1)
    expect(api!.index).toBe(1)
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

describe('useStudySession：刚过释义关点「忘记了」直接落库', () => {
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

  it('选了「忘记了」就是确实忘了：直接按 again 落库并进入重学', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={gatedLibrary()} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.clearMeaningGate())
    act(() => api!.grade('again'))

    expect(api!.index).toBe(1)
    expect(api!.counts.forgot).toBe(1)
    expect(onPersist).toHaveBeenCalled()

    const saved = onPersist.mock.calls.at(-1)![0] as VocabLibrary
    const w1 = saved.items.find((it) => it.id === 'w1')!
    expect(w1.reviewState.relearn).toBe(1)
    expect(w1.reviewState.repetitions).toBe(0)
    expect(w1.reviewState.lapses).toBe(2)
    expect(w1.tags).toContain('不认识')
    unmount()
  })

  it('没过释义关的普通卡点「忘记了」同样直接落库', () => {
    const onPersist = vi.fn()
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑' })])} onPersist={onPersist} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setRevealed(true))
    act(() => api!.grade('again'))

    expect(api!.index).toBe(1)
    expect(onPersist).toHaveBeenCalled()
    unmount()
  })
})
