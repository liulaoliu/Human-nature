import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  buildBackTranslationPrompt,
  compareToReference,
  makeBackTranslationId,
  parseBackTranslationFeedback,
  type BackTranslationFeedback,
  type BackTranslationRecord,
} from '../../core/backTranslate'
import type { Sentence } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'

export interface UseBackTranslateParams {
  doc: ReaderDoc | null
  selectedId: string | null
  articleIdentity: string
  articleTitle: string
  /** 已存档的全部回译记录（useLearningData） */
  history: BackTranslationRecord[]
  /** 追加一条存档（useLearningData.saveBackTranslation） */
  saveRecord: (rec: BackTranslationRecord) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  flash: (message: string) => void
  /** 打开回译时关掉其它整页会话。 */
  closeOthers: () => void
  /** 测试注入：AI 是否已配置 */
  aiStatus?: () => Promise<boolean>
  /** 测试注入：跑一条批改任务 */
  runAi?: typeof runAiBatch
  now?: () => Date
}

function hasTranslation(s: Sentence): boolean {
  return !!String(s.translation ?? '').trim()
}

/**
 * 回译训练会话：中文题干 → 用户写英文 → AI 批改 → 存档。
 *
 * 批改有两条路：本机配了 AI key 就直连 `/api/ai/run`；没有就复制提示词，
 * 让用户把 AI 的 JSON 粘回面板。两条路共用同一个严格解析器。
 * 存档只追加、不截断（长期学习资产），写入交给 useLearningData。
 */
export function useBackTranslate({
  doc,
  selectedId,
  articleIdentity,
  articleTitle,
  history,
  saveRecord,
  recordActivity,
  flash,
  closeOthers,
  aiStatus = fetchAiStatus,
  runAi = runAiBatch,
  now,
}: UseBackTranslateParams) {
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
  const abortRef = useRef<AbortController | null>(null)

  const translated = useMemo(
    () => (doc?.sentences ?? []).filter((s) => hasTranslation(s)),
    [doc],
  )

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
  }, [])

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
  useEffect(() => () => abortRef.current?.abort(), [])

  const promptFor = useCallback(
    (sentence: Sentence, zh: string) =>
      buildBackTranslationPrompt({
        sourceZh: zh,
        reference: sentence.text,
        contextZh,
        articleTitle,
      }),
    [articleTitle, contextZh],
  )

  const finish = useCallback(
    (raw: string, gradedBy: 'local' | 'manual'): boolean => {
      if (!current) return false
      const sourceZh = String(current.translation ?? '').trim()
      if (!sourceZh) {
        setError('当前句没有中文译文，没法批改')
        return false
      }
      const parsed = parseBackTranslationFeedback(raw)
      if (!parsed) {
        setError('没解析出批改结果：确认 AI 返回的是一个 JSON 对象（含 scores / issues）')
        return false
      }
      const at = (now ? now() : new Date()).toISOString()
      const rec: BackTranslationRecord = {
        id: makeBackTranslationId(at, articleIdentity, current.id, answer.trim()),
        at,
        articleId: articleIdentity,
        articleTitle: articleTitle || undefined,
        sentenceId: current.id,
        sourceZh,
        contextZh,
        answer: answer.trim(),
        reference: current.text,
        feedback: parsed,
        closeness: (() => {
          const c = compareToReference(answer.trim(), current.text)
          return { exact: c.exact, ratio: c.ratio }
        })(),
        gradedBy,
      }
      saveRecord(rec)
      recordActivity('write', 1)
      setGradedAnswer(answer.trim())
      setFeedback(parsed)
      setError('')
      setManualOpen(false)
      setManualText('')
      return true
    },
    [
      current,
      now,
      articleIdentity,
      articleTitle,
      contextZh,
      answer,
      saveRecord,
      recordActivity,
    ],
  )

  const copyPrompt = useCallback(async () => {
    if (!current) return
    const prompt = promptFor(current, String(current.translation ?? '').trim())
    try {
      await navigator.clipboard.writeText(prompt)
      setManualOpen(true)
      flash('已复制批改提示词；把 AI 返回的 JSON 粘到下面')
    } catch {
      setManualOpen(true)
      flash('复制失败：浏览器需要 localhost 或 https；可手动复制提示词')
    }
  }, [current, promptFor, flash])

  const grade = useCallback(async () => {
    if (!current || grading) return
    const text = answer.trim()
    if (!text) {
      flash('先写一句英文再批改')
      return
    }
    setError('')
    const prompt = promptFor(current, String(current.translation ?? '').trim())

    let ready = configured
    if (ready === null) {
      ready = await aiStatus()
      setConfigured(ready)
    }
    if (!ready) {
      await copyPrompt()
      return
    }

    setGrading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const out = await runAi(
        [{ id: `back-${Date.now().toString(36)}`, task: 'back_check', prompt }],
        { signal: ctrl.signal },
      )
      if (ctrl.signal.aborted) return
      const raw = out.results[0]?.raw
      if (!raw) {
        const why = out.failed[0]?.error ?? 'AI 没有返回批改结果'
        setError(why)
        return
      }
      finish(raw, 'local')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(String((e as Error)?.message || e))
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setGrading(false)
    }
  }, [current, grading, answer, promptFor, configured, aiStatus, copyPrompt, runAi, finish, flash])

  const applyManual = useCallback(() => {
    if (!manualText.trim()) {
      setError('先把 AI 返回的 JSON 粘进来')
      return
    }
    finish(manualText, 'manual')
  }, [manualText, finish])

  /** 只加新记录；本地 state 也由 useLearningData 的 history 回灌，避免两份事实。 */
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
    articleTitle,
    answer,
    setAnswer,
    gradedAnswer,
    feedback,
    error,
    grading,
    configured,
    grade,
    cancelGrade: () => abortRef.current?.abort(),
    manualOpen,
    setManualOpen,
    manualText,
    setManualText,
    applyManual,
    copyPrompt,
    articleHistory,
    history,
  }
}
