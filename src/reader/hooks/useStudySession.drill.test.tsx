// @vitest-environment jsdom
import { useState } from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
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
