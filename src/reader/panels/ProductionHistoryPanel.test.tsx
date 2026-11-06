// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { makeProductionTask } from '../../core/productionPrompts'
import type { ProductionTarget } from '../../core/production'
import type { WritingRecord } from '../../core/writing'
import { parseProductionQuery } from '../route'
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

/** 地址 → 路由状态这一段由 `route.test.ts` 单独测；这里只喂解析结果。 */
function routeOf(url: string) {
  return parseProductionQuery(new URL(url, 'http://localhost').search)
}

describe('ProductionHistoryPanel：产出历史', () => {
  it('显示统计 / 分组 / 两稿内容；切到没有记录的模式显示空状态', () => {
    const onBack = vi.fn()
    const onNavigate = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <ProductionHistoryPanel
          records={[record]}
          progress={[]}
          articleIdentity="A"
          articleTitle="A"
          onBack={onBack}
          route={{ view: 'history' }}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/产出 1 次/)).toBeTruthy()
    expect(screen.getByText('跟同事说明进度')).toBeTruthy()
    expect(screen.getByText('I will follow up.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('历史模式'), { target: { value: 'yogurt' } })
    expect(onNavigate).toHaveBeenLastCalledWith(
      { view: 'history', mode: 'yogurt' },
      { replace: true },
    )
    // 筛选是受控的：父层（ReaderApp）把新 route 传回来才生效
    rerender(
      <MemoryRouter>
        <ProductionHistoryPanel
          records={[record]}
          progress={[]}
          articleIdentity="A"
          articleTitle="A"
          onBack={onBack}
          route={{ view: 'history', mode: 'yogurt' }}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/还没有记录/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回工棚' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('筛选和目标块详情能从 URL 深链接恢复', () => {
    render(
      <MemoryRouter>
        <ProductionHistoryPanel
          records={[record]}
          progress={[
            {
              key: 'word:follow up',
              kind: 'word',
              text: 'follow up',
              meaning: '跟进',
              attempts: 2,
              hits: 1,
              misses: 1,
              streak: 0,
              lastAt: '2026-11-01T10:00:00.000Z',
              dueAt: '2026-11-02T10:00:00.000Z',
            },
          ]}
          articleIdentity="A"
          articleTitle="A"
          onBack={vi.fn()}
          route={routeOf(
            '/reader/p/production?ph=1&pa=all&pm=full&pt=%E5%B7%A5%E4%BD%9C&ptk=word%3Afollow+up',
          )}
        />
      </MemoryRouter>,
    )
    expect((screen.getByLabelText('历史主题搜索') as HTMLInputElement).value).toBe('工作')
    expect((screen.getByLabelText('历史模式') as HTMLSelectElement).value).toBe('full')
    expect(screen.getByText('目标块：follow up')).toBeTruthy()
  })
})
