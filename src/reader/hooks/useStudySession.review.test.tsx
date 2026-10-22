// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import { Harness, api, lib, useFakeStorage } from './studySessionHarness'

const storage = useFakeStorage()
beforeEach(storage.setup)
afterEach(storage.teardown)

/**
 * 学习模式的四选项、复习模式的三键、以及覆盖所有按钮的快捷键。
 */

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
