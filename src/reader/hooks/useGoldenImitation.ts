import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { buildGoldenExamFeedbackPrompt, examToImitation } from '../../core/goldenExam'
import {
  addWritingRecord,
  parseWritingFeedbackDetailed,
  writingAttemptsFor,
  type WritingFeedback,
  type WritingFeedbackPromptOptions,
  type WritingRecord,
} from '../../core/writing'
import type { GoldenExamItem } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'

export type GoldenImitationSource = 'goldenExam' | 'goldenSentence' | 'goldenError'

export interface UseGoldenImitationParams {
  /** 当前题；null = 还没有题，不能批改 */
  current: GoldenExamItem | null
  articleId: string
  articleTitle: string
  /** goldenExam = 整课考试；goldenSentence = 单句仿写；goldenError = 错因订正 */
  source: GoldenImitationSource
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  /** 全库写作历史：用来翻看同一题之前的批改（可选） */
  writingHistory?: WritingRecord[]
  /** 当前题可用的文章语言点；批改时限定 from=article 的 pointId（可选） */
  availablePoints?: WritingFeedbackPromptOptions['availablePoints']
  /** 测试注入 */
  runAi?: typeof runAiBatch
  aiStatus?: () => Promise<boolean>
  now?: () => Date
}

/**
 * 一次仿写作答（写 → AI 批改 → 存历史）。
 *
 * 整课仿写考试、每句末尾的单句仿写和错因订正共用这一条，避免两套批改/解析/存记录。
 * 题面由调用方准备：单句仿写用当前句，考试用 `GoldenLesson.exam`，错因订正用 `errorFixExamItem`。
 */
