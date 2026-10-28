import { describe, expect, it, vi } from 'vitest'
import { vocabItem } from '../../core/testFixtures'
import { toStudyPanelModel, type StudyPanelFromModelProps } from './StudyPanelFromModel'
import type { useStudySession } from '../hooks/useStudySession'

const card = vocabItem({ id: 'v1', word: 'run', lemma: 'run', meaning: '跑' })

function api(over: Record<string, unknown> = {}): ReturnType<typeof useStudySession> {
  const noop = vi.fn()
  return {
    card,
    queue: [card],
    roundTotal: 10,
    extraCount: 2,
    index: 3,
    mode: 'review',
    deck: 'collocation',
    scope: 'lapses',
    counts: { know: 1, fuzzy: 2, forgot: 3 },
    cardSeconds: 11,
    liveSeconds: 62,
    forgotCount: 3,
    canRetryForgot: false,
    spelling: true,
    newCount: 5,
    dueCount: 6,
    groupSize: 10,
    drillAfter: 30,
    revealed: true,
    checked: true,
    input: 'ru',
    drillReason: 'timeout',
    meaningGate: true,
    learnPhase: true,
    learnReveal: { correct: 0, wrong: null, auto: false },
    learnGraded: true,
    reviewKeys: true,
    reviewFuzzy: true,
    reviewGraded: true,
    relearning: true,
    spellMiss: { input: 'ran', word: 'run', meaning: '跑', requeued: true },
    roundTest: { index: 1, total: 5 },
    roundMiss: { typed: 'ran', word: 'run', meaning: '跑' },
    roundInput: 'run',
    navLocked: true,
    editOpen: true,
    draft: { word: 'run', phonetic: '', partOfSpeech: '', meaning: '跑', definition: '', usage: '', phrases: '', idioms: '', grammarMarks: '' },
    delArmed: true,
    gradeInfo: '预计下次',
    close: noop,
    switchMode: noop,
    switchDeck: noop,
    switchScope: noop,
    startArticleAll: noop,
    setDrillAfter: noop,
    changeSpelling: noop,
    setGroupSize: noop,
    setRevealed: noop,
    setInput: noop,
    checkSpelling: noop,
    openEdit: noop,
    removeCard: noop,
    setDraft: noop,
    saveEdit: noop,
    cancelEdit: noop,
    grade: noop,
    back: noop,
    forward: noop,
    markUnknown: noop,
    clearDrill: noop,
    clearMeaningGate: noop,
    onRoundInputChange: noop,
    onRoundCheck: noop,
    revealLearnAnswer: noop,
    answerLearn: noop,
    continueLearn: noop,
    answerReview: noop,
    chooseReview: noop,
    ackSpellMiss: noop,
    applySpellingMiss: noop,
    retryForgot: noop,
    start: noop,
    ...over,
  } as unknown as ReturnType<typeof useStudySession>
}

function props(over: Record<string, unknown> = {}): StudyPanelFromModelProps {
  return {
    study: {
      api: api(over.api as Record<string, unknown> | undefined),
      grandSeconds: 100,
      newLimit: 20,
      newToday: 1,
      onNewLimitChange: vi.fn(),
    },
    items: [card],
    speak: vi.fn(),
    onExam: vi.fn(),
  }
}

describe('StudyPanelFromModel：唯一翻译层', () => {
  it('把会话字段按 round / settings / cardUi / modes / edit 分组', () => {
    const model = toStudyPanelModel(props())

    expect(model.round.card).toBe(card)
    expect(model.round.items).toEqual([card])
    expect(model.round.queueLength).toBe(1)
    expect(model.round.index).toBe(3)
    expect(model.round.mode).toBe('review')
    expect(model.round.grandSeconds).toBe(100)

    expect(model.settings.spelling).toBe(true)
    expect(model.settings.groupSize).toBe(10)
    expect(model.settings.newLimit).toBe(20)
    expect(model.settings.newToday).toBe(1)

    expect(model.cardUi).toEqual({ revealed: true, checked: true, input: 'ru' })
    expect(model.modes.spellMiss?.word).toBe('run')
    expect(model.modes.roundTest).toEqual({ index: 1, total: 5 })
    expect(model.modes.navLocked).toBe(true)
    expect(model.edit.gradeInfo).toBe('预计下次')
  })

  it('动作保持原函数身份；onReveal 包成无参动作', () => {
    const base = api()
    const onExam = vi.fn()
    const onNewLimitChange = vi.fn()
    const speak = vi.fn()
    const model = toStudyPanelModel({
      study: { api: base, grandSeconds: 0, newLimit: 10, newToday: 0, onNewLimitChange },
      items: [card],
      speak,
      onExam,
    })

    expect(model.actions.onClose).toBe(base.close)
    expect(model.actions.onSpellingChange).toBe(base.changeSpelling)
    expect(model.actions.onLearnPick).toBe(base.answerLearn)
    expect(model.actions.onReviewChoice).toBe(base.chooseReview)
    expect(model.actions.onNewLimitChange).toBe(onNewLimitChange)
    expect(model.actions.onSpeak).toBe(speak)
    expect(model.actions.onExam).toBe(onExam)

    model.actions.onReveal()
    expect(base.setRevealed).toHaveBeenCalledWith(true)
  })
})
