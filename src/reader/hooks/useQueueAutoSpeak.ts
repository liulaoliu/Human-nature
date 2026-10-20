import { useEffect } from 'react'
import type { QuizQuestion } from '../../core/quiz'

/** 听写队列里一条（只用到要念的文本） */
interface DictationLine {
  text: string
}

/**
 * 「题目/听写一换，就自动出声」的两条接线。
 *
 * 从 `ReaderApp` 抽出来的原因：这是**两段几乎一样的 effect**（考试听力题、听写逐句），
 * 都靠 `speak` 念文本，写完一边忘一边就会出现「考试有声音、听写没声音」这种怪事。
 * 放一起，改触发条件时两边同时看见。
 *
 * 触发条件：
 * - 考试：当前题是听力/听音辨词（`listen` / `ear`）且有可念文本；
 * - 听写：索引落在队列内（越界时不念，切到最后一题后不会空转）。
 */
export function useQueueAutoSpeak(params: {
  quizQueue: readonly QuizQuestion[] | null | undefined
  quizIndex: number
  dictQueue: readonly DictationLine[] | null | undefined
  dictIndex: number
  speak: (text: string) => void
}): void {
  const { quizQueue, quizIndex, dictQueue, dictIndex, speak } = params

  // 考试：听力题出现时自动朗读（句子 / 单词）
  useEffect(() => {
    if (!quizQueue) return
    const q = quizQueue[quizIndex]
    if ((q?.kind === 'listen' || q?.kind === 'ear') && q.audioText) speak(q.audioText)
  }, [quizQueue, quizIndex, speak])

  // 听写：每换一句自动播放
  useEffect(() => {
    if (!dictQueue || dictIndex >= dictQueue.length) return
    speak(dictQueue[dictIndex].text)
  }, [dictQueue, dictIndex, speak])
}
