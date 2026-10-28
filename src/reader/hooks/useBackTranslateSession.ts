import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { BackTranslationFeedback, BackTranslationRecord } from '../../core/backTranslate'
import type { Sentence } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'

export interface UseBackTranslateSessionParams {
  doc: ReaderDoc | null
  selectedId: string | null
  articleIdentity: string
  articleTitle: string
  history: BackTranslationRecord[]
  closeOthers: () => void
  flash: (message: string) => void
  abortRef: MutableRefObject<AbortController | null>
}

function hasTranslation(s: Sentence): boolean {
  return !!String(s.translation ?? '').trim()
}

/**
 * 回译会话的出题与导航：可练句子、当前句、上下句、历史回看。
 * 批改状态机在 useBackTranslateGrading，两者共用 `abortRef`。
 */
export function useBackTranslateSession({
  doc,
  selectedId,
  articleIdentity,
  articleTitle,
  history,
  closeOthers,
  flash,
  abortRef,
}: UseBackTranslateSessionParams) {
  const [open, setOpen] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [gradedAnswer, setGradedAnswer] = useState('')
  const [feedback, setFeedback] = useState<BackTranslationFeedback | null>(null)
  const [error, setError] = useState('')
  const [grading, setGrading] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualText, setManualText] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)

  const translated = useMemo(() => (doc?.sentences ?? []).filter((s) => hasTranslation(s)), [doc])

  const current = useMemo(
    () => (queue.length > index ? (doc?.sentences.find((s) => s.id === queue[index]) ?? null) : null),
    [doc, queue, index],
  )

  /** 上一句中文只用来理解指代；没有译文就不塞。 */
  const contextZh = useMemo(() => {
    if (!doc || !current) return undefined
    const i = doc.sentences.findIndex((s) => s.id === current.id)
    if (i <= 0) return undefined
    const prev = doc.sentences[i - 1]
    return String(prev.translation ?? '').trim() || undefined
  }, [doc, current])

  const articleHistory = useMemo(
    () => history.filter((r) => r.articleId === articleIdentity),
    [history, articleIdentity],
  )

  const resetAttempt = useCallback(() => {
    setAnswer('')
    setGradedAnswer('')
    setFeedback(null)
    setError('')
    setManualOpen(false)
    setManualText('')
  }, [])

  const start = useCallback(() => {
    const canPractice = !!doc && translated.length > 0
    // 没有可练的句子时，只要还有存档就允许打开「历史回看」——文章删了也能找回财富。
    if (!canPractice && !history.length) {
      flash('这篇还没有可回译的句子：先点「全文翻译」把译文补回来')
      return
    }
    closeOthers()
    if (!canPractice) {
      setQueue([])
      setIndex(0)
      setOpen(true)
      resetAttempt()
      flash('当前没有可回译的句子；可以在历史里回看存档')
      return
    }
    const startId = selectedId && translated.some((s) => s.id === selectedId) ? selectedId : translated[0].id
    const at = translated.findIndex((s) => s.id === startId)
    setQueue(translated.map((s) => s.id))
    setIndex(at >= 0 ? at : 0)
    setOpen(true)
    resetAttempt()
  }, [doc, translated, selectedId, history.length, closeOthers, flash, resetAttempt])

  const close = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setGrading(false)
    setOpen(false)
  }, [abortRef])

  const move = useCallback(
    (delta: number) => {
      if (grading) return
      setIndex((i) => Math.min(Math.max(0, i + delta), Math.max(0, queue.length - 1)))
      resetAttempt()
    },
    [grading, queue.length, resetAttempt],
  )

  const retry = useCallback(() => {
    if (grading) return
    resetAttempt()
  }, [grading, resetAttempt])

  /** 载入一条历史：同句才放回答；跨文章只让面板展开看，不硬塞进当前题。 */
  const loadHistory = useCallback(
    (rec: BackTranslationRecord) => {
      const qi = queue.indexOf(rec.sentenceId)
      if (qi < 0) {
        flash('这条记录属于另一篇/另一句；可在历史里直接回看')
        return false
      }
      setIndex(qi)
      setAnswer(rec.answer)
      setGradedAnswer(rec.answer)
      setFeedback(rec.feedback)
      setError('')
      setManualOpen(false)
      setManualText('')
      return true
    },
    [queue, flash],
  )

  // 组件卸载 / 关闭时别让请求继续花额度。
  useEffect(() => () => abortRef.current?.abort(), [abortRef])

  return {
    open,
    close,
    start,
    /** 路由深链接用：失败时不改 open，交给 useRoutedFlows 回落文章页。 */
    queueLength: queue.length,
    position: queue.length ? Math.min(index + 1, queue.length) : 0,
    canPrev: index > 0,
    canNext: index < queue.length - 1,
    prev: () => move(-1),
    next: () => move(1),
    retry,
    loadHistory,
    current,
    sourceZh: String(current?.translation ?? '').trim(),
    reference: current?.text ?? '',
    contextZh,
    articleIdentity,
    articleTitle,
    answer,
    setAnswer,
    gradedAnswer,
    setGradedAnswer,
    feedback,
    setFeedback,
    error,
    setError,
    grading,
    setGrading,
    configured,
    setConfigured,
    manualOpen,
    setManualOpen,
    manualText,
    setManualText,
    articleHistory,
    history,
  }
}

export type BackTranslateSessionApi = ReturnType<typeof useBackTranslateSession>
