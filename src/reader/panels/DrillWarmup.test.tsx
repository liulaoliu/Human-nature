// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DrillWarmup from './DrillWarmup'

/** 卡片内容由 buildWarmupCards 按拷打类型决定：词块档给 chunks，记忆档给 example。 */
const chunkCards = [
  { id: 'w1', word: 'run', phonetic: '/rʌn/', meaning: '跑', chunks: ['run out — 用完'] },
  { id: 'w2', word: 'curb', meaning: '抑制', chunks: [] },
]
const memoryCards = [
  { id: 'w1', word: 'run', phonetic: '/rʌn/', meaning: '跑', chunks: [], example: 'I run daily.' },
]

describe('DrillWarmup：拷打前先看一遍', () => {
  it('把要考的词和词块摊开，并给出数量', () => {
    render(<DrillWarmup title="词块拷打 · 先看一遍" kind="chunk" cards={chunkCards} onStart={vi.fn()} onCancel={vi.fn()} />)
    screen.getByText('词块拷打 · 先看一遍')
    screen.getByText('这轮要考 2 个词')
    screen.getByText('/rʌn/')
    screen.getByText('跑')
    screen.getByText('run out — 用完')
    screen.getByText(/先认一遍词块/)
  })

  it('记忆档给例句当语境', () => {
    render(<DrillWarmup title="记忆拷打 · 先看一遍" kind="memory" cards={memoryCards} onStart={vi.fn()} onCancel={vi.fn()} />)
    screen.getByText('I run daily.')
    screen.getByText(/第一次见的词答错/)
  })

  it('两条按钮都能往下走：开始 → onStart，取消 → onCancel', () => {
    const onStart = vi.fn()
    const onCancel = vi.fn()
    render(<DrillWarmup title="t" kind="memory" cards={memoryCards} onStart={onStart} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    for (const btn of screen.getAllByText('看完了，开始拷打')) fireEvent.click(btn)
    expect(onStart).toHaveBeenCalledTimes(2)
  })

  it('没有词条信息时不空白一片（说明原因）', () => {
    render(<DrillWarmup title="t" kind="memory" cards={[]} onStart={vi.fn()} onCancel={vi.fn()} />)
    screen.getByText(/这轮没有可预习的词/)
  })
})
