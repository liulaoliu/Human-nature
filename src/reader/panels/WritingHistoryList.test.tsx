// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { WritingRecord } from '../../core/writing'
import WritingHistoryList from './WritingHistoryList'

const feedback = {
  version: 2 as const,
  scores: [],
  total: 8,
  max: 10,
  issues: [],
}

function record(over: Partial<WritingRecord> = {}): WritingRecord {
  return {
    at: '2026-11-01T00:00:00.000Z',
    articleId: 'A',
    articleTitle: '文章 A',
    model: '',
    text: 'text',
    feedback,
    ...over,
  }
}

const history: WritingRecord[] = [
  record({ at: '2026-11-01T00:00:00.000Z', text: 'ordinary A' }),
  record({ at: '2026-11-02T00:00:00.000Z', text: 'production A', source: 'production' }),
  record({
    at: '2026-11-03T00:00:00.000Z',
    text: 'A drill text',
    source: 'drillSentence',
    sentenceId: 'drill:A',
  }),
  record({
    at: '2026-11-04T00:00:00.000Z',
    articleId: 'B',
    articleTitle: '文章 B',
    text: 'B drill text',
    source: 'drillSentence',
    sentenceId: 'drill:B',
  }),
  record({
    at: '2026-11-05T00:00:00.000Z',
    text: 'golden text',
    source: 'goldenSentence',
  }),
]

describe('WritingHistoryList：来源 + 本篇/全库筛选', () => {
  it('默认本篇全部来源：金句课不出现，计数按来源分组', () => {
    render(<WritingHistoryList history={history} articleId="A" articleTitle="文章 A" />)
    expect(screen.getByText('练习历史（3）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '本篇（3）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全库（4）' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '全部来源（3）' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '普通仿写（1）' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '奶牛工棚（1）' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '拷打造句（1）' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /单句仿写/ })).toBeNull()
  })

  it('切来源只看拷打造句；切全库再看跨篇', () => {
    render(
      <WritingHistoryList
        history={history}
        articleId="A"
        articleTitle="文章 A"
        initialSource="all"
        initialScope="article"
      />,
    )
    fireEvent.change(screen.getByLabelText('按来源筛选'), { target: { value: 'drillSentence' } })
    expect(screen.getByText('练习历史（1）')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /拷打造句/ })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '全库（2）' }))
    expect(screen.getByText('练习历史（2）')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /拷打造句/ })).toHaveLength(2)
    expect(screen.getByText('文章 B')).toBeTruthy()
  })

  it('直接打开造句历史：默认本篇拷打造句，可展开详情', () => {
    render(
      <WritingHistoryList
        history={history}
        articleId="A"
        articleTitle="文章 A"
        title="造句历史"
        initialSource="drillSentence"
        initialScope="article"
      />,
    )
    expect(screen.getByText('造句历史（1）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /拷打造句/ }))
    expect(screen.getByText('A drill text')).toBeTruthy()
    expect(screen.getByText('得分：8/10')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 历史列表' }))
    expect(screen.getByText('造句历史（1）')).toBeTruthy()
  })

  it('本篇没有该来源时给全库入口，点击切到全库', () => {
    render(
      <WritingHistoryList
        history={history}
        articleId="B"
        articleTitle="文章 B"
        initialSource="production"
        initialScope="article"
      />,
    )
    expect(screen.getByText(/本篇还没有奶牛工棚记录/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全库有 1 条' }))
    expect(screen.getByText('练习历史（1）')).toBeTruthy()
  })

  it('清空只把当前筛选交给外层，不自己删数据', () => {
    const onClear = vi.fn()
    render(
      <WritingHistoryList
        history={history}
        articleId="A"
        articleTitle="文章 A"
        initialSource="drillSentence"
        initialScope="article"
        onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(onClear).toHaveBeenCalledWith({
      source: 'drillSentence',
      scope: 'article',
      articleId: 'A',
    })
  })

  it('超过一页先渲染最近 100 条，可继续显示更多', () => {
    const many = Array.from({ length: 101 }, (_, i) =>
      record({
        at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        text: `r${i}`,
      }),
    )
    render(<WritingHistoryList history={many} articleId="A" articleTitle="文章 A" />)
    expect(screen.getByText('练习历史（101）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /显示更多（还有 1 条）/ }))
    expect(screen.queryByRole('button', { name: /显示更多/ })).toBeNull()
  })
})
