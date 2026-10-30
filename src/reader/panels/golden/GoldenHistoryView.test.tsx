// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoldenHistoryView from './GoldenHistoryView'
import { WRITING_HISTORY_PAGE, type WritingRecord } from '../../../core/writing'

function rec(i: number): WritingRecord {
  // 时间递减：第 0 条最新（列表按时间倒序）
  const at = new Date(Date.UTC(2026, 9, 30, 12, 0, 0) - i * 60_000).toISOString()
  return {
    at,
    articleId: 'a1',
    articleTitle: 'A long road',
    model: 'M',
    text: `T${i}`,
    feedback: { scores: [], issues: [], total: 8, max: 10 },
    source: 'goldenSentence',
    sentenceId: `s${i}`,
  }
}

describe('学习历史：渲染分页', () => {
  it(`默认只画 ${WRITING_HISTORY_PAGE} 行，并告诉还剩多少条；点「显示更多」继续往前`, () => {
    const rows = Array.from({ length: 120 }, (_, i) => rec(i))
    render(<GoldenHistoryView rows={{ article: rows, all: rows }} onBack={vi.fn()} />)

    expect(screen.getAllByText(/^\d{4}\//).length).toBe(WRITING_HISTORY_PAGE)
    fireEvent.click(screen.getByRole('button', { name: /显示更多（还有 20 条）/ }))
    expect(screen.queryByRole('button', { name: /显示更多/ })).toBeNull()
    expect(screen.getAllByText(/^\d{4}\//).length).toBe(120)
  })

  it('记录没超过一页时不出现「显示更多」', () => {
    const rows = Array.from({ length: 3 }, (_, i) => rec(i))
    render(<GoldenHistoryView rows={{ article: rows, all: rows }} onBack={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /显示更多/ })).toBeNull()
  })

  it('换「全部 / 本篇」回到第一页（不保留上一范围的翻页进度）', () => {
    const article = Array.from({ length: 120 }, (_, i) => rec(i))
    render(<GoldenHistoryView rows={{ article, all: article }} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /显示更多/ }))
    expect(screen.getAllByText(/^\d{4}\//).length).toBe(120)

    fireEvent.click(screen.getByRole('button', { name: /全部（120）/ }))
    expect(screen.getAllByText(/^\d{4}\//).length).toBe(WRITING_HISTORY_PAGE)
  })

  it('空态照旧：本篇没有记录时给引导文案', () => {
    render(<GoldenHistoryView rows={{ article: [], all: [rec(0)] }} onBack={vi.fn()} />)
    expect(screen.getByText(/本篇还没有记录/)).toBeTruthy()
  })
})