export function useGoldenImitation({
  current,
  articleId,
  articleTitle,
  source,
  setWritingHistory,
  flash,
  recordActivity,
  writingHistory,
  availablePoints,
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
  /**
   * 翻看历史批改：null = 看最新（实时 feedback），数字 = 第几条历史记录。
   * 只在同一题（同篇同句/同题同 focus）里翻，不串到别的题。
   */
  const [viewIndex, setViewIndex] = useState<number | null>(null)

  const examId = source === 'goldenExam' ? (current?.id ?? null) : null
  const attempts = useMemo(
    () =>
      current
        ? writingAttemptsFor(writingHistory ?? [], {
            articleId,
            sentenceId: current.sentenceId,
            examId: examId,
            focus: current.focus ?? '',
          })
        : [],
    [writingHistory, articleId, current, examId],
  )

/** 同题、同稿、同文字算一次；重复点批改不往历史里堆第二条。 */
function hasSameAttempt(list: WritingRecord[], rec: WritingRecord): boolean {
  const key = (r: WritingRecord) =>
    [r.articleId, r.sentenceId ?? r.examId ?? '', r.task?.focus ?? '', r.task?.round ?? 1, r.text.trim()].join('\u0000')
  const k = key(rec)
  return list.some((r) => key(r) === k)
}

  const reset = useCallback(() => {
    setAnswer('')
    setFeedback(null)
    setError('')
    setRound(1)
    setViewIndex(null)
  }, [])

  // 换题就清空上一题的作答；同一题重进由调用方再 reset 一次。
  const itemId = current?.id ?? ''
  useEffect(() => {
    setAnswer('')
    setFeedback(null)
    setError('')
    setRound(1)
    setViewIndex(null)
  }, [itemId])

  const ensureAi = useCallback(async () => {
    if (configured !== null) return configured
    const ready = await aiStatus()
    setConfigured(ready)
    return ready
  }, [configured, aiStatus])

  const saveAttempt = useCallback(
    (fb: WritingFeedback, textOverride?: string) => {
      if (!current) return
      const rec: WritingRecord = {
        at: now().toISOString(),
        articleId,
        ...(articleTitle ? { articleTitle } : {}),
        model: current.model,
        text: (textOverride ?? answer).trim(),
        feedback: fb,
        task: { ...examToImitation(current), ...(round > 1 ? { round } : {}) },
        source,
        ...(source === 'goldenExam' ? { examId: current.id } : { sentenceId: current.sentenceId }),
      }
      // 同一题同一稿、文字没改再点一次批改：不重复记（AI 结果会变，但记录不重复堆）
      setWritingHistory((h) => (hasSameAttempt(h, rec) ? h : addWritingRecord(h, rec)))
      // 刚交一稿：回到最新，别停在历史页
      setViewIndex(null)
      recordActivity('write', 1)
    },
    [current, articleId, articleTitle, answer, source, round, setWritingHistory, recordActivity, now],
  )

  const applyGrade = useCallback(
    (raw: string, textOverride?: string) => {
      const text = (textOverride ?? answer).trim()
      if (!text) {
        flash('先写一句英文再批改')
        return false
      }
      const pointIds = availablePoints?.length
        ? new Set(availablePoints.map((p) => p.id))
        : undefined
      const parsed = parseWritingFeedbackDetailed(raw, { answer: text, availablePointIds: pointIds })
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON：{version, scores, issues, recommendations, polished}')
        return false
      }
      setFeedback(parsed.feedback)
      saveAttempt(parsed.feedback, text)
      const dropped = parsed.dropped
      if (dropped.issues || dropped.recommendations) {
        flash(`已忽略 ${dropped.issues} 条无法定位的问题、${dropped.recommendations} 条无效语言点`)
      } else if (dropped.inferred) {
        flash(`${dropped.inferred} 条缺 rule/key，已自动归类`)
      }
      return true
    },
    [answer, availablePoints, flash, saveAttempt],
  )

  const copyGradePrompt = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? answer).trim()
    if (!current) {
      flash('这一题还没有题面')
      return
    }
    if (!text) {
      flash('先写一句英文再批改')
      return
    }
    try {
      await navigator.clipboard.writeText(
        buildGoldenExamFeedbackPrompt(current, text, {
          availablePoints,
          ...(round > 1 && feedback?.issues.length ? { previousIssues: feedback.issues } : {}),
        }),
      )
      flash('已复制批改提示词；把返回的 JSON 粘到「应用 AI 批改结果」')
    } catch {
      setError('复制失败：浏览器需要 localhost 或 https')
    }
  }, [current, answer, availablePoints, feedback, round, flash])

  const grade = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? answer).trim()
    if (!current) {
      flash('这一题还没有题面')
      return
    }
    if (!text) {
      flash('先写一句英文再批改')
      return
    }
    const prompt = buildGoldenExamFeedbackPrompt(current, text, {
      availablePoints,
      ...(round > 1 && feedback?.issues.length ? { previousIssues: feedback.issues } : {}),
    })
    if (!(await ensureAi())) {
      await copyGradePrompt(text)
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
      applyGrade(raw, text)
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setGrading(false)
    }
  }, [current, answer, availablePoints, feedback, round, ensureAi, copyGradePrompt, runAi, applyGrade, flash])

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

  const viewing = viewIndex === null ? null : (attempts[viewIndex] ?? null)
  /** 往更早一稿翻（第一次点 = 最新那条的前一条） */
  const earlier = useCallback(() => {
    if (attempts.length < 2) return
    setViewIndex((cur) => (cur === null ? Math.max(0, attempts.length - 2) : Math.max(0, cur - 1)))
  }, [attempts.length])
  /** 往更新一稿翻；翻过最后一条就回到实时视图 */
  const later = useCallback(() => {
    setViewIndex((cur) => {
      if (cur === null) return null
      const next = cur + 1
      return next >= attempts.length ? null : next
    })
  }, [attempts.length])
  const backToLive = useCallback(() => setViewIndex(null), [])

  return {
    current,
    /** 同一题的历史批改（时间正序，最后一条是最新） */
    attempts,
    /** 正在看的历史记录；null = 看最新 */
    viewing,
    earlier,
    later,
    backToLive,
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
