import type { useGoldenDrill } from '../../hooks/useGoldenDrill'
import type { useGoldenExam } from '../../hooks/useGoldenExam'
import type { useGoldenImitation } from '../../hooks/useGoldenImitation'
import type { GoldenBankRow } from '../../../core/goldenBank'
import type { GoldenDrillRecord } from '../../../core/goldenProgress'

export type GoldenExamApi = ReturnType<typeof useGoldenExam>
export type GoldenImitationApi = ReturnType<typeof useGoldenImitation>

/** 金句课总控；面板壳只拿这个类型，子视图各自再收窄。 */
export type GoldenApi = ReturnType<typeof useGoldenDrill>

export type GoldenHomeApi = Pick<
  GoldenApi,
  | 'lesson'
  | 'summary'
  | 'ordered'
  | 'progressFor'
  | 'startDrill'
  | 'startRecall'
  | 'setView'
  | 'reviewCount'
  | 'startReview'
  | 'doc'
>

export type GoldenPlanApi = Pick<
  GoldenApi,
  | 'lesson'
  | 'doc'
  | 'candidates'
  | 'setPick'
  | 'setDedupe'
  | 'setBlankUnit'
  | 'setSentenceFill'
  | 'setExamAfter'
  | 'toggleSentence'
  | 'setView'
  | 'startDrill'
>

export type GoldenDrillApi = Pick<
  GoldenApi,
  | 'current'
  | 'currentSentence'
  | 'phase'
  | 'setView'
  | 'index'
  | 'ordered'
  | 'speakCurrent'
  | 'restartSentence'
  | 'beginFill'
  | 'nextSentence'
  | 'markSummary'
  | 'cloze'
  | 'fillInputs'
  | 'setFillInputs'
  | 'checkFill'
  | 'fillCorrect'
  | 'fillChecked'
  | 'fillRound'
  | 'fillRoundCount'
  | 'fillRoundPassed'
  | 'nextFillRound'
  | 'setPhase'
  | 'beginAssemble'
  | 'assembly'
  | 'assembleOrder'
  | 'setAssembleOrder'
  | 'checkAssemble'
  | 'assembleChecked'
>

export type GoldenSentenceLineApi = Pick<GoldenDrillApi, 'assembly' | 'assembleOrder' | 'setAssembleOrder'>

export type GoldenRecallApi = Pick<
  GoldenApi,
  | 'currentRecallSentence'
  | 'currentRecallText'
  | 'currentRecallProgress'
  | 'setView'
  | 'reviewMode'
  | 'recallIndex'
  | 'recallList'
  | 'restartRecallSentence'
  | 'recallInput'
  | 'setRecallInput'
  | 'checkRecall'
  | 'revealRecall'
  | 'nextRecall'
  | 'recallChecked'
  | 'recallRevealed'
>

export type GoldenSummaryApi = Pick<GoldenApi, 'lesson' | 'summary' | 'setView' | 'doc' | 'progressFor'>

export interface GoldenBankActions {
  rows: GoldenBankRow[]
  onExportMarkdown?: () => void
  onExportAnki?: () => void
  onPrint?: () => void
}

export interface GoldenBankViewProps {
  rows: GoldenBankRow[]
  onBack: () => void
  onExportMarkdown?: () => void
  onExportAnki?: () => void
  onPrint?: () => void
}

export type GoldenRecordLike = Pick<GoldenDrillRecord, 'mastered'>
