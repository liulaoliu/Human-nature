// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ArticleMastery } from '../../core/mastery'
import SideMastery from './SideMastery'

const mastery: ArticleMastery = {
  score: 76,
  grade: '熟',
  enough: true,
  next: '再背 5 个到期词',
  dimensions: [
    { key: 'vocab', label: '词汇', score: 80, detail: '12/15' },
    { key: 'listen', label: '听力', score: 60, detail: '3/5' },
  ],
}

describe('SideMastery', () => {
  it('显示综合分、档位、各维度与下一步', () => {
    render(<SideMastery mastery={mastery} onStartArticle={vi.fn()} onStartVocab={vi.fn()} />)
    expect(screen.getByText('76')).toBeTruthy()
    expect(screen.getByText('熟')).toBeTruthy()
    expect(screen.getByText('词汇')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('12/15')).toBeTruthy()
    expect(screen.getByText('下一步：再背 5 个到期词')).toBeTruthy()
    expect(screen.queryByText(/技能数据不足/)).toBeNull()
  })

  it('数据不足时提示先练一轮', () => {
    render(
      <SideMastery
        mastery={{ ...mastery, enough: false, grade: '生', score: 12, dimensions: [] }}
        onStartArticle={vi.fn()}
        onStartVocab={vi.fn()}
      />,
    )
    expect(screen.getByText(/技能数据不足/)).toBeTruthy()
    expect(screen.getByText('生')).toBeTruthy()
  })

  it('两个入口都回调', () => {
    const onStartArticle = vi.fn()
    const onStartVocab = vi.fn()
    render(<SideMastery mastery={mastery} onStartArticle={onStartArticle} onStartVocab={onStartVocab} />)
    fireEvent.click(screen.getByRole('button', { name: '文章测验' }))
    fireEvent.click(screen.getByRole('button', { name: '背单词' }))
    expect(onStartArticle).toHaveBeenCalled()
    expect(onStartVocab).toHaveBeenCalled()
  })
})
