import { useMemo } from 'react'
import type { DayActivity } from '../../core/activity'
import type { AnswerEvent } from '../../core/answerEvents'
import { normalizeAnswerEvents } from '../../core/answerEvents'
import type { BackTranslationRecord } from '../../core/backTranslate'
import { normalizeBackTranslationRecords } from '../../core/backTranslate'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import { normalizeGoldenDrills } from '../../core/goldenProgress'
import { LEARNING_KEYS, normalizeLearningSection } from '../../core/learning'
import type { KindStats, LearningData, LearningSection, RetellRecord, StudiedDay } from '../../core/learning'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import { normalizeWritingErrorProgress } from '../../core/writingErrorProgress'
import { normalizeProductionProgress } from '../../core/productionHistory'
import type { MistakeEntry } from '../../core/mistakes'
import type { PracticeRecord } from '../../core/practice'
import type { PickSession, StudyDay } from '../../core/vocabStats'
import type { LearningCollectionSetters, LearningCollectionsSnapshot } from './learningDataTypes'
import { useLocalStorageState } from './useLocalStorageState'

/** 每个 section 一个 key：坏 JSON / 坏形状都在这里回到空值，业务只收好数据。 */
function parseSection<K extends LearningSection>(key: K) {
  return (raw: string): LearningData[K] => {
    try {
      return normalizeLearningSection(key, JSON.parse(raw))
    } catch {
      return normalizeLearningSection(key, null)
    }
  }
}

/**
 * 学习记录的落盘层：每个集合一个 localStorage 键，解析守卫也在这里。
 * 只提供状态和 setter；写业务动作在 useLearningActions。
 */
export function useLearningCollections() {
  const [studyDays, setStudyDays] = useLocalStorageState<StudyDay[]>(LEARNING_KEYS.studyDays, [], {
    parse: parseSection('studyDays'),
  })
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
  const [activity, setActivity] = useLocalStorageState<DayActivity[]>(LEARNING_KEYS.activity, [], {
    parse: parseSection('activity'),
  })
  const [practice, setPractice] = useLocalStorageState<PracticeRecord[]>(LEARNING_KEYS.practice, [], {
    parse: parseSection('practice'),
  })
  const [mistakes, setMistakes] = useLocalStorageState<MistakeEntry[]>(LEARNING_KEYS.mistakes, [], {
    parse: parseSection('mistakes'),
  })
  const [kindStats, setKindStats] = useLocalStorageState<KindStats>(LEARNING_KEYS.kindStats, {}, {
    parse: parseSection('kindStats'),
  })
  const [answerEvents, setAnswerEvents] = useLocalStorageState<AnswerEvent[]>(LEARNING_KEYS.answerEvents, [], {
    parse: (raw) => {
      try {
        return normalizeAnswerEvents(JSON.parse(raw))
      } catch {
        return []
      }
    },
  })
  const [goldenDrills, setGoldenDrills] = useLocalStorageState<GoldenDrillRecord[]>(LEARNING_KEYS.goldenDrills, [], {
    parse: (raw) => {
      try {
        return normalizeGoldenDrills(JSON.parse(raw))
      } catch {
        return []
      }
    },
  })
  const [writingErrorProgress, setWritingErrorProgress] = useLocalStorageState<WritingErrorProgress[]>(
    LEARNING_KEYS.writingErrorProgress,
    [],
    {
      parse: (raw) => {
        try {
          return normalizeWritingErrorProgress(JSON.parse(raw))
        } catch {
          return []
        }
      },
    },
  )
  const [productionProgress, setProductionProgress] = useLocalStorageState<ReturnType<typeof normalizeProductionProgress>>(
    LEARNING_KEYS.productionProgress,
    [],
    {
      parse: (raw) => {
        try {
          return normalizeProductionProgress(JSON.parse(raw))
        } catch {
          return []
        }
      },
    },
  )
  const [retells, setRetells] = useLocalStorageState<RetellRecord[]>(LEARNING_KEYS.retells, [], {
    parse: parseSection('retells'),
  })
  const [backTranslations, setBackTranslations] = useLocalStorageState<BackTranslationRecord[]>(
    LEARNING_KEYS.backTranslations,
    [],
    {
      parse: (raw) => {
        try {
          return normalizeBackTranslationRecords(JSON.parse(raw))
        } catch {
          return []
        }
      },
    },
  )
  const [sessions, setSessions] = useLocalStorageState<PickSession[]>(LEARNING_KEYS.sessions, [], {
    parse: parseSection('sessions'),
  })
  const [skimmedArticles, setSkimmedArticles] = useLocalStorageState<string[]>(LEARNING_KEYS.skimmed, [], {
    parse: parseSection('skimmed'),
  })
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

  const snapshot = useMemo<LearningCollectionsSnapshot>(
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
      goldenDrills,
      writingErrorProgress,
      productionProgress,
      backTranslations,
      retells,
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
      goldenDrills,
      writingErrorProgress,
      productionProgress,
      backTranslations,
      retells,
      readGoal,
      goalMemo,
    ],
  )

  const setters = useMemo<LearningCollectionSetters>(
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
      setGoldenDrills,
      setWritingErrorProgress,
      setProductionProgress,
      setBackTranslations,
      setRetells,
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
      setGoldenDrills,
      setWritingErrorProgress,
      setProductionProgress,
      setBackTranslations,
      setRetells,
      setReadGoal,
      setGoalMemo,
    ],
  )

  return {
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
    goldenDrills,
    setGoldenDrills,
    writingErrorProgress,
    setWritingErrorProgress,
    productionProgress,
    setProductionProgress,
    retells,
    setRetells,
    backTranslations,
    setBackTranslations,
    sessions,
    setSessions,
    skimmedArticles,
    setSkimmedArticles,
    readGoal,
    setReadGoal,
    goalMemo,
    setGoalMemo,
    snapshot,
    setters,
  }
}
