import { useCallback, useMemo } from 'react'
import { addActivity, dayKeyLocal, type ActivityCat, type DayActivity } from '../../core/activity'
import type { KindStats, RetellRecord, StudiedDay } from '../../core/learning'
import { LEARNING_KEYS } from '../../core/learning'
import type { AnswerEvent, AnswerEventInput } from '../../core/answerEvents'
import { addAnswerEvent, createAnswerEvent, normalizeAnswerEvents } from '../../core/answerEvents'
import type { ReadDone } from '../../core/goals'
import { removeMistake, upsertMistake, type MistakeEntry } from '../../core/mistakes'
import { addPracticeRecord, type PracticeKind, type PracticeRecord } from '../../core/practice'
import type { PickSession, StudyDay } from '../../core/vocabStats'
import { useLocalStorageState } from './useLocalStorageState'
import { useReadDone } from './useReadDone'
import { useLearningRebuild } from './useLearningRebuild'

/**
 * 学习记录状态的**唯一收口**（#2 第①步）：
 * 练习 / 错题 / 活动 / 背词日 / 每日学词 / 题型统计 / 复述 / 选词会话 / 略读 /
 * 读完记录 / 阅读目标 / 目标备忘。
 *
 * 它们之前散在 `ReaderApp` 里 20 多个 `useState`/`useLocalStorageState`，导出、
 * 合并、统计各自接线，改一个字段要动好几处。现在：
 *   - 全部落盘键集中在 `core/learning.ts` 的 `LEARNING_KEYS`；
 *   - `data` 是导出/备份要的一份快照；`setters` 是合并导入要的一组动作；
 *   - 界面仍拿到同名扁平字段，行为不变。
 */
export interface UseLearningDataParams {
  articleIdentity: string | null
  articleTitle: string
  articleKey: string | null
  todayKey: string
  flash: (msg: string) => void
  /** 测试注入固定时间；默认取当前时间 */
  now?: () => Date
}

/** 导出/备份用的一份学习记录快照。 */
export interface LearningCollections {
  practice: PracticeRecord[]
  mistakes: MistakeEntry[]
  activity: DayActivity[]
  studyDays: StudyDay[]
  sessions: PickSession[]
  studiedDays: StudiedDay[]
  skimmed: string[]
  kindStats: KindStats
  answerEvents: AnswerEvent[]
  retells: RetellRecord[]
  readDone: ReadDone[]
  readGoal: number
  goalMemo: string
}

/** 合并导入用的一组写动作（与 LearningCollections 同名）。 */
export interface LearningSetters {
  setPractice: (v: PracticeRecord[]) => void
  setMistakes: (v: MistakeEntry[]) => void
  setActivity: (v: DayActivity[]) => void
  setStudyDays: (v: StudyDay[]) => void
  setSessions: (v: PickSession[]) => void
  setStudiedDays: (v: StudiedDay[]) => void
  setSkimmed: (v: string[]) => void
  setKindStats: (v: KindStats) => void
  setAnswerEvents: (v: AnswerEvent[]) => void
  setRetells: (v: RetellRecord[]) => void
  setReadDone: (v: ReadDone[]) => void
  setReadGoal: (v: number) => void
  setGoalMemo: (v: string) => void
}

