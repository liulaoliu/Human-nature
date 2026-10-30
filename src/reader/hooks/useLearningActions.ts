import { useCallback, useMemo } from 'react'
import { addActivity, dayKeyLocal, type ActivityCat } from '../../core/activity'
import { addAnswerEvent, createAnswerEvent, type AnswerEventInput } from '../../core/answerEvents'
import type { BackTranslationRecord } from '../../core/backTranslate'
import { addBackTranslationRecord } from '../../core/backTranslate'
import { type GoldenDrillRecord } from '../../core/goldenProgress'
import { type MistakeEntry, removeMistake, upsertMistake } from '../../core/mistakes'
import { addPracticeRecord, type PracticeKind } from '../../core/practice'
import type { StudiedDay } from '../../core/learning'
import type { UseLearningDataParams, LearningCollectionSetters } from './learningDataTypes'

export interface UseLearningActionsParams {
  params: UseLearningDataParams
  studiedDays: StudiedDay[]
  setters: LearningCollectionSetters
}

/**
 * 学习记录的写动作：答题事件 / 金句进度 / 复述 / 略读 / 题型统计 / 背词日 / 错题 / 回译。
 *
 * 只经由 UseLearningCollections 给的 setter 落盘；界面不再自己 wrap setter。
 */
export function useLearningActions({ params, studiedDays, setters }: UseLearningActionsParams) {
  const {
    setActivity,
    setAnswerEvents,
    setBackTranslations,
    setGoldenDrills,
    setKindStats,
    setMistakes,
    setPractice,
    setRetells,
    setSkimmed,
    setStudiedDays,
    setStudyDays,
  } = setters

  const now = params.now

  /** 追加一条答题事件（每题一条；聚合值仍由各自 hook 照常写）。 */
  const recordAnswer = useCallback(
    (event: AnswerEventInput) => {
      setAnswerEvents((prev) => addAnswerEvent(prev, createAnswerEvent(event, now ? now() : new Date())))
    },
    [now, setAnswerEvents],
  )

  /** D老师小课堂：按句写入进度；同一 id 覆盖（hook 里只有一个写入方）。 */
  const recordGolden = useCallback(
    (rec: GoldenDrillRecord) => {
      setGoldenDrills((prev) => {
        const i = prev.findIndex((x) => x.id === rec.id)
        if (i < 0) return [...prev, rec]
        const next = [...prev]
        next[i] = rec
        return next
      })
    },
    [setGoldenDrills],
  )

  /** 记一条复述打卡（空文本 / 没打开文章 → 不记）。 */
  const saveRetell = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t || !params.articleIdentity) return
      const at = (now ? now() : new Date()).toISOString()
      const words = t.split(/\s+/).filter(Boolean).length
      setRetells((prev) =>
        [{ at, articleId: params.articleIdentity as string, text: t, words }, ...prev].slice(0, 200),
      )
      setActivity((prev) => addActivity(prev, dayKeyLocal(now ? now() : new Date()), 'write', 1))
      params.flash('已记录复述 ✅')
    },
    // 只读 `params` 的两个字段（都已列出），不把整个 params 对象放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.articleIdentity, params.flash, now, setRetells, setActivity],
  )

  const deleteRetell = useCallback(
    (at: string) => setRetells((prev) => prev.filter((r) => r.at !== at)),
    [setRetells],
  )

  /** 略读标记：同一篇点一次开、再点关。 */
  const toggleSkimmed = useCallback(() => {
    const id = params.articleIdentity
    if (!id) return
    setSkimmed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [params.articleIdentity, setSkimmed])

  /**
   * 一轮考完 → 按题型累加到**本篇**（每次练习都算，产出看板据此算正确率）。
   * 归属键就是本 hook 的 `articleIdentity`，别再让调用方传一遍。
   */
  const mergeKindStats = useCallback(
    (rows: { kind: string; total: number; correct: number }[]) => {
      const id = params.articleIdentity
      if (!id) return
      setKindStats((prev) => {
        const forArticle = { ...(prev[id] ?? {}) }
        for (const r of rows) {
          const cur = forArticle[r.kind] ?? { total: 0, correct: 0 }
          forArticle[r.kind] = { total: cur.total + r.total, correct: cur.correct + r.correct }
        }
        return { ...prev, [id]: forArticle }
      })
    },
    [params.articleIdentity, setKindStats],
  )

  /** 记「今天学过这个词」（每日目标按不同单词计数）：重复点不重复算，只留最近 200 天。 */
  const markStudied = useCallback((itemId: string) => {
    setStudiedDays((prev) => {
      const day = dayKeyLocal()
      const cur = prev.find((d) => d.day === day)
      if (cur) {
        if (cur.ids.includes(itemId)) return prev
        return prev.map((d) => (d.day === day ? { ...d, ids: [...d.ids, itemId] } : d))
      }
      return [...prev, { day, ids: [itemId] }].slice(-200)
    })
  }, [setStudiedDays])

  /** 把背单词时长 / 评分次数累加到「今天」（落盘供统计）。 */
  const studyFlush = useCallback(
    (seconds: number, cards: number) => {
      if (seconds <= 0 && cards <= 0) return
      setStudyDays((prev) => {
        const day = dayKeyLocal()
        const i = prev.findIndex((d) => d.day === day)
        if (i < 0) return [...prev, { day, seconds, cards }]
        const next = [...prev]
        next[i] = { day, seconds: next[i].seconds + seconds, cards: next[i].cards + cards }
        return next
      })
    },
    [setStudyDays],
  )

  /** 今天学过的不同单词 id（每日目标进度）。 */
  const studiedTodayIds = useMemo(() => {
    const t = dayKeyLocal()
    return studiedDays.find((d) => d.day === t)?.ids ?? []
  }, [studiedDays])

  /** 记一笔学习活动（按天 / 分类累计，落盘）。 */
  const recordActivity = useCallback(
    (cat: ActivityCat, n = 1) => {
      if (n <= 0) return
      setActivity((prev) => addActivity(prev, dayKeyLocal(new Date()), cat, n))
    },
    [setActivity],
  )

  /** 记一次练习成绩（考试 / 听写 / 听力理解）。 */
  const recordPractice = useCallback(
    (kind: PracticeKind, total: number, correct: number) => {
      if (total <= 0) return
      setPractice((prev) =>
        addPracticeRecord(prev, {
          at: new Date().toISOString(),
          kind,
          total,
          correct,
          articleId: params.articleIdentity || undefined,
        }),
      )
    },
    [params.articleIdentity, setPractice],
  )

  const addMistake = useCallback(
    (entry: MistakeEntry) => {
      setMistakes((prev) => upsertMistake(prev, entry))
    },
    [setMistakes],
  )

  const dropMistake = useCallback(
    (id: string) => {
      setMistakes((prev) => removeMistake(prev, id))
    },
    [setMistakes],
  )

  /** 回译批改存档：只追加、不截断（长期学习资产）。 */
  const saveBackTranslation = useCallback(
    (rec: BackTranslationRecord) => {
      setBackTranslations((prev) => addBackTranslationRecord(prev, rec))
    },
    [setBackTranslations],
  )

  return {
    recordAnswer,
    recordGolden,
    saveRetell,
    deleteRetell,
    toggleSkimmed,
    mergeKindStats,
    markStudied,
    studyFlush,
    studiedTodayIds,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
    saveBackTranslation,
  }
}
