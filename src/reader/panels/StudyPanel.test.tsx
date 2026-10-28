// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import StudyPanel from './StudyPanel'
import type { StudyPanelFlat, StudyPanelModel } from './studyPanelModel'

const card = vocabItem({
  id: 'v1',
  word: 'run',
  lemma: 'run',
  phonetic: '/rʌn/',
  partOfSpeech: 'v.',
  meaning: '跑',
  usage: ['run a business'],
  reviewState: { ease: 2.5, due: '2026-10-21T00:00:00.000Z', interval: 1, repetitions: 2, lapses: 1 },
})

function panelModel(over: Partial<StudyPanelFlat> = {}): StudyPanelModel {
  const noop = vi.fn()
  const p: StudyPanelFlat = {
    card,
    items: [card],
    queueLength: 10,
    roundTotal: 10,
    extraCount: 0,
    index: 0,
    mode: 'learn',
    deck: 'word',
    scope: 'article',
    spelling: false,
    revealed: false,
    checked: false,
    input: '',
    counts: { know: 0, fuzzy: 0, forgot: 0 },
    cardSeconds: 0,
    liveSeconds: 60,
    grandSeconds: 3600,
    newCount: 3,
    dueCount: 4,
    newLimit: 20,
    newToday: 1,
    gradeInfo: '',
    editOpen: false,
    draft: null,
    delArmed: false,
    forgotCount: 0,
    canRetryForgot: true,
    drillReason: null,
    meaningGate: false,
    learnPhase: false,
    learnReveal: null,
    learnGraded: false,
    onLearnReveal: noop,
    onLearnPick: noop,
    onLearnContinue: noop,
    roundTest: null,
    roundMiss: null,
    roundInput: '',
    onRoundInputChange: noop,
    onRoundCheck: noop,
    groupSize: 0,
    onGroupSizeChange: noop,
    relearning: false,
    spellMiss: null,
    navLocked: false,
    drillAfter: 45,
    onClose: noop,
    onExam: noop,
    onSwitchMode: noop,
    onSwitchDeck: noop,
    onSwitchScope: noop,
    onStartArticleAll: noop,
    onNewLimitChange: noop,
    onDrillAfterChange: noop,
    onSpellingChange: noop,
    onReveal: noop,
    onInputChange: noop,
    onCheckSpelling: noop,
    onSpeak: noop,
    onOpenEdit: noop,
    onDelete: noop,
    onDraftChange: noop,
    onSaveEdit: noop,
    onCancelEdit: noop,
    onGrade: noop,
    onBack: noop,
    onNext: noop,
    onMarkUnknown: noop,
    onDrillCleared: noop,
    onMeaningCleared: noop,
    onAckSpellMiss: noop,
    onSpellMiss: noop,
    reviewKeys: false,
    reviewFuzzy: false,
    reviewGraded: false,
    onReviewAnswer: noop,
    onReviewChoice: noop,
    onRetryForgot: noop,
    onRestart: noop,
    ...over,
  }
  return {
    round: {
      card: p.card,
      items: p.items,
      queueLength: p.queueLength,
      roundTotal: p.roundTotal,
      extraCount: p.extraCount,
      index: p.index,
      mode: p.mode,
      deck: p.deck,
      scope: p.scope,
      counts: p.counts,
      cardSeconds: p.cardSeconds,
      liveSeconds: p.liveSeconds,
      grandSeconds: p.grandSeconds,
      forgotCount: p.forgotCount,
      canRetryForgot: p.canRetryForgot,
    },
    settings: {
      spelling: p.spelling,
      newCount: p.newCount,
      dueCount: p.dueCount,
      newLimit: p.newLimit,
      newToday: p.newToday,
      groupSize: p.groupSize,
      drillAfter: p.drillAfter,
    },
    cardUi: {
      revealed: p.revealed,
      checked: p.checked,
      input: p.input,
    },
    modes: {
      drillReason: p.drillReason,
      meaningGate: p.meaningGate,
      learnPhase: p.learnPhase,
      learnReveal: p.learnReveal,
      learnGraded: p.learnGraded,
      reviewKeys: p.reviewKeys,
      reviewFuzzy: p.reviewFuzzy,
      reviewGraded: p.reviewGraded,
      relearning: p.relearning,
      spellMiss: p.spellMiss,
      roundTest: p.roundTest,
      roundMiss: p.roundMiss,
      roundInput: p.roundInput,
      navLocked: p.navLocked,
    },
    edit: {
      editOpen: p.editOpen,
      draft: p.draft,
      delArmed: p.delArmed,
      gradeInfo: p.gradeInfo,
    },
    actions: {
      onClose: p.onClose,
      onExam: p.onExam,
      onSwitchMode: p.onSwitchMode,
      onSwitchDeck: p.onSwitchDeck,
      onSwitchScope: p.onSwitchScope,
      onStartArticleAll: p.onStartArticleAll,
      onNewLimitChange: p.onNewLimitChange,
      onDrillAfterChange: p.onDrillAfterChange,
      onSpellingChange: p.onSpellingChange,
      onGroupSizeChange: p.onGroupSizeChange,
      onReveal: p.onReveal,
      onInputChange: p.onInputChange,
      onCheckSpelling: p.onCheckSpelling,
      onSpeak: p.onSpeak,
      onOpenEdit: p.onOpenEdit,
      onDelete: p.onDelete,
      onDraftChange: p.onDraftChange,
      onSaveEdit: p.onSaveEdit,
      onCancelEdit: p.onCancelEdit,
      onGrade: p.onGrade,
      onBack: p.onBack,
      onNext: p.onNext,
      onMarkUnknown: p.onMarkUnknown,
      onDrillCleared: p.onDrillCleared,
      onMeaningCleared: p.onMeaningCleared,
      onRoundInputChange: p.onRoundInputChange,
      onRoundCheck: p.onRoundCheck,
      onLearnReveal: p.onLearnReveal,
      onLearnPick: p.onLearnPick,
      onLearnContinue: p.onLearnContinue,
      onReviewAnswer: p.onReviewAnswer,
      onReviewChoice: p.onReviewChoice,
      onAckSpellMiss: p.onAckSpellMiss,
      onSpellMiss: p.onSpellMiss,
      onRetryForgot: p.onRetryForgot,
      onRestart: p.onRestart,
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('StudyPanel：卡片与评分', () => {
  it('挂载时自动朗读一次；拼写模式不读（防剧透）', () => {
    const onSpeak = vi.fn()
    const { rerender } = render(<StudyPanel model={panelModel({ onSpeak })} />)
    expect(onSpeak).toHaveBeenCalledWith('run')

    onSpeak.mockClear()
    rerender(<StudyPanel model={panelModel({ onSpeak, spelling: true })} />)
    expect(onSpeak).not.toHaveBeenCalled()
  })

  it('未揭示：只有「显示释义」；点了才出现评分', () => {
    const onReveal = vi.fn()
    const { rerender } = render(<StudyPanel model={panelModel({ onReveal })} />)
    fireEvent.click(screen.getByRole('button', { name: '显示释义（空格）' }))
    expect(onReveal).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()

    rerender(<StudyPanel model={panelModel({ revealed: true })} />)
    expect(screen.getByText(/复习 2 次/)).toBeTruthy()
  })

  it('揭示后三个评分走 onGrade', () => {
    const onGrade = vi.fn()
    render(<StudyPanel model={panelModel({ revealed: true, onGrade })} />)
    fireEvent.click(screen.getByRole('button', { name: /^认识/ }))
    fireEvent.click(screen.getByRole('button', { name: /模糊/ }))
    fireEvent.click(screen.getByRole('button', { name: /忘记了/ }))
    expect(onGrade.mock.calls.map((c) => c[0])).toEqual(['good', 'hard', 'again'])
  })

  it('拼写模式：输入回车检查，checked 后显示对错并能评分', () => {
    const onCheckSpelling = vi.fn()
    const onInputChange = vi.fn()
    const { rerender } = render(
      <StudyPanel model={panelModel({ spelling: true, onCheckSpelling, onInputChange })} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/拼出这个英文单词/), { target: { value: 'run' } })
    expect(onInputChange).toHaveBeenCalledWith('run')
    fireEvent.keyDown(screen.getByPlaceholderText(/拼出这个英文单词/), { key: 'Enter' })
    expect(onCheckSpelling).toHaveBeenCalled()

    rerender(<StudyPanel model={panelModel({ spelling: true, checked: true, input: 'run', revealed: false })} />)
    expect(screen.getByText('✔ 正确')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^认识/ })).toBeTruthy()

    // 拼错：不再显示评分按钮，改为一屏「判为不认识」的确认
    const onAckSpellMiss = vi.fn()
    rerender(
      <StudyPanel
        model={panelModel({
          spelling: true,
          checked: true,
          input: 'ran',
          spellMiss: { input: 'ran', word: 'run', meaning: '跑', requeued: true },
          navLocked: true,
          onAckSpellMiss,
        })}
      />,
    )
    expect(screen.getByText(/拼写错误/)).toBeTruthy()
    expect(screen.getByText(/判为「不认识」/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()
    expect((screen.getByRole('button', { name: '结束（Esc）' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /从头重学/ }))
    expect(onAckSpellMiss).toHaveBeenCalled()
  })

  it('重学卡不直接考拼写：先看词，揭示释义后强制锤炼', () => {
    const { rerender } = render(<StudyPanel model={panelModel({ spelling: true, relearning: true })} />)
    expect(screen.queryByPlaceholderText(/拼出这个英文单词/)).toBeNull()
    expect(screen.getByText('run')).toBeTruthy()

    rerender(<StudyPanel model={panelModel({ spelling: true, relearning: true, revealed: true, drillReason: 'relearn' })} />)
    expect(screen.getByPlaceholderText('拼出这个英文单词')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()
  })

  it('超时锤炼：隐藏评分按钮，交给 DrillBoard', () => {
    render(<StudyPanel model={panelModel({ revealed: true, drillReason: 'timeout' })} />)
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()
  })

  it('标过不认识的复习卡：先选中文释义，选对才放行评分', () => {
    const onReveal = vi.fn()
    const onMeaningCleared = vi.fn()
    const items = [
      card,
      vocabItem({ id: 'v2', word: 'walk', lemma: 'walk', meaning: '走' }),
      vocabItem({ id: 'v3', word: 'say', lemma: 'say', meaning: '说' }),
      vocabItem({ id: 'v4', word: 'see', lemma: 'see', meaning: '看' }),
    ]
    const { rerender } = render(
      <StudyPanel model={panelModel({ items, meaningGate: true, onReveal, onMeaningCleared })} />,
    )
    expect(screen.getByText('🧠 选中文释义')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /走/ }))
    expect(onMeaningCleared).not.toHaveBeenCalled()
    expect(screen.getByText('✘ 不对，再来一次')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /跑/ }))
    expect(onMeaningCleared).toHaveBeenCalled()
    expect(onReveal).toHaveBeenCalled()

    rerender(<StudyPanel model={panelModel({ items, revealed: true, onReveal, onMeaningCleared })} />)
    expect(screen.getByRole('button', { name: /^认识/ })).toBeTruthy()
  })
})

