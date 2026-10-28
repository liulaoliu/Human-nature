import { useEffect, useState } from 'react'
import type { QuizQuestion } from '../../core/quiz'

/**
 * 一轮考试的计时：开考清零，每秒 +1；关卷自动停。
 * 只做计时，不参与判分与切题。
 */
export function useQuizTimer(queue: QuizQuestion[] | null): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!queue) return
    setSeconds(0)
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [queue])

  return seconds
}