export function useLearningData(params: UseLearningDataParams) {
  const [studyDays, setStudyDays] = useLocalStorageState<StudyDay[]>(LEARNING_KEYS.studyDays, [])
  const [studiedDays, setStudiedDays] = useLocalStorageState<StudiedDay[]>(LEARNING_KEYS.studiedDays, [], {
    parse: (raw) => {
      try {
        const v: unknown = JSON.parse(raw)
        const ok = (x: unknown): x is StudiedDay =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { day?: unknown }).day === 'string' &&
          Array.isArray((x as { ids?: unknown }).ids)
        if (Array.isArray(v)) {
          return v.filter(ok).map((x) => ({
            day: x.day,
            ids: x.ids.filter((i): i is string => typeof i === 'string'),
          }))
        }
        // 兼容旧格式（单个 { day, ids } 对象）
        if (ok(v)) return [{ day: v.day, ids: v.ids.filter((i): i is string => typeof i === 'string') }]
      } catch {
        // 忽略
      }
      return []
    },
  })
  const [activity, setActivity] = useLocalStorageState<DayActivity[]>(LEARNING_KEYS.activity, [])
  const [practice, setPractice] = useLocalStorageState<PracticeRecord[]>(LEARNING_KEYS.practice, [])
  const [mistakes, setMistakes] = useLocalStorageState<MistakeEntry[]>(LEARNING_KEYS.mistakes, [])
  const [kindStats, setKindStats] = useLocalStorageState<KindStats>(LEARNING_KEYS.kindStats, {})
  const [answerEvents, setAnswerEvents] = useLocalStorageState<AnswerEvent[]>(LEARNING_KEYS.answerEvents, [], {
    parse: (raw) => {
      try {
        return normalizeAnswerEvents(JSON.parse(raw))
      } catch {
        return []
      }
    },
  })
  const [retells, setRetells] = useLocalStorageState<RetellRecord[]>(LEARNING_KEYS.retells, [])
  const [sessions, setSessions] = useLocalStorageState<PickSession[]>(LEARNING_KEYS.sessions, [])
  const [skimmedArticles, setSkimmedArticles] = useLocalStorageState<string[]>(LEARNING_KEYS.skimmed, [])
  const [readGoal, setReadGoal] = useLocalStorageState('reader:readGoal', 2, {
    parse: (raw) => {
      const n = Number(raw)
      return Number.isFinite(n) && n >= 0 ? n : 2
    },
    serialize: (value) => String(value),
  })
  const [goalMemo, setGoalMemo] = useLocalStorageState('reader:goalMemo', '', {
    parse: (raw) => raw,
    serialize: (value) => value,
  })

  const now = params.now

  /** 追加一条答题事件（每题一条；聚合值仍由各自 hook 照常写）。 */
  const recordAnswer = useCallback(
    (event: AnswerEventInput) => {
      setAnswerEvents((prev) => addAnswerEvent(prev, createAnswerEvent(event, now ? now() : new Date())))
    },
    [now, setAnswerEvents],
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
    setSkimmedArticles((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [params.articleIdentity, setSkimmedArticles])

  const {
    readDone,
    setReadDone,
    todayReadDone,
    articleReadDay,
    readDays,
    markReadDone,
    undoReadDone,
  } = useReadDone(params)

  const data = useMemo(
    () => ({
      practice,
      mistakes,
      activity,
      studyDays,
      sessions,
      studiedDays,
      skimmed: skimmedArticles,
      kindStats,
      answerEvents,
      retells,
      readDone,
      readGoal,
      goalMemo,
    }),
    [
      practice,
      mistakes,
      activity,
      studyDays,
      sessions,
      studiedDays,
      skimmedArticles,
      kindStats,
      answerEvents,
      retells,
      readDone,
      readGoal,
      goalMemo,
    ],
  )

  const setters = useMemo(
    () => ({
      setPractice,
      setMistakes,
      setActivity,
      setStudyDays,
      setSessions,
      setStudiedDays,
      setSkimmed: setSkimmedArticles,
      setKindStats,
      setAnswerEvents,
      setRetells,
      setReadDone,
      setReadGoal,
      setGoalMemo,
    }),
    [
      setPractice,
      setMistakes,
      setActivity,
      setStudyDays,
      setSessions,
      setStudiedDays,
      setSkimmedArticles,
      setKindStats,
      setAnswerEvents,
      setRetells,
      setReadDone,
      setReadGoal,
      setGoalMemo,
    ],
  )

  /** 重建派生 + 对账：属于学习记录域（读的是这份记录），所以挂在这个收口里，别在视图再开一个。 */
  const rebuild = useLearningRebuild({ flash: params.flash })

  // ---- 写入动作（原来在 ReaderApp 里 wrap 一遍 setter，现在跟着数据一起住这儿）----

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
  }, [])

  /** 把背单词时长 / 评分次数累加到「今天」（落盘供统计）。 */
  const studyFlush = useCallback((seconds: number, cards: number) => {
    if (seconds <= 0 && cards <= 0) return
    setStudyDays((prev) => {
      const day = dayKeyLocal()
      const i = prev.findIndex((d) => d.day === day)
      if (i < 0) return [...prev, { day, seconds, cards }]
      const next = [...prev]
      next[i] = { day, seconds: next[i].seconds + seconds, cards: next[i].cards + cards }
      return next
    })
  }, [])

  /** 今天学过的不同单词 id（每日目标进度）。 */
  const studiedTodayIds = useMemo(() => {
    const t = dayKeyLocal()
    return studiedDays.find((d) => d.day === t)?.ids ?? []
  }, [studiedDays])

  /** 记一笔学习活动（按天 / 分类累计，落盘）。 */
  const recordActivity = useCallback((cat: ActivityCat, n = 1) => {
    if (n <= 0) return
    setActivity((prev) => addActivity(prev, dayKeyLocal(new Date()), cat, n))
  }, [])

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
    [params.articleIdentity],
  )

  const addMistake = useCallback((entry: MistakeEntry) => {
    setMistakes((prev) => upsertMistake(prev, entry))
  }, [])

  const dropMistake = useCallback((id: string) => {
    setMistakes((prev) => removeMistake(prev, id))
  }, [])

  return {
    // 扁平字段：界面沿用旧名字，减少一次性改动面
    studyDays,
    setStudyDays,
    studiedDays,
    setStudiedDays,
    activity,
    setActivity,
    practice,
    setPractice,
    mistakes,
    setMistakes,
    kindStats,
    setKindStats,
    answerEvents,
    setAnswerEvents,
    recordAnswer,
    retells,
    setRetells,
    sessions,
    setSessions,
    skimmedArticles,
    setSkimmedArticles,
    readGoal,
    setReadGoal,
    goalMemo,
    setGoalMemo,
    readDone,
    setReadDone,
    todayReadDone,
    articleReadDay,
    readDays,
    markReadDone,
    undoReadDone,
    saveRetell,
    deleteRetell,
    toggleSkimmed,
    // 导出 / 合并导入用
    data,
    setters,
    // 统计页「重建并核对」：服务端用答题事件重算派生，再与本地对账（只读，不写本地）
    rebuild,
    // 写入动作：界面直接调这些，别再自己 wrap setter
    markStudied,
    studyFlush,
    studiedTodayIds,
    recordActivity,
    recordPractice,
    mergeKindStats,
    addMistake,
    dropMistake,
  }
}
