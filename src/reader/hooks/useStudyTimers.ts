import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabItem } from '../../types/document'

export interface UseStudyTimersOptions {
  /** 当前轮队列（null = 不在背单词界面）。 */
  queue: VocabItem[] | null
  /** 当前卡下标（换卡时单卡计时归零）。 */
  index: number
  /** 把背单词时长累加到「今天」（每 15s 一次 + 暂停/退出补落盘）。 */
  addStudyTime: (seconds: number, cards: number) => void
  /** 暂停（卡内编辑时传 true）：两只表都停，恢复后接着走、不归零。 */
  paused?: boolean
}

/**
 * 背单词的两只表：
 *  - 单卡计时：换卡归零，每秒 +1（越久越「烫」，到点触发强制锤炼）；
 *  - 本轮总时长：每秒 +1，每 15 秒落盘一次，暂停/退出时把余数补记。
 * 只做计时，不关心评分与队列推进。
 *
 * 注意：**归零只看换卡 / 换队列，暂停开关不能进重置 effect**，
 * 否则一开编辑计时就归零（锤炼阈值也跟着倒退）。
 */
export function useStudyTimers({ queue, index, addStudyTime, paused = false }: UseStudyTimersOptions) {
  const [live, setLive] = useState(0)
  const liveRef = useRef(0)
  const flushedRef = useRef(0)
  const [cardSeconds, setCardSeconds] = useState(0)
  /** 落盘函数用 ref，避免它的身份变化把正在跑的 interval 反复重启。 */
  const addRef = useRef(addStudyTime)
  addRef.current = addStudyTime

  // 单卡计时：换卡归零（暂停不影响这里）
  useEffect(() => {
    if (!queue) return
    setCardSeconds(0)
  }, [queue, index])

  // 单卡每秒 +1；暂停时停表，恢复接着走
  useEffect(() => {
    if (!queue || paused) return
    const id = window.setInterval(() => setCardSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [queue, index, paused])

  // 新一轮：总时长清零（暂停不影响这里）
  useEffect(() => {
    if (!queue) return
    liveRef.current = 0
    flushedRef.current = 0
    setLive(0)
  }, [queue])

  /** 把还没落盘的秒数记进今天（0 秒不写）。 */
  const flush = useCallback(() => {
    const unflushed = liveRef.current - flushedRef.current
    if (unflushed > 0) {
      addRef.current(unflushed, 0)
      flushedRef.current = liveRef.current
    }
  }, [])

  // 本轮总时长：暂停时停表；每 15s 落盘一次，暂停 / 退出时补落盘
  useEffect(() => {
    if (!queue || paused) return
    const id = window.setInterval(() => {
      liveRef.current += 1
      setLive(liveRef.current)
      if (liveRef.current - flushedRef.current >= 15) flush()
    }, 1000)
    return () => {
      window.clearInterval(id)
      flush()
    }
  }, [queue, paused, flush])

  return {
    liveSeconds: live,
    cardSeconds,
    /** 本轮尚未落盘的秒数（用于「累计时长」显示）。 */
    unflushedSeconds: Math.max(0, live - flushedRef.current),
  }
}
