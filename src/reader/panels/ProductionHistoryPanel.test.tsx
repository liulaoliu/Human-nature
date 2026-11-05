// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { makeProductionTask } from '../../core/productionPrompts'
import type { ProductionTarget } from '../../core/production'
import type { WritingRecord } from '../../core/writing'
import ProductionHistoryPanel from './ProductionHistoryPanel'

const target: ProductionTarget = {
  id: 'v1',
  itemId: 'v1',
  kind: 'word',
  text: 'follow up',
  meaning: '跟进',
}

const task = makeProductionTask(
  { id: 'p1', zh: '跟同事说明进度', goal: '说明进度', targets: [target], model: 'I will follow up.' },
  '工作',
  'full',
  's1',
)

const record: WritingRecord = {
  at: '2026-11-01T10:00:00.000Z',
  articleId: 'A',
  articleTitle: 'A',
  model: task.model,
  text: 'I will follow up.',
  feedback: {
    version: 2,
    scores: [],
    total: 80,
    max: 100,
    issues: [],
    recommendations: [],
    polished: '',
    summary: '可以。',
  },
  task: { ...task, hits: [{ ...target, used: true }], round: 1 } as unknown as WritingRecord['task'],
  source: 'production',
}

describe('ProductionHistoryPanel：产出历史', () => {
  it('显示统计 / 分组 / 两稿内容；切到没有记录的模式显示空状态', () => {
    const onBack = vi.fn()
    render(
      <ProductionHistoryPanel
        records={[record]}
        progress={[]}
        articleIdentity="A"
        articleTitle="A"
        onBack={onBack}
      />,
    )
    expect(screen.getByText(/产出 1 次/)).toBeTruthy()
    expect(screen.getByText('跟同事说明进度')).toBeTruthy()
    expect(screen.getByText('I will follow up.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('历史模式'), { target: { value: 'yogurt' } })
    expect(screen.getByText(/还没有记录/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回工棚' }))
    expect(onBack).toHaveBeenCalled()
  })
})