describe('StudyPanel：维护与本轮小结', () => {
  it('编辑/删除入口；两步删除第二下变成确认', () => {
    const onOpenEdit = vi.fn()
    const onDelete = vi.fn()
    const { rerender } = render(<StudyPanel model={panelModel({ onOpenEdit, onDelete })} />)
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    expect(onOpenEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalled()

    rerender(<StudyPanel model={panelModel({ delArmed: true })} />)
    expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy()
  })

  it('判完停在卡上（学习等「下一词」/ 复习已判）也留着编辑入口', () => {
    const onOpenEdit = vi.fn()
    const { rerender } = render(<StudyPanel model={panelModel({ mode: 'learn', learnGraded: true, onOpenEdit })} />)
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    expect(onOpenEdit).toHaveBeenCalled()

    onOpenEdit.mockClear()
    rerender(<StudyPanel model={panelModel({ mode: 'review', revealed: true, reviewGraded: true, onOpenEdit })} />)
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    expect(onOpenEdit).toHaveBeenCalled()
  })

  it('编辑表单打开时：根节点带 editing（右栏可滚），保存/取消都在', () => {
    const { container } = render(
      <StudyPanel model={panelModel({ editOpen: true, draft: { word: 'run', phonetic: '', partOfSpeech: '', meaning: '跑', definition: '', usage: '', phrases: '', idioms: '', grammarMarks: '' } })} />,
    )
    expect(container.querySelector('.study.editing')).not.toBeNull()
    expect(container.querySelector('.study-main > .study-edit')).not.toBeNull()
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('没有卡片时显示小结与重练入口', () => {
    const onRetryForgot = vi.fn()
    const onRestart = vi.fn()
    render(
      <StudyPanel
        model={panelModel({
          card: null,
          counts: { know: 6, fuzzy: 2, forgot: 1 },
          forgotCount: 1,
          onRetryForgot,
          onRestart,
        })}
      />,
    )
    expect(screen.getByText(/本轮完成/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重练忘记的 1 个/ }))
    expect(onRetryForgot).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /再来一轮/ }))
    expect(onRestart).toHaveBeenCalled()
  })
})

