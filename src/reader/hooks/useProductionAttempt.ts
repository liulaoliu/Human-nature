import { useCallback, useState } from 'react'
import type { ProductionMode, ProductionPrompt, ProductionTargetHit } from '../../core/production'
import { checkProductionTargets } from '../../core/production'
import {
  buildProductionFeedbackPrompt,
  makeProductionTask,
  parseProductionFeedback,
  type ProductionTask,
} from '../../core/productionPrompts'
import type { WritingFeedback, WritingRecord } from '../../core/writing'
import { addWritingRecord, writingRecordKey } from '../../core/writing'
import { makeSkippedProductionRecord } from '../../core/productionHistory'

interface FeedbackPending {
  prompt: string
  answer: string
  task: ProductionTask
  hits: ProductionTargetHit[]
  round: number
}

export interface ProductionAttemptSnapshot {
  answer: string
  feedback: WritingFeedback | null
  previousFeedback: WritingFeedback | null
  hits: ProductionTargetHit[]
  round: number
}

export interface UseProductionAttemptParams {
  current: ProductionPrompt | null
  sessionTopic: string
  sessionMode: ProductionMode
  sessionId: string
  articleIdentity: string
  articleTitle: string
  /** 是否还有下一题；没有就交给 onDone。 */
  hasNext: boolean
  onNext: () => void
  onDone: () => void
  setWritingHistory: (updater: (history: WritingRecord[]) => WritingRecord[]) => void
  recordActivity: (cat: 'write', n?: number) => void
  ensureAi: () => Promise<boolean>
  callAi: (task: string, prompt: string) => Promise<string>
  copy: (prompt: string) => Promise<boolean>
  flash: (message: string) => void
  now: () => Date
}

/**
 * 一题作答 / 批改 / 重写 / 跳过 / 下一题的状态机。
 * 会话 hook 只负责出题、历史、进度和草稿；这里不碰 prompts 列表本身。
 */
