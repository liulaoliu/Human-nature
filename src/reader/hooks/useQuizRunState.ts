import { useCallback, useRef, useState } from 'react'
import type { QuizQuestion } from '../../core/quiz'
import { useQuizAdvance } from './useQuizAdvance'
import { useQuizSessionSnapshot } from './useQuizSessionSnapshot'
import type { QuizSpellMiss } from '../quiz/createQuizCheck'

/**
 * 一轮考试的「进行中状态」：题目 / 指针 / 输入 / 判定 / 成绩 / 自动切题。
 *
 * 状态本身仍由 `useQuizSessionSnapshot` 负责恢复与落盘，切题时序由 `useQuizAdvance` 负责；
 * 这里只把它们和文章轮次、设置面板、拼写锁定、本轮全部题目放在一起，提供统一的重置入口。
 */
export function useQuizRunState() {
  /** 本轮是不是「文章测验」（决定面板标题、且不写 SRS）。 */
  const [articleRun, setArticleRun] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  /** 拼写题拼错：判定提示（非空时不许直接切题 / 退出）。 */
  const [spellMiss, setSpellMiss] = useState<QuizSpellMiss | null>(null)
  /** 本轮全部题目（重做错题按 id 从这里取，词/文章通用）。 */
  const allRef = useRef<QuizQuestion[]>([])

  const snapshot = useQuizSessionSnapshot()
  const { restored, setIndex, setInput, setChecked, setResult, setResults } = snapshot
  // 恢复的会话若已完成，别在挂载时把成绩再记一遍
  const recordedRef = useRef(!!restored && restored.index >= restored.queue.length)

  const { clearAdvance, advance, next, scheduleAdvance } = useQuizAdvance({
    spellMiss,
    setInput,
    setChecked,
    setResult,
    setIndex,
  })

  /** 开新一轮 / 重做错题共用的会话字段重置。 */
  const resetProgress = useCallback(() => {
    setIndex(0)
    setInput('')
    setChecked(false)
    setResult(null)
    setSpellMiss(null)
    setResults([])
    recordedRef.current = false
  }, [setIndex, setInput, setChecked, setResult, setResults])

  return {
    ...snapshot,
    articleRun,
    setArticleRun,
    setupOpen,
    setSetupOpen,
    spellMiss,
    setSpellMiss,
    allRef,
    recordedRef,
    clearAdvance,
    advance,
    next,
    scheduleAdvance,
    resetProgress,
  }
}