describe('StudyPanel：复习模式三键', () => {
  it('看见单词就能判：不用先翻面，也没有「显示释义」按钮', () => {
    const onReviewAnswer = vi.fn()
    render(<StudyPanel model={panelModel({ mode: 'review', reviewKeys: true, onReviewAnswer })} />)

    expect(screen.queryByRole('button', { name: '显示释义（空格）' })).toBeNull()
    expect(screen.queryByText(/复习 2 次/)).toBeNull() // 释义区没摊开
    fireEvent.click(screen.getByRole('button', { name: /^认识/ }))
    fireEvent.click(screen.getByRole('button', { name: /模糊/ }))
    fireEvent.click(screen.getByRole('button', { name: /忘记了/ }))
    expect(onReviewAnswer.mock.calls.map((c) => c[0])).toEqual(['good', 'hard', 'again'])
  })

  it('点卡片不翻面（不给偷看答案再点认识）', () => {
    const onReveal = vi.fn()
    render(<StudyPanel model={panelModel({ mode: 'review', reviewKeys: true, onReveal })} />)
    fireEvent.click(screen.getByText('run'))
    expect(onReveal).not.toHaveBeenCalled()
  })

  it('判「模糊」后摊开卡：给「下一词」和「记错了」两个出口', () => {
    const onReviewChoice = vi.fn()
    render(<StudyPanel model={panelModel({ mode: 'review', revealed: true, reviewFuzzy: true, onReviewChoice })} />)

    expect(screen.getByText(/复习 2 次/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /记错了/ }))
    fireEvent.click(screen.getByRole('button', { name: /下一词/ }))
    expect(onReviewChoice.mock.calls.map((c) => c[0])).toEqual(['missed', 'next'])
  })

  it('判「忘记了」后只等「下一词」，不再显示三键（也不给「不认识」二次写库）', () => {
    const onNext = vi.fn()
    render(<StudyPanel model={panelModel({ mode: 'review', revealed: true, reviewGraded: true, onNext })} />)

    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '不认识' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /下一词/ }))
    expect(onNext).toHaveBeenCalled()
  })
})

