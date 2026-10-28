import { useCallback, useEffect, useRef, useState, type MutableRefObject, type SetStateAction } from 'react'
import { shuffleQuiz, type QuizKind, type QuizQuestion } from '../../core/quiz'
import type { QuizResultRow } from '../../core/sessionSnapshots'
import type { PracticeKind } from '../../core/practice'

/** 「反复鞭打」最多自动重练几轮（防死循环）。 */
const MAX_DRILL_ROUNDS = 5

export interface UseQuizCompletionParams {
  queue: QuizQuestion[] | null
  index: number
  results: QuizResultRow[]
  /** 本轮全部题目（重做错题按 id 从这里取，词/文章通用）。 */
  allRef: MutableRefObject<QuizQuestion[]>
  /** 恢复的会话若已完成，别在挂载时把成绩再记一遍。 */
  recordedRef: MutableRefObject<boolean>
  loopWrong: boolean
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  onKinds?: (rows: { kind: QuizKind; total: number; correct: number }[]) => void
  flash: (message: string) => void
  clearAdvance: () => void
  setQueue: (value: SetStateAction<QuizQuestion[] | null>) => void
  setAutoRun: (value: SetStateAction<boolean>) => void
  resetProgress: () => void
}

export interface QuizCompletion {
  drillRound: number
  retryWrong: () => void
  resetDrill: () => void
  clearDrill: () => void
}

/**
 * 一轮考试的收尾：记一次成绩、按题型汇总、反复鞭打错题。
 *
 * 从 `useQuizSession` 拆出来是因为这三件事共享「本轮是否已结算 / 第几轮」两个账本；
 * 判分、出卷、快捷键都不在这里。
 */
export function useQuizCompletion(params: UseQuizCompletionParams): QuizCompletion {
  const {
    queue,
    index,
    results,
    allRef,
    recordedRef,
    loopWrong,
    recordPractice,
    onKinds,
    flash,
    clearAdvance,
    setQueue,
    setAutoRun,
    resetProgress,
  } = params

  const [drillRound, setDrillRound] = useState(0)
  const drillRoundRef = useRef(0)
  /** 鞭打轮的定时器（换轮/关闭时清掉）。 */
  const drillTimerRef = useRef<number | null>(null)

  /** 新一轮开始：鞭打轮数归零。 */
  const resetDrill = useCallback(() => {
    drillRoundRef.current = 0
    setDrillRound(0)
  }, [])

  /** 关卷 / 卸载：清掉待触发的鞭打定时器。 */
  const clearDrill = useCallback(() => {
    if (drillTimerRef.current) {
      window.clearTimeout(drillTimerRef.current)
      drillTimerRef.current = null
    }
  }, [])

  const retryWrong = useCallback(() => {
    // 按题目 id 从本轮全部题目里取错题（词级 / 文章级通用）
    const wrongIds = new Set(results.filter((r) => !r.correct).map((r) => r.id))
    const qs = allRef.current.filter((q) => wrongIds.has(q.id))
    if (!qs.length) {
      flash('没有可重做的错题')
      return
    }
    clearAdvance()
    setQueue(shuffleQuiz(qs))
    resetProgress()
  }, [results, allRef, clearAdvance, flash, setQueue, resetProgress])

  // 考试完成 → 记一次成绩
  useEffect(() => {
    if (!queue) {
      recordedRef.current = false
      return
    }
    if (index >= queue.length && results.length > 0 && !recordedRef.current) {
      recordedRef.current = true
      recordPractice('quiz', results.length, results.filter((r) => r.correct).length)
      // 按题型汇总（词块/搭配正确率等量化用）
      if (onKinds) {
        const kindOf = new Map(queue.map((q) => [q.id, q.kind]))
        const tally = new Map<QuizKind, { total: number; correct: number }>()
        for (const r of results) {
          const k = kindOf.get(r.id)
          if (!k) continue
          const cur = tally.get(k) ?? { total: 0, correct: 0 }
          cur.total += 1
          if (r.correct) cur.correct += 1
          tally.set(k, cur)
        }
        if (tally.size) onKinds([...tally].map(([kind, s]) => ({ kind, ...s })))
      }
      // 反复鞭打：还有错题就自动重练（上限 MAX_DRILL_ROUNDS 轮，避免死循环）
      const wrong = results.filter((r) => !r.correct).length
      if (loopWrong && wrong > 0 && drillRoundRef.current < MAX_DRILL_ROUNDS) {
        drillRoundRef.current += 1
        setDrillRound(drillRoundRef.current)
        setAutoRun(true) // 鞭打轮自动切题，别停下来
        drillTimerRef.current = window.setTimeout(() => {
          drillTimerRef.current = null
          retryWrong()
        }, 1500)
      }
    }
  }, [queue, index, results, recordPractice, onKinds, loopWrong, retryWrong, recordedRef, setAutoRun])

  // 卸载时清掉待触发的鞭打定时器（自动切题由 useQuizAdvance 自己清理）
  useEffect(() => () => clearDrill(), [clearDrill])

  return { drillRound, retryWrong, resetDrill, clearDrill }
}
