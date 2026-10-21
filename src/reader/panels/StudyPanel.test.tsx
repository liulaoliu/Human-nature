// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import StudyPanel, { type StudyPanelProps } from './StudyPanel'

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

function props(over: Partial<StudyPanelProps> = {}): StudyPanelProps {
  const noop = vi.fn()
  return {
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
    drillOn: false,
    meaningGate: false,
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
    onRetryForgot: noop,
    onRestart: noop,
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('StudyPanel：卡片与评分', () => {
  it('挂载时自动朗读一次；拼写模式不读（防剧透）', () => {
    const onSpeak = vi.fn()
    const { rerender } = render(<StudyPanel {...props({ onSpeak })} />)
    expect(onSpeak).toHaveBeenCalledWith('run')

    onSpeak.mockClear()
    rerender(<StudyPanel {...props({ onSpeak, spelling: true })} />)
    expect(onSpeak).not.toHaveBeenCalled()
  })

  it('未揭示：只有「显示释义」；点了才出现评分', () => {
    const onReveal = vi.fn()
    const { rerender } = render(<StudyPanel {...props({ onReveal })} />)
    fireEvent.click(screen.getByRole('button', { name: '显示释义（空格）' }))
    expect(onReveal).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()

    rerender(<StudyPanel {...props({ revealed: true })} />)
    expect(screen.getByText(/复习 2 次/)).toBeTruthy()
  })

  it('揭示后三个评分走 onGrade', () => {
    const onGrade = vi.fn()
    render(<StudyPanel {...props({ revealed: true, onGrade })} />)
    fireEvent.click(screen.getByRole('button', { name: /^认识/ }))
    fireEvent.click(screen.getByRole('button', { name: /模糊/ }))
    fireEvent.click(screen.getByRole('button', { name: /忘记了/ }))
    expect(onGrade.mock.calls.map((c) => c[0])).toEqual(['good', 'hard', 'again'])
  })

  it('拼写模式：输入回车检查，checked 后显示对错并能评分', () => {
    const onCheckSpelling = vi.fn()
    const onInputChange = vi.fn()
    const { rerender } = render(
      <StudyPanel {...props({ spelling: true, onCheckSpelling, onInputChange })} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/拼出这个英文单词/), { target: { value: 'run' } })
    expect(onInputChange).toHaveBeenCalledWith('run')
    fireEvent.keyDown(screen.getByPlaceholderText(/拼出这个英文单词/), { key: 'Enter' })
    expect(onCheckSpelling).toHaveBeenCalled()

    rerender(<StudyPanel {...props({ spelling: true, checked: true, input: 'run', revealed: false })} />)
    expect(screen.getByText('✔ 正确')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^认识/ })).toBeTruthy()

    // 拼错：不再显示评分按钮，改为一屏「判为不认识」的确认
    const onAckSpellMiss = vi.fn()
    rerender(
      <StudyPanel
        {...props({
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
    const { rerender } = render(<StudyPanel {...props({ spelling: true, relearning: true })} />)
    expect(screen.queryByPlaceholderText(/拼出这个英文单词/)).toBeNull()
    expect(screen.getByText('run')).toBeTruthy()

    rerender(<StudyPanel {...props({ spelling: true, relearning: true, revealed: true, drillOn: true })} />)
    expect(screen.getByPlaceholderText('拼出这个英文单词')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()
  })

  it('超时锤炼：隐藏评分按钮，交给 DrillBoard', () => {
    render(<StudyPanel {...props({ revealed: true, drillOn: true })} />)
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
      <StudyPanel {...props({ items, meaningGate: true, onReveal, onMeaningCleared })} />,
    )
    expect(screen.getByText('🧠 选中文释义')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^认识/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /走/ }))
    expect(onMeaningCleared).not.toHaveBeenCalled()
    expect(screen.getByText('✘ 不对，再来一次')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /跑/ }))
    expect(onMeaningCleared).toHaveBeenCalled()
    expect(onReveal).toHaveBeenCalled()

    rerender(<StudyPanel {...props({ items, revealed: true, onReveal, onMeaningCleared })} />)
    expect(screen.getByRole('button', { name: /^认识/ })).toBeTruthy()
  })
})

describe('StudyPanel：维护与本轮小结', () => {
  it('编辑/删除入口；两步删除第二下变成确认', () => {
    const onOpenEdit = vi.fn()
    const onDelete = vi.fn()
    const { rerender } = render(<StudyPanel {...props({ onOpenEdit, onDelete })} />)
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    expect(onOpenEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalled()

    rerender(<StudyPanel {...props({ delArmed: true })} />)
    expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy()
  })

  it('没有卡片时显示小结与重练入口', () => {
    const onRetryForgot = vi.fn()
    const onRestart = vi.fn()
    render(
      <StudyPanel
        {...props({
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
