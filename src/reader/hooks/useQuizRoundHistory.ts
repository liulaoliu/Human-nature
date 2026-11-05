import { useCallback, useRef, useState } from 'react'
import { pickFreshQuestions, questionHistoryKey } from '../../core/quizHistory'
import type { QuizKind, QuizQuestion } from '../../core/quiz'
import type { QuizScope } from '../../core/quizPool'

/** 一轮考试的来源：词级 / 文章级 / 指定题目（错题重练、包围战）。 */
export type QuizRoundSource = 'vocab' | 'article' | 'items'

/** 「再来一轮」要完整复现上一轮：同来源、同范围、同题型，只换数量。 */
export interface QuizRoundSpec {
  source: QuizRoundSource
  scope: QuizScope
  kinds: QuizKind[]
  /** 上一轮实际开考的题数；0 = 全部（不限）。 */
  limit: number
  /** source = 'items' 时的词条 id。 */
  ids?: string[]
  /** 本轮的去重 track；items 轮为空（错题重练不跳过）。 */
  key: string
}

export interface QuizRoundHistory {
  /** 上一轮的模式 / 范围 / 题型 / 实际题数（结算页「再来一轮」用）。 */
  lastRound: QuizRoundSpec | null
  /** 判分后调用：只记当前这一轮的 track；错题重练不记。 */
  markAnswered: (q: QuizQuestion) => void
  /** 开始一轮前从候选里取新题；全考完会自动重开一轮，避免卡死。 */
  prepare: (key: string, qs: QuizQuestion[], take: number) => QuizQuestion[]
  /** 把「这一轮考了什么」记下来。 */
  remember: (spec: QuizRoundSpec, picked: QuizQuestion[], take: number) => void
}

const EMPTY_SEEN: ReadonlySet<string> = new Set()
const ROUND_RESET = '这一范围的新题已经考完，已重新开始一轮（会包含已考题）'

/**
 * 考试轮次历史：每个「来源 + 范围 + 题型」各自一份已考题，外加「上一轮怎么开的」。
 *
 * 从 `useQuizStarts` 抽出来，是因为「跳过旧题 / 全考完重置 / 再来一轮复现」是一组
 * 独立状态；出卷入口只负责按题型组题，读这里的结果。
 */
export function useQuizRoundHistory(flash: (message: string) => void): QuizRoundHistory {
  const [lastRound, setLastRound] = useState<QuizRoundSpec | null>(null)
  const seenRef = useRef<Map<string, Set<string>>>(new Map())
  /** 当前正在答的那一轮的 track；空 = 不记录（错题重练 / 包围战）。 */
  const currentKeyRef = useRef('')

  const markAnswered = useCallback((q: QuizQuestion) => {
    const key = currentKeyRef.current
    if (!key) return
    const set = seenRef.current.get(key) ?? new Set<string>()
    set.add(questionHistoryKey(q))
    seenRef.current.set(key, set)
  }, [])

  const prepare = useCallback(
    (key: string, qs: QuizQuestion[], take: number): QuizQuestion[] => {
      const seen = seenRef.current.get(key) ?? EMPTY_SEEN
      let result = pickFreshQuestions(qs, seen, take)
      let reset = false
      if (!result.picked.length && seen.size > 0) {
        seenRef.current.delete(key)
        result = pickFreshQuestions(qs, EMPTY_SEEN, take)
        reset = true
      }
      if (reset) {
        flash(ROUND_RESET)
      } else if (take > 0 && result.picked.length < take) {
        flash(`本轮的新题只剩 ${result.picked.length} 道，先考这些`)
      }
      return result.picked
    },
    [flash],
  )

  const remember = useCallback((spec: QuizRoundSpec, picked: QuizQuestion[], take: number) => {
    currentKeyRef.current = spec.key
    setLastRound({ ...spec, limit: take > 0 ? picked.length : 0 })
  }, [])

  return { lastRound, markAnswered, prepare, remember }
}
