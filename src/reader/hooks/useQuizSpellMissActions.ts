/**
 * 拼写判错的两个出口：确认后继续、以及「从头重学」的挂起 / 恢复。
 *
 * 抽出来是因为这三条规则互相牵连，散在主 hook 里时还夹着一层「关卷前先看拼写」的包装：
 *  - 拼写判错未确认时 `close` 必须拦下，否则这次判罚被吞掉（由调用方传 `paused`）；
 *  - 点了「从头重学」：先把这一题判完（指针推到下一题）再挂起，队列 / 进度都留着；
 *  - 重学结束点「结束」原地接着考，计时 / 快捷键 / 结算一起恢复。
 *
 * 挂起状态本身在 `useQuizRunState`（跟着会话快照走），这里只给动作。
 */
import { useCallback } from 'react'
import type { QuizSpellMiss } from '../quiz/createQuizCheck'

export interface UseQuizSpellMissActionsParams {
  spellMiss: QuizSpellMiss | null
  setSpellMiss: (value: QuizSpellMiss | null) => void
  setSuspended: (updater: (prev: boolean) => boolean) => void
  /** 判完这一题、指针推到下一题。 */
  advance: () => void
  /** 关卷（队列 / 设置面板 / 文章轮次一并清掉）。 */
  closeSession: () => void
  /** 交给背单词会话重学这些词；旧调用方不传时退回「关卷」。 */
  onRelearn?: (ids: string[]) => void
}

export interface QuizSpellMissActions {
  /** 确认拼写判错，继续下一题（该词已进重学队列）。 */
  ackSpellMiss: () => void
  /** 立即从头重学拼错的词（挂起考试，队列留着）。 */
  relearnSpellMiss: () => void
  /** 重学结束：解除挂起，从下一题继续。 */
  resumeFromRelearn: () => void
}

export function useQuizSpellMissActions({
  spellMiss,
  setSpellMiss,
  setSuspended,
  advance,
  closeSession,
  onRelearn,
}: UseQuizSpellMissActionsParams): QuizSpellMissActions {
  const ackSpellMiss = useCallback(() => {
    if (!spellMiss) return
    setSpellMiss(null)
    advance()
  }, [spellMiss, advance, setSpellMiss])

  const relearnSpellMiss = useCallback(() => {
    if (!spellMiss) return
    const id = spellMiss.itemId
    if (!onRelearn) {
      // 没有接背单词会话（旧调用方）：保持原来的「关卷」语义，别留一个谁也恢复不了的挂起态
      closeSession()
      return
    }
    setSpellMiss(null)
    advance()
    setSuspended(() => true)
    onRelearn([id])
  }, [spellMiss, closeSession, onRelearn, setSpellMiss, advance, setSuspended])

  const resumeFromRelearn = useCallback(() => {
    setSuspended((prev) => (prev ? false : prev))
  }, [setSuspended])

  return { ackSpellMiss, relearnSpellMiss, resumeFromRelearn }
}
