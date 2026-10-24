// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DrillBoard from './StudyDrill'
import { vocabItem } from '../../core/testFixtures'

/**
 * 强制锤炼里的「选词义」是纯前端交互：
 * 1-4 直接选，A/D 移动高亮，回车确认。这里钉住键盘接线。
 */
const card = vocabItem({
  id: 'c1',
  word: 'abandon',
  lemma: 'abandon',
  meaning: '放弃',
})

const items = [
  card,
  vocabItem({ id: 'c2', word: 'benefit', lemma: 'benefit', meaning: '益处' }),
  vocabItem({ id: 'c3', word: 'cautious', lemma: 'cautious', meaning: '谨慎的' }),
  vocabItem({ id: 'c4', word: 'derive', lemma: 'derive', meaning: '获得' }),
]

function setup() {
  const onDone = vi.fn()
  const onSpellMiss = vi.fn()
  render(<DrillBoard card={card} items={items} onSpeak={vi.fn()} onDone={onDone} onSpellMiss={onSpellMiss} />)
  // 第一步是拼写：答对后进入「选词义」
  const input = screen.getByPlaceholderText('拼出这个英文单词')
  fireEvent.change(input, { target: { value: 'abandon' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  return { onDone, onSpellMiss }
}

const optionButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.quiz-options button'))
const focused = () => document.querySelector('.quiz-options button.focused')

describe('DrillBoard：选词义键盘操作', () => {
  it('初始不预选任何选项（不泄露答案）', () => {
    setup()
    expect(focused()).toBeNull()
  })

  it('A/D 在选项间移动高亮（可循环）', () => {
    setup()
    expect(focused()).toBeNull()

    fireEvent.keyDown(window, { key: 'd' })
    expect(focused()?.textContent).toContain('1')

    fireEvent.keyDown(window, { key: 'd' })
    expect(focused()?.textContent).toContain('2')

    fireEvent.keyDown(window, { key: 'a' })
    expect(focused()?.textContent).toContain('1')

    fireEvent.keyDown(window, { key: 'a' })
    expect(focused()?.textContent).toContain('4')
  })

  it('按数字键直接选中对应释义', () => {
    const { onDone } = setup()
    const correctIndex = optionButtons().findIndex((b) => b.textContent?.includes('放弃'))
    expect(correctIndex).toBeGreaterThanOrEqual(0)

    fireEvent.keyDown(window, { key: String(correctIndex + 1) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('答错只标红所选，不把正确项标出来', () => {
    const { onDone } = setup()
    const correctIndex = optionButtons().findIndex((b) => b.textContent?.includes('放弃'))
    const wrongIndex = correctIndex === 0 ? 1 : 0

    fireEvent.keyDown(window, { key: String(wrongIndex + 1) })
    const buttons = optionButtons()
    expect(buttons[wrongIndex].className).toContain('wrong-choice')
    expect(buttons[correctIndex].className).not.toContain('wrong-choice')
    expect(buttons[correctIndex].className).not.toContain('primary')
    expect(screen.getByText('✘ 不对，再来一次')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    // 再选正确项仍能通过
    fireEvent.keyDown(window, { key: String(correctIndex + 1) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('回车确认当前高亮项', () => {
    const { onDone } = setup()
    const correctIndex = optionButtons().findIndex((b) => b.textContent?.includes('放弃'))
    // 初始无高亮：第一次 D 落到第 1 项，之后每按一次后移一项
    for (let i = 0; i <= correctIndex; i++) fireEvent.keyDown(window, { key: 'd' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('DrillBoard：拼写只判一次', () => {
  it('拼错立即回调 onSpellMiss（带输入），不留在本步重试', () => {
    const onDone = vi.fn()
    const onSpellMiss = vi.fn()
    render(<DrillBoard card={card} items={items} onSpeak={vi.fn()} onDone={onDone} onSpellMiss={onSpellMiss} />)

    const input = screen.getByPlaceholderText('拼出这个英文单词')
    fireEvent.change(input, { target: { value: 'abandan' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSpellMiss).toHaveBeenCalledTimes(1)
    expect(onSpellMiss).toHaveBeenCalledWith('abandan')
    expect(onDone).not.toHaveBeenCalled()
    // 不再出现「再来一次」这种可反复输入的提示
    expect(screen.queryByText('✘ 不对，再来一次')).toBeNull()
  })
})

describe('DrillBoard：最后一步「写搭配」答对就收工', () => {
  const withUsage = vocabItem({
    id: 'c5',
    word: 'abandon',
    lemma: 'abandon',
    meaning: '放弃',
    usage: ['abandon ship'],
    phrases: ['abandon oneself to'],
  })

  it('写出用法 / 词组任意一条 → onDone 只调一次（用户报「写完搭配退不出去」）', () => {
    const onDone = vi.fn()
    render(<DrillBoard card={withUsage} items={items} onSpeak={vi.fn()} onDone={onDone} onSpellMiss={vi.fn()} />)

    // 拼写 → 选义 → 看卡 → 写搭配
    const spell = screen.getByPlaceholderText('拼出这个英文单词')
    fireEvent.change(spell, { target: { value: 'abandon' } })
    fireEvent.keyDown(spell, { key: 'Enter' })

    const correctIndex = optionButtons().findIndex((b) => b.textContent?.includes('放弃'))
    fireEvent.keyDown(window, { key: String(correctIndex + 1) })
    expect(onDone).not.toHaveBeenCalled()

    // 选义后先看单词卡，再进写搭配
    fireEvent.click(screen.getByRole('button', { name: /继续写搭配/ }))

    // 词组也行，不必原样抄用法
    const usageInput = screen.getByPlaceholderText('写出它的一个搭配 / 用法')
    fireEvent.change(usageInput, { target: { value: 'Abandon Oneself To' } })
    fireEvent.keyDown(usageInput, { key: 'Enter' })

    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('写错留在本步，给出参考搭配', () => {
    const onDone = vi.fn()
    render(<DrillBoard card={withUsage} items={items} onSpeak={vi.fn()} onDone={onDone} onSpellMiss={vi.fn()} />)

    const spell = screen.getByPlaceholderText('拼出这个英文单词')
    fireEvent.change(spell, { target: { value: 'abandon' } })
    fireEvent.keyDown(spell, { key: 'Enter' })
    const correctIndex = optionButtons().findIndex((b) => b.textContent?.includes('放弃'))
    fireEvent.keyDown(window, { key: String(correctIndex + 1) })
    fireEvent.click(screen.getByRole('button', { name: /继续写搭配/ }))

    const usageInput = screen.getByPlaceholderText('写出它的一个搭配 / 用法')
    fireEvent.change(usageInput, { target: { value: 'abandon the car' } })
    fireEvent.keyDown(usageInput, { key: 'Enter' })

    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByText(/参考：abandon ship/)).toBeTruthy()
  })
})
