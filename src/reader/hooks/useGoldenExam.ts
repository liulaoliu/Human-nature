import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
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
import type { WritingRecord } from '../../core/writing'
import type { GoldenExamItem, GoldenLesson } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { ReaderDoc } from './useReaderDoc'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'
import { useGoldenImitation } from './useGoldenImitation'

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
  const [generating, setGenerating] = useState(false)
  const [taskError, setTaskError] = useState('')

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
  const attempt = useGoldenImitation({
    current,
    articleId,
    articleTitle,
    source: 'goldenExam',
    setWritingHistory,
    flash,
    recordActivity,
    runAi,
    aiStatus,
    now,
  })
  const error = taskError || attempt.error
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
    attempt.reset()
    setTaskError('')
  }, [attempt.reset])

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
        setTaskError('没解析出考试题：需要 JSON：{"items":[{sentenceId,task,structure,mustUse,rubric}]}')
        return false
      }
      persist(next)
      setIndex(0)
      reset()
      setTaskError('')
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
    if (!(await attempt.ensureAi())) {
      try {
        await navigator.clipboard.writeText(prompt)
        flash('已复制 AI 出题提示词；把返回的 JSON 粘到下面「应用 AI 结果」')
      } catch {
        setTaskError('复制失败：浏览器需要 localhost 或 https')
      }
      return
    }
    setGenerating(true)
    setTaskError('')
    try {
      const out = await runAi(
        [{ id: `golden-exam-${Date.now().toString(36)}`, task: 'golden_exam', prompt }],
        { signal: new AbortController().signal },
      )
      const raw = out.results[0]?.raw
      if (!raw) {
        setTaskError(out.failed[0]?.error ?? 'AI 没有返回考试题')
        return
      }
      applyTasks(raw)
    } catch (e) {
      setTaskError(String((e as Error)?.message || e))
    } finally {
      setGenerating(false)
    }
  }, [lesson, unlocked, after, metas, records, articleId, articleTitle, attempt.ensureAi, runAi, applyTasks, flash])

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
      setTaskError('复制失败：浏览器需要 localhost 或 https')
    }
  }, [lesson, unlocked, metas, records, articleId, articleTitle, flash])

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
    answer: attempt.answer,
    setAnswer: attempt.setAnswer,
    feedback: attempt.feedback,
    grading: attempt.grading,
    generating,
    error,
    history,
    start,
    next,
    prev,
    generateTasks,
    copyTaskPrompt,
    applyTasks,
    grade: attempt.grade,
    copyGradePrompt: attempt.copyGradePrompt,
    applyGrade: attempt.applyGrade,
  }
}
