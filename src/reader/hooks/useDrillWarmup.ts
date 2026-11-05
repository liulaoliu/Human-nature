import { useCallback, useRef, useState } from 'react'
import type { QuizKind, QuizQuestion } from '../../core/quiz'
import type { QuizScope } from '../../core/quizPool'
import { buildWarmupCards, type DrillWarmupCard } from '../../core/quizWarmup'
import type { VocabItem } from '../../types/document'
import type { QuizRoundSpec } from './useQuizRoundHistory'

/** 预习态：题目已经出好，等人看完再开考。 */
export interface DrillWarmupState {
  /** memory = 记忆拷打（词·搭配），chunk = 词块拷打（词块·搭配） */
  kind: 'memory' | 'chunk'
  title: string
  cards: DrillWarmupCard[]
  /** 点「开始拷打」时才真正进队列 */
  questions: QuizQuestion[]
  article: boolean
  /** 本轮实际题数（用户可在预习页改；改完重新抽卡） */
  limit: number
}

interface WarmupSpec {
  key: string
  qs: QuizQuestion[]
  scope: QuizScope
  kinds: QuizKind[]
  kind: 'memory' | 'chunk'
}

export interface UseDrillWarmupParams {
  libraryItems: VocabItem[]
  begin: (qs: QuizQuestion[], opts?: { article?: boolean }) => void
  prepare: (key: string, qs: QuizQuestion[], take: number) => QuizQuestion[]
  remember: (spec: QuizRoundSpec, picked: QuizQuestion[], take: number) => void
}

export interface DrillWarmupApi {
  warmup: DrillWarmupState | null
  beginWarmup: () => void
  cancelWarmup: () => void
  /** 预习页改本轮题数：重新抽卡 / 重建题目，不直接开考。 */
  setWarmupLimit: (limit: number) => void
  /** 出一张新预习卡（记忆 / 词块开考、或结算页「再来一轮」）。 */
  showWarmup: (args: {
    picked: QuizQuestion[]
    qs: QuizQuestion[]
    key: string
    scope: QuizScope
    kinds: QuizKind[]
    kind: 'memory' | 'chunk'
    take: number
  }) => void
}

/**
 * 记忆 / 词块的「先看一遍」页：题目 + 释义 / 词块摊开，数量也在这一页选。
 *
 * 和出卷逻辑分开：`useQuizStarts` 只负责「这轮考哪些题」，这里负责「开考前先展示、
 * 改数量重抽、看完再入队」。结算页「再来一轮」也回到这里，而不是直接开考。
 */
export function useDrillWarmup({
  libraryItems,
  begin,
  prepare,
  remember,
}: UseDrillWarmupParams): DrillWarmupApi {
  const [warmup, setWarmup] = useState<DrillWarmupState | null>(null)
  const specRef = useRef<WarmupSpec | null>(null)

  const beginWarmup = useCallback(() => {
    const w = warmup
    if (!w) return
    specRef.current = null
    setWarmup(null)
    begin(w.questions, { article: w.article })
  }, [warmup, begin])

  const cancelWarmup = useCallback(() => {
    specRef.current = null
    setWarmup(null)
  }, [])

  const setWarmupLimit = useCallback(
    (limit: number) => {
      const spec = specRef.current
      if (!spec) return
      const picked = prepare(spec.key, spec.qs, limit)
      const cards = buildWarmupCards(libraryItems, picked, spec.kind)
      setWarmup((prev) =>
        prev ? { ...prev, cards, questions: picked, limit: picked.length } : prev,
      )
      remember(
        {
          source: 'vocab',
          scope: spec.scope,
          kinds: spec.kinds,
          limit,
          key: spec.key,
          warmup: spec.kind,
        },
        picked,
        limit,
      )
    },
    [libraryItems, prepare, remember],
  )

  const showWarmup = useCallback(
    ({
      picked,
      qs,
      key,
      scope,
      kinds,
      kind,
      take,
    }: {
      picked: QuizQuestion[]
      qs: QuizQuestion[]
      key: string
      scope: QuizScope
      kinds: QuizKind[]
      kind: 'memory' | 'chunk'
      take: number
    }) => {
      specRef.current = { key, qs, scope, kinds, kind }
      setWarmup({
        kind,
        title: kind === 'chunk' ? '词块拷打 · 先看一遍' : '记忆拷打 · 先看一遍',
        cards: buildWarmupCards(libraryItems, picked, kind),
        questions: picked,
        article: false,
        limit: picked.length,
      })
      remember({ source: 'vocab', scope, kinds, limit: take, key, warmup: kind }, picked, take)
    },
    [libraryItems, remember],
  )

  return { warmup, beginWarmup, cancelWarmup, setWarmupLimit, showWarmup }
}
