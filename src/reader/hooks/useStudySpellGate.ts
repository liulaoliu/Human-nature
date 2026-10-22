import { useCallback, useRef, useState } from 'react'
import type { VocabItem } from '../../types/document'
import { spellingMatches } from '../../core/vocab'

/**
 * 正面拼写判定的「卡面状态」（从 `useStudySession` 拆出来）。
 *
 * 只管三件事：检查输入、拼错后把「判为不认识」这张卡钉在屏幕上、
 * 用户确认前锁住导航。落库与记账（SRS again、加练重排、每日新词配额、计时）
 * 全在主 hook 的 `judge` 回调里——**一个写入方**，这里不碰词库。
 *
 * 拼写口径仍是「错一次定生死」：不允许再输一次蒙对（见 `core/vocab/spelling`）。
 */

export interface SpellMissCard {
  /** 拼错那一次写的内容 */
  input: string
  word: string
  meaning: string | null
  /** 是否已重排到队尾（false = 本轮练满了，明天再重学）。 */
  requeued: boolean
}

export interface SpellJudgeResult {
  requeued: boolean
  word: string
  meaning: string | null
}

export interface UseStudySpellGateParams {
  active: boolean
  card: VocabItem | null
  /**
   * 拼错判卷：主 hook 落库 + 记账 + 切到「判错卡」的界面状态，
   * 返回重排与否和要展示的词 / 释义。
   */
  judge: (typed: string) => SpellJudgeResult
}

export interface StudySpellGate {
  spellMiss: SpellMissCard | null
  /** 回车 / 点「检查」。返回 true = 拼对了（评分解锁留给主 hook）。 */
  check: (typed: string) => boolean
  /** 用户确认「判为不认识」，主 hook 负责推进到下一张。 */
  ack: () => void
  /** 换卡 / 重开一轮：清掉判错卡。 */
  reset: () => void
}

export function useStudySpellGate(params: UseStudySpellGateParams): StudySpellGate {
  const { active, card } = params
  const judgeRef = useRef(params.judge)
  judgeRef.current = params.judge

  const [spellMiss, setSpellMiss] = useState<SpellMissCard | null>(null)

  const check = useCallback(
    (typed: string) => {
      if (!active || !card || spellMiss) return false
      if (spellingMatches(typed, card.word)) return true
      const result = judgeRef.current(typed)
      setSpellMiss({ input: typed, word: result.word, meaning: result.meaning, requeued: result.requeued })
      return false
    },
    [active, card, spellMiss],
  )

  const ack = useCallback(() => setSpellMiss(null), [])
  const reset = useCallback(() => setSpellMiss(null), [])

  return { spellMiss, check, ack, reset }
}
