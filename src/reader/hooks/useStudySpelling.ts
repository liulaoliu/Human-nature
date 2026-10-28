import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { displayMeaning } from '../../core/vocab'
import type { VocabItem } from '../../types/document'
import type { useStudyGrading } from './useStudyGrading'
import { useStudySpellGate } from './useStudySpellGate'

/**
 * 正面拼写的接线：判卷、拼错确认、锤炼板拼错共用同一条落库路径。
 *
 * 状态机在 `useStudySpellGate`，账本在 `useStudyGrading`；这里只把两者接起来，
 * 免得主会话在「检查 / 确认 / 锤炼」三个入口各写一遍提示与推进。
 */

type SpellingGrading = Pick<ReturnType<typeof useStudyGrading>, 'recordSpellingMiss' | 'showGradeInfo'>

export interface UseStudySpellingParams {
  active: boolean
  card: VocabItem | null
  queue: VocabItem[] | null
  grading: SpellingGrading
  flash: (message: string) => void
  input: string
  checked: boolean
  setChecked: Dispatch<SetStateAction<boolean>>
  setRevealed: Dispatch<SetStateAction<boolean>>
  resetCardUi: () => void
  setIndex: Dispatch<SetStateAction<number>>
}

export function useStudySpelling({
  active,
  card,
  queue,
  grading,
  flash,
  input,
  checked,
  setChecked,
  setRevealed,
  resetCardUi,
  setIndex,
}: UseStudySpellingParams) {
  /**
   * 拼写判定：不做「再试一次」——允许反复输入等于把判断变成抄写。
   * 判错立刻按「忘记」写 SRS（relearn +1）并打「不认识」标签，本轮重排到队尾。
   */
  const spellGate = useStudySpellGate({
    active,
    card,
    judge: (typed: string) => {
      const cur = card
      if (!cur || !queue) return { requeued: false, word: typed, meaning: null }
      const requeued = grading.recordSpellingMiss(cur)
      grading.showGradeInfo('拼写错误 · 判为不认识 · 已从零重学', 2000)
      flash('拼写错误，已判为「不认识」：这个词会从零重学')
      setChecked(true)
      setRevealed(false)
      return { requeued, word: cur.word, meaning: displayMeaning(cur) || null }
    },
  })
  const { spellMiss } = spellGate

  /** 确认拼写判错，进入下一张卡（这个词已重排在队尾）。 */
  const ackSpellMiss = useCallback(() => {
    if (!spellMiss) return
    spellGate.ack()
    resetCardUi()
    setIndex((i) => i + 1)
  }, [spellMiss, spellGate, resetCardUi, setIndex])

  /** 拼写模式的「检查」：对 → 解锁评分；错 → 立即判不认识（不提供第二次输入）。 */
  const checkSpelling = useCallback(() => {
    if (!queue || !card || checked) return
    setChecked(true)
    spellGate.check(input)
  }, [queue, card, checked, input, spellGate, setChecked])

  /** 锤炼板拼写步的拼错回调：与正面拼写同一条判定与落库路径。 */
  const applySpellingMiss = useCallback((typed: string) => spellGate.check(typed), [spellGate])

  return {
    spellMiss,
    resetSpellGate: spellGate.reset,
    ackSpellMiss,
    checkSpelling,
    applySpellingMiss,
  }
}
