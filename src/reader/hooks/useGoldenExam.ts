import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  buildGoldenExamFeedbackPrompt,
  buildGoldenExamPrompt,
  buildLocalGoldenExam,
  examToImitation,
  goldenExamAfter,
  goldenExamCompletedIds,
  goldenExamPromptSentences,
  isGoldenExamRecord,
  normalizeGoldenExam,
  parseGoldenExam,
} from '../../core/goldenExam'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import { addWritingRecord, parseWritingFeedback, type WritingFeedback, type WritingRecord } from '../../core/writing'
import type { GoldenExamItem, GoldenLesson } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { ReaderDoc } from './useReaderDoc'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'

export interface UseGoldenExamParams {
  doc: ReaderDoc | null
  lesson: GoldenLesson | null
  articleId: string
  articleTitle: string
  records: GoldenDrillRecord[]
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  /** 测试注入 */
  runAi?: typeof runAiBatch
  aiStatus?: () => Promise<boolean>
  now?: () => Date
}

/**
 * 仿写考试：完成 5/10 句后解锁；本地先出题，AI 可重新出题并批改。
 *
 * 题目内容写回 `doc.golden.exam`；作答成绩进 `writingHistory`（source='goldenExam'），
 * 所以刷新/换浏览器后仍能回看，且不用再发明一套学习记录结构。
 */
