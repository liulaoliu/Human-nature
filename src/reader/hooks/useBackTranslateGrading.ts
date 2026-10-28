import { useCallback, type MutableRefObject } from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  buildBackTranslationPrompt,
  compareToReference,
  makeBackTranslationId,
  parseBackTranslationFeedback,
  type BackTranslationRecord,
} from '../../core/backTranslate'
import type { Sentence } from '../../types/document'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'
import type { BackTranslateSessionApi } from './useBackTranslateSession'

export interface UseBackTranslateGradingParams {
  session: BackTranslateSessionApi
  saveRecord: (rec: BackTranslationRecord) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  flash: (message: string) => void
  abortRef: MutableRefObject<AbortController | null>
  /** 测试注入：AI 是否已配置 */
  aiStatus?: () => Promise<boolean>
  /** 测试注入：跑一条批改任务 */
  runAi?: typeof runAiBatch
  now?: () => Date
}

/**
 * 回译批改状态机：本机直连 / 复制提示词 → 粘贴 JSON → 严格解析 → 追加存档。
 * 会话的题目与作答状态在 useBackTranslateSession，这里只负责判分与落库存档。
 */
export function useBackTranslateGrading({
  session,
  saveRecord,
  recordActivity,
  flash,
  abortRef,
  aiStatus = fetchAiStatus,
  runAi = runAiBatch,
  now,
}: UseBackTranslateGradingParams) {
  const {
    current,
    contextZh,
    articleIdentity,
    articleTitle,
    answer,
    grading,
    configured,
    manualText,
    setGrading,
    setConfigured,
    setError,
    setGradedAnswer,
    setFeedback,
    setManualOpen,
    setManualText,
  } = session

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
      setError,
      setFeedback,
      setGradedAnswer,
      setManualOpen,
      setManualText,
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
  }, [current, promptFor, flash, setManualOpen])

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
  }, [
    current,
    grading,
    answer,
    promptFor,
    configured,
    aiStatus,
    copyPrompt,
    runAi,
    finish,
    flash,
    abortRef,
    setConfigured,
    setError,
    setGrading,
  ])

  const applyManual = useCallback(() => {
    if (!manualText.trim()) {
      setError('先把 AI 返回的 JSON 粘进来')
      return
    }
    finish(manualText, 'manual')
  }, [manualText, finish, setError])

  return {
    grade,
    cancelGrade: () => abortRef.current?.abort(),
    applyManual,
    copyPrompt,
  }
}

export type BackTranslateGradingApi = ReturnType<typeof useBackTranslateGrading>
