import { useEffect, useState } from 'react'
import type { QuizQuestion } from '../../core/quiz'

/**
 * 一轮考试的计时：开考清零，每秒 +1；关卷自动停。
 * 只做计时，不参与判分与切题。挂起（去重学）期间停表，回来接着算。
 */
export function useQuizTimer(queue: QuizQuestion[] | null, suspended = false): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (queue) setSeconds(0)
  }, [queue])

  useEffect(() => {
    if (!queue || suspended) return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [queue, suspended])

  return seconds
}
