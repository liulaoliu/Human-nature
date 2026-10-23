// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StudyActions, { type StudyActionsProps } from './StudyActions'
import { vocabItem } from '../../core/testFixtures'

/**
 * 动作区的**分支优先级**：这块状态机有九种状态，顺序错了就是「该评分的卡上没有评分按钮」
 * 或者「判完了还能再评一次」（后者会写两次库）。
 *
 * 所以这里不测样式，只钉「什么状态下出现哪个按钮」。
 */
const card = vocabItem({ word: 'rival', lemma: 'rival', partOfSpeech: 'v.', meaning: 'v. 与…匹敌' })

function props(over: Partial<StudyActionsProps> = {}): StudyActionsProps {
  const noop = () => {}
  return {
    card,
    items: [card],
    mode: 'review',
    drillOn: false,
    learnQuizOn: false,
    learnReveal: null,
    learnGraded: false,
    reviewMode: false,
    reviewFuzzy: false,
    reviewGraded: false,
    showMeaningGate: false,
    pendingForgot: false,
    canGrade: true,
    spellingFront: false,
    gradeInfo: '',
    onSpeak: noop,
    onDrillCleared: noop,
    onSpellMiss: noop,
    onLearnContinue: noop,
    onNext: noop,
    onReviewChoice: noop,
    onConfirmForgot: noop,
    onSoftenForgot: noop,
    onCancelForgot: noop,
    onGrade: noop,
    onReviewAnswer: noop,
    onCheckSpelling: noop,
    onReveal: noop,
    ...over,
  }
}

describe('StudyActions：分支优先级', () => {
  it('能评分时显示三档评分（复习模式走 onReviewAnswer）', () => {
    const onReviewAnswer = vi.fn()
    render(<StudyActions {...props({ reviewMode: true, onReviewAnswer })} />)
    screen.getByText(/认识/).click()
    expect(onReviewAnswer).toHaveBeenCalledWith('good')
  })

  it('学习模式判完了只给「下一词」，不再给三档评分（否则会二次写库）', () => {
    render(<StudyActions {...props({ mode: 'learn', learnGraded: true, canGrade: true })} />)
    expect(screen.getByText(/下一词/)).toBeTruthy()
    expect(screen.queryByText(/认识/)).toBeNull()
  })

  it('释义页还没点「继续」时不给「下一词」', () => {
    const { container } = render(
      <StudyActions {...props({ learnQuizOn: true, learnReveal: { auto: false } as never })} />,
    )
    // 只有「继续」一个按钮
    expect(container.querySelectorAll('button')).toHaveLength(1)
    screen.getByText(/继续（看单词卡）/)
  })

  it('锤炼中整块换成 DrillBoard，评分按钮消失', () => {
    render(<StudyActions {...props({ drillOn: true, canGrade: true })} />)
    expect(screen.queryByText(/认识/)).toBeNull()
  })

  it('忘了但刚选对释义：先问按哪个排期', () => {
    render(<StudyActions {...props({ pendingForgot: true, canGrade: true })} />)
    expect(screen.getByText(/确实忘了/)).toBeTruthy()
    expect(screen.queryByText(/认识/)).toBeNull()
  })

  it('拼写模式还没检查：只给「检查」', () => {
    render(<StudyActions {...props({ spellingFront: true, canGrade: false })} />)
    screen.getByText(/检查（回车）/)
    expect(screen.queryByText(/认识/)).toBeNull()
  })

  it('什么都没到时：给「显示释义」', () => {
    render(<StudyActions {...props({ canGrade: false })} />)
    screen.getByText(/显示释义（空格）/)
  })

  it('释义关（选了「不认识」的词）不显示任何按钮', () => {
    const { container } = render(<StudyActions {...props({ showMeaningGate: true, canGrade: true })} />)
    expect(container.innerHTML).toBe('')
  })

  it('复习「模糊」待定：给「下一词」和「记错了」', () => {
    render(<StudyActions {...props({ reviewFuzzy: true })} />)
    screen.getByText(/下一词/)
    screen.getByText(/记错了 · 其实不认识/)
  })
})
