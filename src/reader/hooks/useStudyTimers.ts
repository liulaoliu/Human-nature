import { useEffect, useRef, useState } from 'react'
import type { VocabItem } from '../../types/document'

export interface UseStudyTimersOptions {
  /** 当前轮队列（null = 不在背单词界面）。 */
  queue: VocabItem[] | null
  /** 当前卡下标（换卡时单卡计时归零）。 */
  index: number
  /** 把背单词时长累加到「今天」（每 15s 一次 + 退出补落盘）。 */
  addStudyTime: (seconds: number, cards: number) => void
}

/**
 * 背单词的两只表：
 *  - 单卡计时：换卡归零，每秒 +1（越久越「烫」，到点触发强制锤炼）；
 *  - 本轮总时长：每秒 +1，每 15 秒落盘一次，退出时把余数补记。
 * 只做计时，不关心评分与队列推进。
 */
export function useStudyTimers({ queue, index, addStudyTime }: UseStudyTimersOptions) {
  const [live, setLive] = useState(0)
  const liveRef = useRef(0)
  const flushedRef = useRef(0)
  const [cardSeconds, setCardSeconds] = useState(0)

  // 单卡计时：换卡归零，每秒 +1（催你快点，别墨迹）
  useEffect(() => {
    if (!queue) return
    setCardSeconds(0)
    const id = window.setInterval(() => setCardSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [queue, index])

  // 本轮总时长：进场清零，每秒 +1；每 15s 落盘一次，退出时补落盘
  useEffect(() => {
    if (!queue) return
    liveRef.current = 0
    flushedRef.current = 0
    setLive(0)
    const id = window.setInterval(() => {
      liveRef.current += 1
      setLive(liveRef.current)
      const unflushed = liveRef.current - flushedRef.current
      if (unflushed >= 15) {
        addStudyTime(unflushed, 0)
        flushedRef.current = liveRef.current
      }
    }, 1000)
    return () => {
      window.clearInterval(id)
      const unflushed = liveRef.current - flushedRef.current
      if (unflushed > 0) {
        addStudyTime(unflushed, 0)
        flushedRef.current = liveRef.current
      }
    }
  }, [queue, addStudyTime])

  return {
    liveSeconds: live,
    cardSeconds,
    /** 本轮尚未落盘的秒数（用于「累计时长」显示）。 */
    unflushedSeconds: Math.max(0, live - flushedRef.current),
  }
}