describe('StudyPanel：两列布局与拼写判错提示', () => {
  it('工具条独占左栏，卡片和评分按钮在右栏（不跟工具条挤一列）', () => {
    const { container } = render(<StudyPanel model={panelModel({ revealed: true })} />)
    const side = container.querySelector('.study > .study-side')
    const main = container.querySelector('.study > .study-main')

    expect(side?.querySelector('.study-bar')).not.toBeNull()
    expect(main?.querySelector('.study-card')).not.toBeNull()
    expect(main?.querySelector('.study-bar')).toBeNull() // 工具条不在卡片那一列
    expect(main?.querySelector('.study-actions')).not.toBeNull()
  })

  it('拼写判错页：确认按钮下方标出空格键（和「看答案 H」一个样式）', () => {
    const onAckSpellMiss = vi.fn()
    render(
      <StudyPanel
        model={panelModel({ spellMiss: { input: 'rnu', word: 'run', meaning: '跑', requeued: true }, onAckSpellMiss })}
      />,
    )

    const hint = document.querySelector('.spell-miss-hint')
    expect(hint?.textContent).toContain('空格')
    expect(hint?.querySelector('kbd')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /确认，从头重学/ }))
    expect(onAckSpellMiss).toHaveBeenCalledTimes(1)
  })
})
