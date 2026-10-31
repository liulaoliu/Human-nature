import type { Dispatch, SetStateAction } from 'react'
import type { DayActivity } from '../../core/activity'
import type { AnswerEvent } from '../../core/answerEvents'
import type { BackTranslationRecord } from '../../core/backTranslate'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { ReadDone } from '../../core/goals'
import type { KindStats, RetellRecord, StudiedDay } from '../../core/learning'
import type { MistakeEntry } from '../../core/mistakes'
import type { PracticeRecord } from '../../core/practice'
import type { PickSession, StudyDay } from '../../core/vocabStats'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'

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
  goldenDrills: GoldenDrillRecord[]
  writingErrorProgress: WritingErrorProgress[]
  backTranslations: BackTranslationRecord[]
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
  setGoldenDrills: (v: GoldenDrillRecord[] | ((prev: GoldenDrillRecord[]) => GoldenDrillRecord[])) => void
  setWritingErrorProgress: (
    v: WritingErrorProgress[] | ((prev: WritingErrorProgress[]) => WritingErrorProgress[]),
  ) => void
  setBackTranslations: (v: BackTranslationRecord[] | ((prev: BackTranslationRecord[]) => BackTranslationRecord[])) => void
  setRetells: (v: RetellRecord[]) => void
  setReadDone: (v: ReadDone[]) => void
  setReadGoal: (v: number) => void
  setGoalMemo: (v: string) => void
}

/** 学习记录快照里由 collections 负责的部分（readDone 单独由 useReadDone 管）。 */
export type LearningCollectionsSnapshot = Omit<LearningCollections, 'readDone'>

/** 合并导入写动作里由 collections 负责的部分（setReadDone 单独由 useReadDone 管）。 */
export type LearningCollectionSetters = {
  setPractice: Dispatch<SetStateAction<PracticeRecord[]>>
  setMistakes: Dispatch<SetStateAction<MistakeEntry[]>>
  setActivity: Dispatch<SetStateAction<DayActivity[]>>
  setStudyDays: Dispatch<SetStateAction<StudyDay[]>>
  setSessions: Dispatch<SetStateAction<PickSession[]>>
  setStudiedDays: Dispatch<SetStateAction<StudiedDay[]>>
  setSkimmed: Dispatch<SetStateAction<string[]>>
  setKindStats: Dispatch<SetStateAction<KindStats>>
  setAnswerEvents: Dispatch<SetStateAction<AnswerEvent[]>>
  setGoldenDrills: Dispatch<SetStateAction<GoldenDrillRecord[]>>
  setWritingErrorProgress: Dispatch<SetStateAction<WritingErrorProgress[]>>
  setBackTranslations: Dispatch<SetStateAction<BackTranslationRecord[]>>
  setRetells: Dispatch<SetStateAction<RetellRecord[]>>
  setReadGoal: Dispatch<SetStateAction<number>>
  setGoalMemo: Dispatch<SetStateAction<string>>
}
