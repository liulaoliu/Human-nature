import type { VocabItem } from '../../types/document'
import type { useStudySession } from '../hooks/useStudySession'
import StudyPanel from './StudyPanel'
import type { StudyPanelModel } from './studyPanelModel'

export interface StudyPanelFromModelProps {
  study: {
    api: ReturnType<typeof useStudySession>
    /** 本会话累计时长 = 已落盘 + 未落盘。 */
    grandSeconds: number
    newLimit: number
    newToday: number
    onNewLimitChange: (n: number) => void
  }
  items: VocabItem[]
  speak: (word: string) => void
  onExam: () => void
}

/**
 * 背单词面板的唯一翻译层：会话 hook + 外部动作 → 视图模型。
 *
 * 这样 `StudyPanel` 不用认识 `useStudySession` 的 80 个字段，
 * `SessionHost` 也不再铺 80 行 props。规则仍留在 hook，这里只做映射。
 */
export function toStudyPanelModel({ study, items, speak, onExam }: StudyPanelFromModelProps): StudyPanelModel {
  const api = study.api
  return {
    round: {
      card: api.card,
      items,
      queueLength: api.queue?.length ?? 0,
      roundTotal: api.roundTotal,
      extraCount: api.extraCount,
      index: api.index,
      mode: api.mode,
      deck: api.deck,
      scope: api.scope,
      counts: api.counts,
      cardSeconds: api.cardSeconds,
      liveSeconds: api.liveSeconds,
      grandSeconds: study.grandSeconds,
      forgotCount: api.forgotCount,
      canRetryForgot: api.canRetryForgot,
    },
    settings: {
      spelling: api.spelling,
      newCount: api.newCount,
      dueCount: api.dueCount,
      newLimit: study.newLimit,
      newToday: study.newToday,
      groupSize: api.groupSize,
      drillAfter: api.drillAfter,
    },
    cardUi: {
      revealed: api.revealed,
      checked: api.checked,
      input: api.input,
    },
    modes: {
      drillReason: api.drillReason,
      meaningGate: api.meaningGate,
      learnPhase: api.learnPhase,
      learnReveal: api.learnReveal,
      learnGraded: api.learnGraded,
      reviewKeys: api.reviewKeys,
      reviewFuzzy: api.reviewFuzzy,
      reviewGraded: api.reviewGraded,
      relearning: api.relearning,
      spellMiss: api.spellMiss,
      roundTest: api.roundTest,
      roundMiss: api.roundMiss,
      roundInput: api.roundInput,
      navLocked: api.navLocked,
    },
    edit: {
      editOpen: api.editOpen,
      draft: api.draft,
      delArmed: api.delArmed,
      gradeInfo: api.gradeInfo,
    },
    actions: {
      onClose: api.close,
      onExam,
      onSwitchMode: api.switchMode,
      onSwitchDeck: api.switchDeck,
      onSwitchScope: api.switchScope,
      onStartArticleAll: api.startArticleAll,
      onNewLimitChange: study.onNewLimitChange,
      onDrillAfterChange: api.setDrillAfter,
      onSpellingChange: api.changeSpelling,
      onGroupSizeChange: api.setGroupSize,
      onReveal: () => api.setRevealed(true),
      onInputChange: api.setInput,
      onCheckSpelling: api.checkSpelling,
      onSpeak: speak,
      onOpenEdit: api.openEdit,
      onDelete: api.removeCard,
      onDraftChange: api.setDraft,
      onSaveEdit: api.saveEdit,
      onCancelEdit: api.cancelEdit,
      onGrade: api.grade,
      onBack: api.back,
      onNext: api.forward,
      onMarkUnknown: api.markUnknown,
      onDrillCleared: api.clearDrill,
      onMeaningCleared: api.clearMeaningGate,
      onRoundInputChange: api.onRoundInputChange,
      onRoundCheck: api.onRoundCheck,
      onLearnReveal: api.revealLearnAnswer,
      onLearnPick: api.answerLearn,
      onLearnContinue: api.continueLearn,
      onReviewAnswer: api.answerReview,
      onReviewChoice: api.chooseReview,
      onAckSpellMiss: api.ackSpellMiss,
      onSpellMiss: api.applySpellingMiss,
      onRetryForgot: api.retryForgot,
      onRestart: api.start,
    },
  }
}

export default function StudyPanelFromModel(props: StudyPanelFromModelProps) {
  return <StudyPanel model={toStudyPanelModel(props)} />
}
