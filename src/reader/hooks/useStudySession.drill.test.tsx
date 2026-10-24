// @vitest-environment jsdom
import { useState } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import { Harness, api, lib, useFakeStorage } from './studySessionHarness'

const storage = useFakeStorage()
beforeEach(storage.setup)
afterEach(storage.teardown)

/**
 * 让落库回灌到 `library`：判完 again 的词要真的变成「重学中」，
 * 否则 `relearning` 永远是 false，这条路径测不到（夹具默认是静态 library）。
 */
function Live({ initial }: { initial: VocabLibrary }) {
  const [library, setLibrary] = useState(initial)
  return <Harness library={library} onPersist={setLibrary} />
}

/**
 * 「强制锤炼」是**评分门禁**：卡停太久 / 重学卡摊开释义，要先做一道题才能评分。
 * 一旦这一卡已经判完、停在卡上等「下一词」，门禁就该让位——
 * 否则用户点「继续（看单词卡）」会连卡都看不到就被锤炼接管（2026-10-22 修的坑）。
 */

describe('useStudySession：判完停卡时锤炼不抢', () => {
  /** 4 个不同释义：够出「正确 + 3 干扰项」，才会走学习模式的四选项。 */
  const freshLib = () =>
    lib([
      vocabItem({ id: 'n1', word: 'run', lemma: 'run', meaning: '跑' }),
      vocabItem({ id: 'n2', word: 'walk', lemma: 'walk', meaning: '走' }),
      vocabItem({ id: 'n3', word: 'say', lemma: 'say', meaning: '说' }),
      vocabItem({ id: 'n4', word: 'see', lemma: 'see', meaning: '看' }),
    ])

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

  it('学习模式选错释义，点「继续」先进单词卡，不当场锤炼', () => {
    const { unmount } = render(<Live initial={freshLib()} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))

    act(() => api!.answerLearn(1, false)) // 选错 → 判 again
    expect(api!.learnGraded).toBe(true)
    expect(api!.drillOn).toBe(false) // 还停在高亮页

    act(() => api!.continueLearn())
    expect(api!.revealed).toBe(true) // 见到单词卡
    expect(api!.relearning).toBe(true) // 这个词确实已进「重学中」
    expect(api!.drillOn).toBe(false) // ← 回归点：重学身份不能把这一张的单词卡顶掉
    unmount()
  })

  it('复习模式判「忘记了」后停卡看答案，不当场锤炼', () => {
    const { unmount } = render(<Live initial={dueLib()} />)
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    act(() => api!.answerReview('again'))
    expect(api!.reviewGraded).toBe(true)
    expect(api!.revealed).toBe(true)
    expect(api!.relearning).toBe(true)
    expect(api!.drillOn).toBe(false) // ← 回归点
    unmount()
  })

  it('下一张重学卡到了才锤炼：摊开释义就进', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({
            id: 'x1',
            word: 'run',
            lemma: 'run',
            meaning: '跑',
            reviewState: { ease: 2.3, due: '2026-10-02T00:00:00.000Z', interval: 1, repetitions: 0, relearn: 1 },
          }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'review', scope: 'all' }))

    expect(api!.relearning).toBe(true)
    expect(api!.drillOn).toBe(false) // 还没摊释义
    act(() => api!.setRevealed(true))
    expect(api!.drillOn).toBe(true) // 重学卡摊开 → 先做题才能评分
    unmount()
  })

  it('锤炼做完（clearDrill）就退出去：重学卡摊着也不再原地重开', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({
            id: 'x1',
            word: 'run',
            lemma: 'run',
            meaning: '跑',
            reviewState: { ease: 2.3, due: '2026-10-02T00:00:00.000Z', interval: 1, repetitions: 0, relearn: 1 },
          }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'review', scope: 'all' }))
    act(() => api!.setRevealed(true))
    expect(api!.drillOn).toBe(true)

    act(() => api!.clearDrill())
    // ← 回归点：摊开释义的标记还在（`revealed` 仍为 true），但不能因此把面板又拉回来
    expect(api!.revealed).toBe(true)
    expect(api!.drillOn).toBe(false)
    unmount()
  })
})

describe('useStudySession：超时秒数不泄漏到下一张新卡', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * 回归：上一张卡停留超过阈值（cardSeconds 攒到超时），切到下一张新卡时，
   * `cardSeconds` 必须**同步归零**——不能把上一张的秒数带过来，否则新词
   * 还没来得及看一眼就被误判超时、强制锤炼（用户报的「新词刚进来就锤炼」）。
   */
  it('复习模式上一张卡超时后，切到新卡不锤炼、秒数归零', () => {
    const { unmount } = render(
      <Harness
        library={lib([
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
        ])}
      />,
    )
    act(() => api!.start({ mode: 'review', scope: 'all' }))
    act(() => api!.setDrillAfter(2))

    // 第一张卡停 3 秒：超过阈值，进入强制锤炼
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(api!.card?.id).toBe('r1')
    expect(api!.drillOn).toBe(true)

    // 完成锤炼解锁评分，再评「认识」推进到下一张新卡
    act(() => api!.clearDrill())
    act(() => api!.answerReview('good'))
    expect(api!.card?.id).toBe('r2')
    // ← 回归点：新卡刚进来，秒数必须已归零，不能被上一张的 3 秒误判超时
    expect(api!.cardSeconds).toBe(0)
    expect(api!.drillOn).toBe(false)
    unmount()
  })
})
