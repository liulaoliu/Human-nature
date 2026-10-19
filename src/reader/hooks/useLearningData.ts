import { useMemo } from 'react'
import type { DayActivity } from '../../core/activity'
import type { KindStats, RetellRecord, StudiedDay } from '../../core/learning'
import type { MistakeEntry } from '../../core/mistakes'
import type { PracticeRecord } from '../../core/practice'
import type { PickSession, StudyDay } from '../../core/vocabStats'
import { useLocalStorageState } from './useLocalStorageState'
import { useReadDone } from './useReadDone'

/**
 * 学习记录状态的**唯一收口**（#2 第①步）：
 * 练习 / 错题 / 活动 / 背词日 / 每日学词 / 题型统计 / 复述 / 选词会话 / 略读 /
 * 读完记录 / 阅读目标 / 目标备忘。
 *
 * 它们之前散在 `ReaderApp` 里 20 多个 `useState`/`useLocalStorageState`，导出、
 * 合并、统计各自接线，改一个字段要动好几处。现在：
 *   - 全部落盘键集中在 `LEARNING_KEYS`（learningState.ts）；
 *   - `data` 是导出/备份要的一份快照；`setters` 是合并导入要的一组动作；
 *   - 界面仍拿到同名扁平字段，行为不变。
 */
export interface UseLearningDataParams {
  articleIdentity: string | null
  articleTitle: string
  articleKey: string | null
  todayKey: string
  flash: (msg: string) => void
}

export function useLearningData(params: UseLearningDataParams) {
  const [studyDays, setStudyDays] = useLocalStorageState<StudyDay[]>('reader:studyStats', [])
  const [studiedDays, setStudiedDays] = useLocalStorageState<StudiedDay[]>('reader:studiedToday', [], {
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
  const [activity, setActivity] = useLocalStorageState<DayActivity[]>('reader:activity', [])
  const [practice, setPractice] = useLocalStorageState<PracticeRecord[]>('reader:practice', [])
  const [mistakes, setMistakes] = useLocalStorageState<MistakeEntry[]>('reader:mistakes', [])
  const [kindStats, setKindStats] = useLocalStorageState<KindStats>('reader:kindStats', {})
  const [retells, setRetells] = useLocalStorageState<RetellRecord[]>('reader:retells', [])
  const [sessions, setSessions] = useLocalStorageState<PickSession[]>('reader:vocabStats', [])
  const [skimmedArticles, setSkimmedArticles] = useLocalStorageState<string[]>('reader:intensiveSkimmed', [])
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
      setRetells,
      setReadDone,
      setReadGoal,
      setGoalMemo,
    ],
  )

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
    // 导出 / 合并导入用
    data,
    setters,
  }
}