export function useGoldenExam({
  doc,
  lesson,
  articleId,
  articleTitle,
  records,
  writingHistory,
  setWritingHistory,
  setDoc,
  setPendingSave,
  flash,
  recordActivity,
  runAi = runAiBatch,
  aiStatus = fetchAiStatus,
  now = () => new Date(),
}: UseGoldenExamParams) {
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [grading, setGrading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)

  const metas = useMemo(
    () =>
      (doc?.sentences ?? []).map((s) => ({
        id: s.id,
        text: s.text,
        ...(s.translation ? { translation: s.translation } : {}),
      })),
    [doc?.sentences],
  )
  const after = goldenExamAfter(lesson)
  const completedIds = useMemo(
    () => (lesson ? goldenExamCompletedIds(lesson, metas, records, articleId) : []),
    [lesson, metas, records, articleId],
  )
  const completedCount = completedIds.length
  const unlocked = !!lesson && completedCount >= after
  const localItems = useMemo(
    () => (lesson ? buildLocalGoldenExam(lesson, metas, records, articleId) : []),
    [lesson, metas, records, articleId],
  )
  const savedItems = useMemo(
    () => (lesson?.exam?.length ? normalizeGoldenExam(lesson.exam, metas, 'ai') : []),
    [lesson?.exam, metas],
  )
  const items = savedItems.length ? savedItems : localItems
  const current = items[index] ?? null
  const task = current ? examToImitation(current) : null
  const history = useMemo(
    () => writingHistory.filter((r) => isGoldenExamRecord(r) && r.articleId === articleId),
    [writingHistory, articleId],
  )

  const persist = useCallback(
    (next: GoldenExamItem[]) => {
      if (!next.length) return
      setDoc((d) => {
        if (!d) return d
        const base = d.golden ?? lesson
        return base ? { ...d, golden: { ...base, exam: next, updatedAt: now().toISOString() } } : d
      })
      setPendingSave(true)
    },
    [setDoc, setPendingSave, lesson, now],
  )

  const reset = useCallback(() => {
    setAnswer('')
    setFeedback(null)
    setError('')
  }, [])

  const start = useCallback(() => {
    if (!lesson) {
      flash('还没有金句课')
      return
    }
    if (!unlocked) {
      flash(`完成 ${after} 句后解锁仿写考试`)
      return
    }
    if (!lesson.exam?.length && localItems.length) persist(localItems)
    setIndex(0)
    reset()
  }, [lesson, unlocked, after, localItems, persist, reset, flash])

  const applyTasks = useCallback(
    (raw: string) => {
      const next = parseGoldenExam(raw, metas)
      if (!next.length) {
        setError('没解析出考试题：需要 JSON：{"items":[{sentenceId,task,structure,mustUse,rubric}]}')
        return false
      }
      persist(next)
      setIndex(0)
      reset()
      flash(`已应用 ${next.length} 道仿写考试题`)
      return true
    },
    [metas, persist, reset, flash],
  )

  const generateTasks = useCallback(async () => {
    if (!lesson || !unlocked) {
      flash(`完成 ${after} 句后解锁仿写考试`)
      return
    }
    const promptSentences = goldenExamPromptSentences(lesson, metas, records, articleId)
    if (!promptSentences.length) {
      flash('还没有完成句子，无法出题')
      return
    }
    const prompt = buildGoldenExamPrompt({ title: articleTitle, sentences: promptSentences })
    let ready = configured
    if (ready === null) {
      ready = await aiStatus()
      setConfigured(ready)
    }
    if (!ready) {
      try {
        await navigator.clipboard.writeText(prompt)
        flash('已复制 AI 出题提示词；把返回的 JSON 粘到下面「应用 AI 结果」')
      } catch {
        setError('复制失败：浏览器需要 localhost 或 https')
      }
      return
    }
    setGenerating(true)
    setError('')
    try {
      const out = await runAi(
        [{ id: `golden-exam-${Date.now().toString(36)}`, task: 'golden_exam', prompt }],
        { signal: new AbortController().signal },
      )
      const raw = out.results[0]?.raw
      if (!raw) {
        setError(out.failed[0]?.error ?? 'AI 没有返回考试题')
        return
      }
      applyTasks(raw)
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setGenerating(false)
    }
  }, [lesson, unlocked, after, metas, records, articleId, articleTitle, configured, aiStatus, runAi, applyTasks, flash])

  const copyTaskPrompt = useCallback(async () => {
    if (!lesson || !unlocked) return
    const promptSentences = goldenExamPromptSentences(lesson, metas, records, articleId)
    if (!promptSentences.length) {
      flash('还没有完成句子，无法出题')
      return
    }
    try {
      await navigator.clipboard.writeText(
        buildGoldenExamPrompt({ title: articleTitle, sentences: promptSentences }),
      )
      flash('已复制 AI 出题提示词')
    } catch {
      setError('复制失败：浏览器需要 localhost 或 https')
    }
  }, [lesson, unlocked, metas, records, articleId, articleTitle, flash])

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
        task: examToImitation(current),
        source: 'goldenExam',
        examId: current.id,
      }
      setWritingHistory((h) => addWritingRecord(h, rec))
      recordActivity('write', 1)
    },
    [current, articleId, articleTitle, answer, setWritingHistory, recordActivity, now],
  )

  const applyGrade = useCallback(
    (raw: string) => {
      const fb = parseWritingFeedback(raw)
      if (!fb) {
        setError('没解析出批改结果：需要 JSON：{scores, issues, polished}')
        return false
      }
      setFeedback(fb)
      saveAttempt(fb)
      return true
    },
    [saveAttempt],
  )

  const copyGradePrompt = useCallback(async () => {
    if (!current) return
    if (!answer.trim()) {
      flash('先写一句英文再批改')
      return
    }
    try {
      await navigator.clipboard.writeText(buildGoldenExamFeedbackPrompt(current, answer))
      flash('已复制批改提示词；把返回的 JSON 粘到下面「应用 AI 结果」')
    } catch {
      setError('复制失败：浏览器需要 localhost 或 https')
    }
  }, [current, answer, flash])

  const grade = useCallback(async () => {
    if (!current) return
    if (!answer.trim()) {
      flash('先写一句英文再批改')
      return
    }
    const prompt = buildGoldenExamFeedbackPrompt(current, answer)
    let ready = configured
    if (ready === null) {
      ready = await aiStatus()
      setConfigured(ready)
    }
    if (!ready) {
      await copyGradePrompt()
      return
    }
    setGrading(true)
    setError('')
    try {
      const out = await runAi(
        [{ id: `golden-exam-grade-${Date.now().toString(36)}`, task: 'feedback', prompt }],
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
  }, [current, answer, configured, aiStatus, copyGradePrompt, runAi, applyGrade, flash])

  const next = useCallback(() => {
    setIndex((i) => Math.min(items.length, i + 1))
    reset()
  }, [items.length, reset])

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
    reset()
  }, [reset])

  return {
    after,
    completedCount,
    completedIds,
    unlocked,
    items,
    current,
    task,
    index,
    answer,
    setAnswer,
    feedback,
    grading,
    generating,
    error,
    history,
    start,
    next,
    prev,
    generateTasks,
    copyTaskPrompt,
    applyTasks,
    grade,
    copyGradePrompt,
    applyGrade,
  }
}