export function useProductionAttempt({
  current,
  sessionTopic,
  sessionMode,
  sessionId,
  articleIdentity,
  articleTitle,
  hasNext,
  onNext,
  onDone,
  setWritingHistory,
  recordActivity,
  ensureAi,
  callAi,
  copy,
  flash,
  now,
}: UseProductionAttemptParams) {
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [previousFeedback, setPreviousFeedback] = useState<WritingFeedback | null>(null)
  const [hits, setHits] = useState<ProductionTargetHit[]>([])
  const [round, setRound] = useState(1)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState('')
  const [pasteKind, setPasteKind] = useState<'feedback' | ''>('')
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackPending | null>(null)
  const [lastRecordKey, setLastRecordKey] = useState('')

  const reset = useCallback(() => {
    setAnswer('')
    setFeedback(null)
    setPreviousFeedback(null)
    setHits([])
    setRound(1)
    setGrading(false)
    setError('')
    setPasteKind('')
    setPendingFeedback(null)
    setLastRecordKey('')
  }, [])

  const restore = useCallback((snapshot: ProductionAttemptSnapshot) => {
    setAnswer(snapshot.answer)
    setFeedback(snapshot.feedback)
    setPreviousFeedback(snapshot.previousFeedback)
    setHits(snapshot.hits)
    setRound(snapshot.round)
    setGrading(false)
    setError('')
    setPasteKind('')
    setPendingFeedback(null)
    setLastRecordKey('')
  }, [])

  const applyFeedback = useCallback(
    (parsed: NonNullable<ReturnType<typeof parseProductionFeedback>>, pending: FeedbackPending) => {
      const rec: WritingRecord = {
        at: now().toISOString(),
        articleId: articleIdentity || 'manual',
        ...(articleTitle ? { articleTitle } : {}),
        model: pending.task.model,
        text: pending.answer,
        feedback: parsed.feedback,
        task: { ...pending.task, hits: pending.hits, round: pending.round } as typeof pending.task,
        source: 'production',
      }
      const key = writingRecordKey(rec)
      setWritingHistory((h) =>
        h.some((r) => writingRecordKey(r) === key) ? h : addWritingRecord(h, rec),
      )
      setLastRecordKey(key)
      recordActivity('write', 1)
      setFeedback(parsed.feedback)
      setPreviousFeedback(parsed.feedback)
      setHits(pending.hits)
      setRound(pending.round)
      setPasteKind('')
      setPendingFeedback(null)
      setError('')
    },
    [articleIdentity, articleTitle, now, setWritingHistory, recordActivity],
  )

  const setHitUsed = useCallback(
    (id: string, used: boolean) => {
      const next = hits.map((h) => (h.id === id ? { ...h, used } : h))
      setHits(next)
      if (!lastRecordKey) return
      setWritingHistory((history) =>
        history.map((rec) =>
          writingRecordKey(rec) === lastRecordKey
            ? { ...rec, task: { ...rec.task, hits: next } as typeof rec.task }
            : rec,
        ),
      )
    },
    [hits, lastRecordKey, setWritingHistory],
  )

  const grade = useCallback(async () => {
    if (!current) {
      flash('这一题还没有题面')
      return
    }
    const text = answer.trim()
    if (!text) {
      flash('先写一句英文再批改')
      return
    }
    const task = makeProductionTask(current, sessionTopic, sessionMode, sessionId)
    const nextHits = checkProductionTargets(text, current.targets)
    const prompt = buildProductionFeedbackPrompt(
      task,
      text,
      round > 1 && previousFeedback?.issues.length ? previousFeedback.issues : undefined,
    )
    const pending: FeedbackPending = { prompt, answer: text, task, hits: nextHits, round }
    setPendingFeedback(pending)
    setError('')

    if (!(await ensureAi())) {
      setPasteKind('feedback')
      if (await copy(prompt)) flash('已复制批改提示词；把 AI 返回的 JSON 粘到下面')
      return
    }

    setGrading(true)
    try {
      const raw = await callAi('feedback', prompt)
      const parsed = parseProductionFeedback(raw, text)
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON（version / scores / issues / polished / summary）')
        return
      }
      applyFeedback(parsed, pending)
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setPasteKind('feedback')
    } finally {
      setGrading(false)
    }
  }, [
    current,
    answer,
    sessionTopic,
    round,
    previousFeedback,
    sessionMode,
    sessionId,
    ensureAi,
    copy,
    callAi,
    flash,
    applyFeedback,
  ])

  const applyFeedbackPaste = useCallback(
    (raw: string): boolean => {
      if (!pendingFeedback) return false
      const parsed = parseProductionFeedback(raw, pendingFeedback.answer)
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON（version / scores / issues / polished / summary）')
        return false
      }
      applyFeedback(parsed, pendingFeedback)
      return true
    },
    [pendingFeedback, applyFeedback],
  )

  const copyPromptAgain = useCallback(async () => {
    if (pendingFeedback?.prompt) await copy(pendingFeedback.prompt)
  }, [pendingFeedback, copy])

  const rewrite = useCallback(() => {
    if (!feedback || round >= 2) return
    setPreviousFeedback(feedback)
    setFeedback(null)
    setHits([])
    setRound(2)
    setPasteKind('')
    setError('')
  }, [feedback, round])

  const next = useCallback(() => {
    if (!feedback) {
      flash('先重写一版并批改，再进下一题')
      return
    }
    if (round < 2) {
      flash('先按批改意见重写一版，再进下一题')
      return
    }
    reset()
    if (hasNext) onNext()
    else onDone()
  }, [feedback, round, flash, reset, hasNext, onNext, onDone])

  const skip = useCallback(() => {
    if (current && !feedback) {
      const rec = makeSkippedProductionRecord({
        task: makeProductionTask(current, sessionTopic, sessionMode, sessionId),
        text: answer.trim(),
        at: now().toISOString(),
        articleId: articleIdentity,
        articleTitle,
        round,
      })
      setWritingHistory((history) => addWritingRecord(history, rec))
    }
    reset()
    if (hasNext) onNext()
    else onDone()
  }, [current, feedback, sessionTopic, sessionMode, sessionId, answer, round, now, articleIdentity, articleTitle, setWritingHistory, reset, hasNext, onNext, onDone])

  return {
    answer,
    setAnswer,
    feedback,
    previousFeedback,
    hits,
    setHitUsed,
    round,
    grading,
    error,
    pasteKind,
    pendingPrompt: pendingFeedback?.prompt ?? '',
    grade,
    applyFeedbackPaste,
    copyPromptAgain,
    rewrite,
    next,
    skip,
    reset,
    restore,
    cancelGrading: () => setGrading(false),
    clearError: () => setError(''),
  }
}
