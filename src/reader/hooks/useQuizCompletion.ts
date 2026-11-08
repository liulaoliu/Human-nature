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
  /** 拷打被「从头重学」挂起：先不结算、不自动鞭打，等回来再算。 */
  suspended: boolean
  /** 记忆 / 词块拷打：结算页要留给造句，别自动跳去重练错题。 */
  drill: 'memory' | 'chunk' | null
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
  /**
   * 本轮拷打最初的判分结果 / 题目（重练错题后仍保留）。
   * 结算页的造句按「整轮考过的内容」出题，不能因为重练只剩一道就缩成一题。
   */
  sentenceResults: QuizResultRow[]
  sentenceQuestions: QuizQuestion[]
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
    suspended,
    drill,
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
  /**
   * 拷打这一轮**最初**的题目与判分结果。
   * 「继续鞭打错题」会把 queue / results 换成只剩错题的小轮；造句页仍要按原来的整轮出题，
   * 否则用户重练完就只剩一道造句，之前没造过的内容全丢。
   */
  const [sentenceRound, setSentenceRound] = useState<{
    results: QuizResultRow[]
    questions: QuizQuestion[]
  } | null>(null)

  /** 新一轮开始：鞭打轮数归零。 */
  const resetDrill = useCallback(() => {
    drillRoundRef.current = 0
    setDrillRound(0)
    setSentenceRound(null)
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

  // 拷打第一次答完：把整轮题目 / 结果留一份给结算页造句。
  // 之后「继续鞭打错题」只换当前 queue / results，不会把这条快照冲掉。
  useEffect(() => {
    if (!drill || !queue || index < queue.length || results.length === 0) return
    setSentenceRound((prev) => prev ?? { results, questions: queue })
  }, [drill, queue, index, results])

  // 考试完成 → 记一次成绩
  useEffect(() => {
    if (!queue) {
      recordedRef.current = false
      return
    }
    // 挂起期间不解算：最后一道题刚好拼错去重学时，别在背单词界面后面偷偷记成绩 / 开鞭打轮
    if (suspended) return
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
      // 反复鞭打：还有错题就自动重练（上限 MAX_DRILL_ROUNDS 轮，避免死循环）。
      // 记忆 / 词块拷打不自动跳：结算页的造句才是这一轮的落点，自动重练会把 5 造句闪掉。
      // 想重练的用户可以点结算页的「继续鞭打错题」。
      const wrong = results.filter((r) => !r.correct).length
      if (!drill && loopWrong && wrong > 0 && drillRoundRef.current < MAX_DRILL_ROUNDS) {
        drillRoundRef.current += 1
        setDrillRound(drillRoundRef.current)
        setAutoRun(true) // 鞭打轮自动切题，别停下来
        drillTimerRef.current = window.setTimeout(() => {
          drillTimerRef.current = null
          retryWrong()
        }, 1500)
      }
    }
  }, [queue, index, results, suspended, drill, recordPractice, onKinds, loopWrong, retryWrong, recordedRef, setAutoRun])

  // 卸载时清掉待触发的鞭打定时器（自动切题由 useQuizAdvance 自己清理）
  useEffect(() => () => clearDrill(), [clearDrill])

  return {
    drillRound,
    sentenceResults: sentenceRound?.results ?? results,
    sentenceQuestions: sentenceRound?.questions ?? queue ?? [],
    retryWrong,
    resetDrill,
    clearDrill,
  }
}
