import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { buildGoldenExamFeedbackPrompt, examToImitation } from '../../core/goldenExam'
import {
  addWritingRecord,
  parseWritingFeedback,
  type WritingFeedback,
  type WritingRecord,
} from '../../core/writing'
import type { GoldenExamItem } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'

export type GoldenImitationSource = 'goldenExam' | 'goldenSentence'

export interface UseGoldenImitationParams {
  /** 当前题；null = 还没有题，不能批改 */
  current: GoldenExamItem | null
  articleId: string
  articleTitle: string
  /** goldenExam = 整课考试；goldenSentence = 每句流程末尾的单句仿写 */
  source: GoldenImitationSource
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  /** 测试注入 */
  runAi?: typeof runAiBatch
  aiStatus?: () => Promise<boolean>
  now?: () => Date
}

/**
 * 一次仿写作答（写 → AI 批改 → 存历史）。
 *
 * 整课仿写考试和每句末尾的单句仿写共用这一条，避免两套批改/解析/存记录。
 * 题面由调用方准备：单句仿写用当前句，考试用 `GoldenLesson.exam`。
 */
export function useGoldenImitation({
  current,
  articleId,
  articleTitle,
  source,
  setWritingHistory,
  flash,
  recordActivity,
  runAi = runAiBatch,
  aiStatus = fetchAiStatus,
  now = () => new Date(),
}: UseGoldenImitationParams) {
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  /** 第几稿：1 = 首稿；改写过就是 2（最多两稿，避免变成无限重写） */
  const [round, setRound] = useState(1)

  const reset = useCallback(() => {
    setAnswer('')
    setFeedback(null)
    setError('')
    setRound(1)
  }, [])

  // 换题就清空上一题的作答；同一题重进由调用方再 reset 一次。
  const itemId = current?.id ?? ''
  useEffect(() => {
    setAnswer('')
    setFeedback(null)
    setError('')
    setRound(1)
  }, [itemId])

  const ensureAi = useCallback(async () => {
    if (configured !== null) return configured
    const ready = await aiStatus()
    setConfigured(ready)
    return ready
  }, [configured, aiStatus])

  const saveAttempt = useCallback(
    (fb: WritingFeedback) => {
      if (!current) return
      const rec: WritingRecord = {
        at: now().toISOString(),
        articleId,
        ...(articleTitle ? { articleTitle } : {}),
        model: current.model,
        text: answer.trim(),
        feedback: fb,
        task: { ...examToImitation(current), ...(round > 1 ? { round } : {}) },
        source,
        ...(source === 'goldenExam' ? { examId: current.id } : { sentenceId: current.sentenceId }),
      }
      setWritingHistory((h) => addWritingRecord(h, rec))
      recordActivity('write', 1)
    },
    [current, articleId, articleTitle, answer, source, round, setWritingHistory, recordActivity, now],
  )

  const applyGrade = useCallback(
    (raw: string) => {
      if (!answer.trim()) {
        flash('先写一句英文再批改')
        return false
      }
      const fb = parseWritingFeedback(raw)
      if (!fb) {
        setError('没解析出批改结果：需要 JSON：{scores, issues, polished}')
        return false
      }
      setFeedback(fb)
      saveAttempt(fb)
      return true
    },
    [answer, flash, saveAttempt],
  )

  const copyGradePrompt = useCallback(async () => {
    if (!current) {
      flash('这一题还没有题面')
      return
    }
    if (!answer.trim()) {
      flash('先写一句英文再批改')
      return
    }
    try {
      await navigator.clipboard.writeText(buildGoldenExamFeedbackPrompt(current, answer))
      flash('已复制批改提示词；把返回的 JSON 粘到「应用 AI 批改结果」')
    } catch {
      setError('复制失败：浏览器需要 localhost 或 https')
    }
  }, [current, answer, flash])

  const grade = useCallback(async () => {    if (!current) {
      flash('这一题还没有题面')
      return
    }
    if (!answer.trim()) {
      flash('先写一句英文再批改')
      return
    }
    const prompt = buildGoldenExamFeedbackPrompt(current, answer)
    if (!(await ensureAi())) {
      await copyGradePrompt()
      return
    }
    setGrading(true)
    setError('')
    try {
      const out = await runAi(
        [{ id: `golden-grade-${Date.now().toString(36)}`, task: 'feedback', prompt }],
        { signal: new AbortController().signal },
      )
      const raw = out.results[0]?.raw
      if (!raw) {
        setError(out.failed[0]?.error ?? 'AI 没有返回批改结果')
        return
      }
      applyGrade(raw)
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setGrading(false)
    }
  }, [current, answer, ensureAi, copyGradePrompt, runAi, applyGrade, flash])

  /**
   * 按上一稿的批改意见再写一稿。
   *
   * 只允许一次（1 → 2）：作答保留在输入框里，用户照着意见改；交之前不自动批改，
   * 批改记录会带 `task.round = 2`，历史/导出里能看出是第几稿。
   */
  const rewrite = useCallback(() => {
    if (!feedback || round >= 2) return
    setError('')
    setRound(2)
  }, [feedback, round])

  return {
    current,
    answer,
    setAnswer,
    feedback,
    grading,
    error,
    configured,
    reset,
    ensureAi,
    grade,
    copyGradePrompt,
    applyGrade,
    /** 第几稿（1 = 首稿，2 = 按意见改写后的稿） */
    round,
    /** 还能不能再改一稿（有批改、且还没到第 2 稿） */
    canRewrite: !!feedback && round < 2,
    rewrite,
  }
}

export type GoldenImitationApi = ReturnType<typeof useGoldenImitation>
