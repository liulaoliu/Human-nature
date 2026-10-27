import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  buildGoldenAssembly,
  buildGoldenCloze,
  buildLocalGoldenLesson,
  checkGoldenAssembly,
  checkGoldenFill,
  checkGoldenRecall,
  dedupeGoldenLesson,
  goldenDrillKey,
  goldenFillAllCorrect,
  goldenTargetsFor,
  pickGoldenCandidates,
  rankGoldenCandidates,
  type GoldenCandidate,
  type GoldenRecallResult,
  type GoldenTextMeta,
} from '../../core/golden'
import {
  emptyGoldenRecord,
  findGoldenRecord as findRecord,
  goldenCompleted,
  goldenMastered,
  recordGoldenStep,
  summarizeGolden,
  type GoldenDrillRecord,
} from '../../core/goldenProgress'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { PracticeKind } from '../../core/practice'
import type { GoldenLesson, GoldenPickMode, GoldenSentence, Sentence } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'

export type GoldenView = 'home' | 'plan' | 'drill' | 'recall' | 'summary'
export type GoldenPhase = 'preview' | 'fill' | 'assemble' | 'summary'

export interface UseGoldenDrillParams {
  doc: ReaderDoc | null
  /** 学习记录归属键：优先 SavedArticle.id，其次文章标识 */
  articleId: string
  articleTitle: string
  articleKey: string | null
  records: GoldenDrillRecord[]
  recordGolden: (record: GoldenDrillRecord) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordPractice: (kind: PracticeKind, total: number, correct: number) => void
  recordAnswer?: (event: AnswerEventInput) => void
  speak: (text: string) => void
  flash: (message: string) => void
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
}

function sessionKey(articleKey: string | null): string {
  return `reader:goldenSession:${articleKey ?? ''}`
}

function readSession(articleKey: string | null): { view: GoldenView; index: number; recallIndex: number } | null {
  try {
    const raw = localStorage.getItem(sessionKey(articleKey))
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const view = o.view
    if (view !== 'home' && view !== 'plan' && view !== 'drill' && view !== 'recall' && view !== 'summary') return null
    const index = Number(o.index)
    const recallIndex = Number(o.recallIndex)
    return {
      view,
      index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0,
      recallIndex: Number.isFinite(recallIndex) && recallIndex >= 0 ? Math.floor(recallIndex) : 0,
    }
  } catch {
    return null
  }
}

function sentenceTexts(doc: ReaderDoc | null): GoldenTextMeta[] {
  return (doc?.sentences ?? []).map((s) => ({
    id: s.id,
    text: s.text,
    ...(s.translation ? { translation: s.translation } : {}),
  }))
}

/** 把选中的句子按原文顺序排好，缺内容的用本地内容补。 */
function withSelection(
  lesson: GoldenLesson,
  sentences: Sentence[],
  ids: string[],
  pick: GoldenPickMode,
  dedupe: boolean,
): GoldenLesson {
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const existing = new Map(lesson.sentences.map((s) => [s.id, s]))
  const content: GoldenSentence[] = []
  for (const id of ids) {
    const hit = existing.get(id)
    if (hit) {
      content.push(hit)
      continue
    }
    const sentence = byId.get(id)
    if (!sentence) continue
    const built = buildLocalGoldenLesson([sentence], undefined, { selected: [id] }).sentences[0]
    if (built) content.push(built)
  }
  const order = new Map(sentences.map((s, i) => [s.id, i]))
  content.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const next: GoldenLesson = {
    ...lesson,
    sentences: content,
    selected: ids,
    options: { ...lesson.options, dedupe, pick },
    updatedAt: new Date().toISOString(),
  }
  return dedupe ? dedupeGoldenLesson(next) : next
}

/**
 * D老师小课堂的会话状态机：选金句 → 逐句（预览/填空/拼句/小结）→ 逆向回顾 → 总结。
 *
 * 唯一的进度写入口是 `recordGolden`；内容改动走 `setDoc + setPendingSave`。
 * 内容指纹用 `goldenDrillKey`，改正文或重新生成后旧进度不会误用。
 */
