import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import {
  buildLocalGoldenLesson,
  dedupeGoldenLesson,
  goldenDrillKey,
  goldenTargetsFor,
  pickGoldenCandidates,
  rankGoldenCandidates,
  type GoldenCandidate,
  type GoldenTextMeta,
} from '../../core/golden'
import {
  findGoldenRecord,
  summarizeGolden,
  type GoldenDrillRecord,
} from '../../core/goldenProgress'
import type { GoldenLesson, GoldenPickMode, GoldenSentence, Sentence } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'

interface UseGoldenLessonParams {
  doc: ReaderDoc | null
  articleId: string
  records: GoldenDrillRecord[]
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
  flash: (message: string) => void
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
 * 金句课的内容 / 选句：本地推导、候选、统计、进度查询和写回。
 *
 * 这里不碰会话视图和练习输入；状态机留在 useGoldenDrill。
 */
export function useGoldenLesson({
  doc,
  articleId,
  records,
  setDoc,
  setPendingSave,
  flash,
}: UseGoldenLessonParams) {
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
      return findGoldenRecord(records, articleId, sentenceId, goldenDrillKey(sentence.text, t))
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

  const setBlankUnit = useCallback(
    (blankUnit: 'word' | 'target') => {
      if (!lesson) return
      persistLesson({ ...lesson, options: { ...lesson.options, blankUnit } })
    },
    [lesson, persistLesson],
  )

  const setSentenceFill = useCallback(
    (sentenceFill: boolean) => {
      if (!lesson) return
      persistLesson({ ...lesson, options: { ...lesson.options, sentenceFill } })
    },
    [lesson, persistLesson],
  )

  const setExamAfter = useCallback(
    (examAfter: 5 | 10) => {
      if (!lesson) return
      persistLesson({ ...lesson, options: { ...lesson.options, examAfter } })
    },
    [lesson, persistLesson],
  )

  return {
    lesson,
    ordered,
    bySentence,
    candidates,
    summary,
    progressFor,
    setSelected,
    setPick,
    toggleSentence,
    setDedupe,
    setBlankUnit,
    setSentenceFill,
    setExamAfter,
  }
}
