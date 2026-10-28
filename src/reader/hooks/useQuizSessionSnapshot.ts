import { useEffect, useState } from 'react'
import {
  parseQuizSessionSnapshot,
  type QuizResultRow,
  type QuizSessionSnapshot,
} from '../../core/sessionSnapshots'
import type { QuizQuestion } from '../../core/quiz'

const QUIZ_SESSION_KEY = 'reader:quizSession'

function loadQuizSession(): QuizSessionSnapshot | null {
  try {
    return parseQuizSessionSnapshot(localStorage.getItem(QUIZ_SESSION_KEY))
  } catch {
    return null
  }
}

/**
 * 考试会话的「刷新可恢复」状态。
 *
 * 状态本身不在这里造业务规则：只负责从 localStorage 恢复、在变化时落盘。
 * 出卷/判分仍在 useQuizSession，避免恢复逻辑和判分逻辑互相掺。
 */
export function useQuizSessionSnapshot() {
  const [restored] = useState<QuizSessionSnapshot | null>(loadQuizSession)
  const [queue, setQueue] = useState<QuizQuestion[] | null>(restored?.queue ?? null)
  const [index, setIndex] = useState(restored?.index ?? 0)
  const [input, setInput] = useState(restored?.input ?? '')
  const [checked, setChecked] = useState(restored?.checked ?? false)
  const [result, setResult] = useState<boolean | null>(restored?.result ?? null)
  const [results, setResults] = useState<QuizResultRow[]>(restored?.results ?? [])
  /** 本轮是否自动切题（开始一轮时按设置快照）。 */
  const [autoRun, setAutoRun] = useState(restored?.autoRun ?? false)

  // 刷新页面后能接着考
  useEffect(() => {
    try {
      if (queue && queue.length) {
        const snap: QuizSessionSnapshot = { v: 1, queue, index, input, checked, result, results, autoRun }
        localStorage.setItem(QUIZ_SESSION_KEY, JSON.stringify(snap))
      } else {
        localStorage.removeItem(QUIZ_SESSION_KEY)
      }
    } catch {
      // 隐私模式 / 配额满：忽略
    }
  }, [queue, index, input, checked, result, results, autoRun])

  return {
    restored,
    queue,
    setQueue,
    index,
    setIndex,
    input,
    setInput,
    checked,
    setChecked,
    result,
    setResult,
    results,
    setResults,
    autoRun,
    setAutoRun,
  }
}