export function useGoldenDrill(params: UseGoldenDrillParams) {
  const {
    doc,
    articleId,
    articleTitle,
    articleKey,
    records,
    recordGolden,
    recordActivity,
    recordPractice,
    recordAnswer,
    speak,
    flash,
    setDoc,
    setPendingSave,
  } = params

  const sessionId = articleKey || articleId
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<GoldenView>('home')
  const [phase, setPhase] = useState<GoldenPhase>('preview')
  const [index, setIndex] = useState(0)
  const [recallIndex, setRecallIndex] = useState(0)
  const [fillInputs, setFillInputs] = useState<string[]>([])
  const [fillChecked, setFillChecked] = useState<boolean[] | null>(null)
  const [fillCorrect, setFillCorrect] = useState<boolean | null>(null)
  const [assembleOrder, setAssembleOrder] = useState<string[]>([])
  const [assembleChecked, setAssembleChecked] = useState<boolean | null>(null)
  const [recallInput, setRecallInput] = useState('')
  const [recallChecked, setRecallChecked] = useState<GoldenRecallResult | null>(null)
  const [recallRevealed, setRecallRevealed] = useState(false)
  const practicedRef = useRef(false)

  const localLesson = useMemo(
    () => (doc ? buildLocalGoldenLesson(doc.sentences, doc.paragraphs, { selected: doc.golden?.selected }) : null),
    [doc],
  )
  const lesson = doc?.golden ?? localLesson
  const ordered = useMemo(() => {
    if (!lesson) return []
    const byId = new Map(lesson.sentences.map((s) => [s.id, s]))
    const ids = lesson.selected.length ? lesson.selected : lesson.sentences.map((s) => s.id)
    return ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
  }, [lesson])
  const bySentence = useMemo(() => new Map((doc?.sentences ?? []).map((s) => [s.id, s])), [doc?.sentences])
  const current = ordered[index] ?? null
  const currentSentence = current ? bySentence.get(current.id) ?? null : null
  const targets = lesson && current ? goldenTargetsFor(lesson, current.id) : []
  const cloze = useMemo(
    () => (currentSentence ? buildGoldenCloze(currentSentence.text, targets) : null),
    [currentSentence, targets],
  )
  const assembly = useMemo(
    () => (currentSentence ? buildGoldenAssembly(currentSentence.text, targets) : null),
    [currentSentence, targets],
  )
  const drillKey = currentSentence ? goldenDrillKey(currentSentence.text, targets) : ''
  const currentRecord = useMemo(() => {
    if (!current || !drillKey) return null
    return findRecord(records, articleId, current.id, drillKey)
  }, [records, articleId, current, drillKey])
  const progress = currentRecord ?? (current && drillKey ? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString()) : null)
  const candidates = useMemo<GoldenCandidate[]>(() => (doc ? rankGoldenCandidates(doc.sentences) : []), [doc])
  const summary = useMemo(
    () => (lesson && doc ? summarizeGolden(lesson, sentenceTexts(doc), records, articleId, doc.paragraphs) : null),
    [lesson, doc, records, articleId],
  )

  const progressFor = useCallback(
    (sentenceId: string): GoldenDrillRecord | null => {
      if (!lesson) return null
      const sentence = bySentence.get(sentenceId)
      if (!sentence) return null
      const t = goldenTargetsFor(lesson, sentenceId)
      return findRecord(records, articleId, sentenceId, goldenDrillKey(sentence.text, t))
    },
    [lesson, bySentence, records, articleId],
  )

  const persistLesson = useCallback(
    (next: GoldenLesson) => {
      setDoc((d) => (d ? { ...d, golden: next } : d))
      setPendingSave(true)
    },
    [setDoc, setPendingSave],
  )

  const openGolden = useCallback(() => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const saved = readSession(sessionId)
    setOpen(true)
    setView(saved?.view ?? 'home')
    setIndex(saved?.index ?? 0)
    setRecallIndex(saved?.recallIndex ?? 0)
    setPhase('preview')
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
    setAssembleOrder([])
    setAssembleChecked(null)
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    practicedRef.current = false
  }, [doc, sessionId, flash])

  const close = useCallback(() => {
    setOpen(false)
    setView('home')
  }, [])

  // 会话位置落本机：刷新后能回到同一课/同一句（学习进度另有 goldenDrills）。
  useEffect(() => {
    if (!open) return
    try {
      localStorage.setItem(sessionKey(sessionId), JSON.stringify({ view, index, recallIndex }))
    } catch {
      // 隐私模式忽略
    }
  }, [open, sessionId, view, index, recallIndex])

  const setSelected = useCallback(
    (ids: string[], pick: GoldenPickMode) => {
      if (!lesson || !doc) return
      persistLesson(withSelection(lesson, doc.sentences, [...new Set(ids)], pick, lesson.options?.dedupe === true))
    },
    [lesson, doc, persistLesson],
  )

  const setPick = useCallback(
    (pick: GoldenPickMode) => {
      if (!lesson || !doc) return
      if (pick === 'manual') {
        persistLesson({ ...lesson, options: { ...lesson.options, pick: 'manual' } })
        return
      }
      let ids: string[] = []
      if (pick === 'recommended') ids = pickGoldenCandidates(doc.sentences, 10).map((c) => c.id)
      else if (pick === 'all') ids = doc.sentences.map((s) => s.id)
      else if (pick === 'ai') ids = lesson.aiSelected ?? lesson.selected
      if (!ids.length) {
        flash('这一档没有可选句子')
        return
      }
      setSelected(ids, pick)
    },
    [lesson, doc, persistLesson, setSelected, flash],
  )

  const toggleSentence = useCallback(
    (id: string) => {
      if (!lesson) return
      const has = lesson.selected.includes(id)
      const ids = has ? lesson.selected.filter((x) => x !== id) : [...lesson.selected, id]
      setSelected(ids, 'manual')
    },
    [lesson, setSelected],
  )

  const setDedupe = useCallback(
    (on: boolean) => {
      if (!lesson) return
      persistLesson({ ...lesson, options: { ...lesson.options, dedupe: on } })
    },
    [lesson, persistLesson],
  )

  const startDrill = useCallback(
    (from = 0) => {
      if (!ordered.length) {
        flash('先选至少一句金句')
        return
      }
      setView('drill')
      setIndex(Math.max(0, Math.min(ordered.length - 1, from)))
      setPhase('preview')
      setFillInputs([])
      setFillChecked(null)
      setFillCorrect(null)
      setAssembleOrder([])
      setAssembleChecked(null)
      practicedRef.current = false
    },
    [ordered.length, flash],
  )

  const startRecall = useCallback(() => {
    if (!ordered.length) {
      flash('先练完遣词造句')
      return
    }
    if (!ordered.every((s) => progressFor(s.id)?.summarySeen === true)) {
      flash('先完成全部句子的遣词造句，再进逆向回顾')
      return
    }
    setView('recall')
    setRecallIndex(0)
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    practicedRef.current = false
  }, [ordered, progressFor, flash])

  const nextSentence = useCallback(() => {
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
    setAssembleOrder([])
    setAssembleChecked(null)
    setPhase('preview')
    if (index + 1 < ordered.length) setIndex(index + 1)
    else startRecall()
  }, [index, ordered.length, startRecall])

  const prevSentence = useCallback(() => {
    if (index <= 0) return
    setIndex(index - 1)
    setPhase('preview')
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
    setAssembleOrder([])
    setAssembleChecked(null)
  }, [index])

  const beginFill = useCallback(() => {
    setPhase('fill')
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
  }, [])

  const checkFill = useCallback(() => {
    if (!cloze || !currentSentence || !current || !drillKey) return
    const results = checkGoldenFill(cloze, fillInputs)
    const ok = goldenFillAllCorrect(results)
    setFillChecked(results)
    setFillCorrect(ok)
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    const next = recordGoldenStep(base, 'fill', ok, new Date().toISOString())
    recordGolden(next)
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'fill',
      cat: 'write',
      correct: ok,
      questionId: `${current.id}:fill`,
    })
  }, [cloze, currentSentence, current, drillKey, fillInputs, currentRecord, articleId, articleTitle, recordGolden, recordAnswer])

  const beginAssemble = useCallback(() => {
    setPhase('assemble')
    setAssembleOrder([])
    setAssembleChecked(null)
  }, [])

  const checkAssemble = useCallback(() => {
    if (!assembly || !currentSentence || !current || !drillKey) return
    const ok = checkGoldenAssembly(assembly.cloze.targets, assembleOrder)
    setAssembleChecked(ok)
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    recordGolden(recordGoldenStep(base, 'assemble', ok, new Date().toISOString()))
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'assemble',
      cat: 'write',
      correct: ok,
      questionId: `${current.id}:assemble`,
    })
  }, [assembly, currentSentence, current, drillKey, assembleOrder, currentRecord, articleId, articleTitle, recordGolden, recordAnswer])

  const markSummary = useCallback(() => {
    if (!current || !drillKey) return
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    const next = recordGoldenStep(base, 'summary', true, new Date().toISOString())
    recordGolden(next)
    if (!base.summarySeen) recordActivity('write', 1)
    setPhase('summary')
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, recordActivity])

  const restartSentence = useCallback(() => {
    if (!current || !drillKey) return
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    // 已掌握的不降级；没掌握的“再练一次”重开一轮首次记录，给用户掌握的机会。
    const reset: GoldenDrillRecord = {
      ...base,
      fillFirst: undefined,
      assembleFirst: undefined,
      recallFirst: undefined,
      fillTries: 0,
      assembleTries: 0,
      recallTries: 0,
      summarySeen: false,
      mastered: base.mastered,
      completedAt: base.completedAt,
      at: new Date().toISOString(),
    }
    recordGolden(reset)
    setPhase('preview')
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
    setAssembleOrder([])
    setAssembleChecked(null)
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden])

  const checkRecall = useCallback(() => {
    if (!currentSentence || !current || !drillKey) return
    const result = checkGoldenRecall(recallInput, currentSentence.text)
    setRecallChecked(result)
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    recordGolden(recordGoldenStep(base, 'recall', result.firstOk, new Date().toISOString()))
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'recall',
      cat: 'write',
      correct: result.firstOk,
      questionId: `${current.id}:recall`,
    })
  }, [currentSentence, current, drillKey, recallInput, currentRecord, articleId, articleTitle, recordGolden, recordAnswer])

  const revealRecall = useCallback(() => {
    if (!current || !drillKey) return
    setRecallRevealed(true)
    if (recallChecked) return
    const base = currentRecord ?? emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    if ((base.recallTries ?? 0) === 0) {
      recordGolden(recordGoldenStep(base, 'recall', false, new Date().toISOString()))
      recordAnswer?.({
        articleId,
        source: 'golden',
        kind: 'recall',
        cat: 'write',
        correct: false,
        questionId: `${current.id}:recall`,
      })
    }
  }, [current, drillKey, currentRecord, articleId, articleTitle, recordGolden, recordAnswer, recallChecked])

  const nextRecall = useCallback(() => {
    if (recallIndex + 1 < ordered.length) {
      setRecallIndex(recallIndex + 1)
      setRecallInput('')
      setRecallChecked(null)
      setRecallRevealed(false)
      return
    }
    setView('summary')
    if (!practicedRef.current) {
      practicedRef.current = true
      const total = ordered.length
      const correct = summary?.masteredSentences ?? 0
      recordPractice('golden', total, correct)
    }
  }, [recallIndex, ordered.length, summary, recordPractice])

  const speakCurrent = useCallback(() => {
    if (currentSentence) speak(currentSentence.text)
  }, [currentSentence, speak])

  /** 逆向回顾失败后「再练一次本句」：重开首次记录，回到这句的遣词造句。 */
  const restartRecallSentence = useCallback(() => {
    const s = ordered[recallIndex]
    const sentence = s ? bySentence.get(s.id) : null
    if (!s || !sentence || !lesson) return
    const t = goldenTargetsFor(lesson, s.id)
    const key = goldenDrillKey(sentence.text, t)
    const base = findRecord(records, articleId, s.id, key) ?? emptyGoldenRecord(articleId, articleTitle, s.id, key, new Date().toISOString())
    recordGolden({
      ...base,
      fillFirst: undefined,
      assembleFirst: undefined,
      recallFirst: undefined,
      fillTries: 0,
      assembleTries: 0,
      recallTries: 0,
      summarySeen: false,
      mastered: base.mastered,
      completedAt: base.completedAt,
      at: new Date().toISOString(),
    })
    setIndex(recallIndex)
    setPhase('preview')
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
    setAssembleOrder([])
    setAssembleChecked(null)
    setRecallInput('')
    setRecallChecked(null)
    setRecallRevealed(false)
    setView('drill')
  }, [ordered, recallIndex, bySentence, lesson, records, articleId, articleTitle, recordGolden])

  const currentRecallSentence = ordered[recallIndex] ?? null
  const currentRecallText = currentRecallSentence ? bySentence.get(currentRecallSentence.id) ?? null : null
  const currentRecallProgress = currentRecallSentence ? progressFor(currentRecallSentence.id) : null

  return {
    open,
    openGolden,
    close,
    view,
    setView,
    doc,
    lesson,
    ordered,
    candidates,
    summary,
    progress,
    progressFor,
    index,
    setIndex,
    current,
    currentSentence,
    targets,
    cloze,
    assembly,
    drillKey,
    phase,
    setPhase,
    fillInputs,
    setFillInputs,
    fillChecked,
    fillCorrect,
    assembleOrder,
    setAssembleOrder,
    assembleChecked,
    recallIndex,
    setRecallIndex,
    recallInput,
    setRecallInput,
    recallChecked,
    recallRevealed,
    currentRecallSentence,
    currentRecallText,
    currentRecallProgress,
    setSelected,
    setPick,
    toggleSentence,
    setDedupe,
    startDrill,
    startRecall,
    nextSentence,
    prevSentence,
    beginFill,
    checkFill,
    beginAssemble,
    checkAssemble,
    markSummary,
    restartSentence,
    checkRecall,
    revealRecall,
    nextRecall,
    restartRecallSentence,
    speakCurrent,
    // 供面板显示“完成/掌握”的小工具
    isMastered: (r: GoldenDrillRecord | null) => !!r && goldenMastered(r),
    isCompleted: (r: GoldenDrillRecord | null) => !!r && goldenCompleted(r),
  }
}
