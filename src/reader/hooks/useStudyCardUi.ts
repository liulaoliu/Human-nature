import { useCallback, useState } from 'react'
import type { ReviewGrade } from '../../core/vocab'

/**
 * 一张卡的界面开关：翻面 / 拼写输入 / 已判、释义门禁、锤炼门禁、押后的评分。
 *
 * 从 `useStudySession` 抽出来。它们会被「换卡 / 评分 / 拼错确认 / 重开一轮」同时重置，
 * 以前散在多个分支里逐个 set，漏一个就会把上一张卡的状态带到下一张。
 * 这里只存状态和重置动作，**不判分、不推进**（那些在 `useStudyAnswering`）。
 */

export interface StudyPendingScore {
  grade: ReviewGrade
  advance: boolean
}

export function useStudyCardUi() {
  const [revealed, setRevealed] = useState(false)
  const [input, setInput] = useState('')
  const [checked, setChecked] = useState(false)
  /** 本卡是否已经通过「选中文释义」这一关。 */
  const [meaningCleared, setMeaningCleared] = useState(false)
  /** 本卡是否已完成「强制锤炼」（完成才允许评分）。 */
  const [drillCleared, setDrillCleared] = useState(false)
  /**
   * 重学卡上「押后」的评分：用户点了认识/模糊/忘记了，但这一卡还没过锤炼。
   * 锤炼是评分门禁，不是查看门禁（2026-10-24 改）。
   */
  const [pendingScore, setPendingScore] = useState<StudyPendingScore | null>(null)

  /** 换卡时清掉所有卡面开关（编辑草稿 / 各模式子状态由调用方一起清）。 */
  const resetFlags = useCallback(() => {
    setRevealed(false)
    setInput('')
    setChecked(false)
    setDrillCleared(false)
    setMeaningCleared(false)
    // 押后的评分只属于这一张卡：换卡 / 结束会话 / 重开一轮都必须丢掉。
    setPendingScore(null)
  }, [])

  const clearDrill = useCallback(() => {
    setDrillCleared(true)
    // 锤炼里已经考过「选词义」；不再让同一张卡接着做一遍复习门禁。
    setMeaningCleared(true)
  }, [])

  const clearMeaningGate = useCallback(() => setMeaningCleared(true), [])

  return {
    revealed,
    setRevealed,
    input,
    setInput,
    checked,
    setChecked,
    meaningCleared,
    drillCleared,
    pendingScore,
    setPendingScore,
    resetFlags,
    clearDrill,
    clearMeaningGate,
  }
}

export type StudyCardUi = ReturnType<typeof useStudyCardUi>
