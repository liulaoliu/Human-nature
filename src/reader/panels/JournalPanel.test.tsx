// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { buildHeatmap } from '../../core/activity'
import type { JournalDay, JournalSummaryRow } from '../../core/journal'
import { vocabItem } from '../../core/testFixtures'
import JournalPanel, { type JournalPanelProps } from './JournalPanel'

const day = '2026-10-20'
const days = ['2026-10-20', '2026-10-19', '2026-10-18']

const data: JournalDay = {
  day,
  studied: [vocabItem({ id: 'v2', word: 'walk', lemma: 'walk' })],
  addedWords: [vocabItem({ id: 'v1', word: 'run', lemma: 'run', meaning: '跑' })],
  addedLanguages: [
    {
      articleId: 'doc:1',
      articleTitle: 'Article',
      sentenceId: 's1',
      sentence: 'Run fast.',
      at: `${day}T09:05:00.000Z`,
      manual: false,
      structure: 'SV',
      grammar: '一般现在时',
      idioms: ['run fast'],
      phrases: ['run into'],
      usage: ['run a business'],
    },
  ],
  activity: { vocab: 5, read: 1, listen: 0 },
  practice: [{ kind: 'quiz', total: 4, correct: 3 }],
}

const summary: JournalSummaryRow[] = days.map((d, i) => ({
  day: d,
  addedWords: i,
  studied: i + 1,
  languages: i,
  activity: i * 2,
}))

const heat = buildHeatmap({}, 13, new Date())

function props(over: Partial<JournalPanelProps> = {}): JournalPanelProps {
  const noop = vi.fn()
  return {
    onClose: noop,
    days,
    day,
    onDayChange: noop,
    data,
    summary,
    heat,
    onSpeak: noop,
    ...over,
  }
}

describe('JournalPanel：日期导航', () => {
  it('倒序列表里「前一天」是更早、「后一天」是更新；到头禁用', () => {
    const { rerender } = render(<JournalPanel {...props()} />)
    const prev = screen.getByRole('button', { name: '前一天' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: '后一天' }) as HTMLButtonElement
    expect(prev.disabled).toBe(false)
    // 最新一天没有「后一天」
    expect(next.disabled).toBe(true)

    rerender(<JournalPanel {...props({ day: '2026-10-18' })} />)
    expect((screen.getByRole('button', { name: '前一天' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<JournalPanel {...props({ day: '2026-10-20' })} />)
    expect((screen.getByRole('button', { name: '后一天' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('前一天/后一天/下拉/小结行都走 onDayChange', () => {
    const onDayChange = vi.fn()
    render(<JournalPanel {...props({ day: '2026-10-19', onDayChange })} />)
    fireEvent.click(screen.getByRole('button', { name: '前一天' }))
    expect(onDayChange).toHaveBeenLastCalledWith('2026-10-18')
    fireEvent.click(screen.getByRole('button', { name: '后一天' }))
    expect(onDayChange).toHaveBeenLastCalledWith('2026-10-20')

    fireEvent.change(screen.getByTitle('选一天'), { target: { value: '2026-10-18' } })
    expect(onDayChange).toHaveBeenLastCalledWith('2026-10-18')

    fireEvent.click(screen.getByRole('button', { name: /^2026-10-19 新增/ }))
    expect(onDayChange).toHaveBeenLastCalledWith('2026-10-19')
  })

  it('没有记录时下拉只有当天；小结显示占位', () => {
    render(<JournalPanel {...props({ days: [], summary: [], data: { ...data, day: '2026-10-20' } })} />)
    expect(screen.getByText('还没有任何记录')).toBeTruthy()
    expect((screen.getByTitle('选一天') as HTMLSelectElement).value).toBe(day)
  })

  it('点热力图某天切换日志', () => {
    const onDayChange = vi.fn()
    render(<JournalPanel {...props({ onDayChange })} />)
    const cell = document.querySelector('.heat-cell[role=button]') as HTMLElement
    fireEvent.click(cell)
    expect(onDayChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })
})

describe('JournalPanel：当天内容', () => {
  it('头部统计与活动/练习成绩', () => {
    render(<JournalPanel {...props()} />)
    expect(screen.getByText('新增 1 词 · 背了 1 词 · 语言点 1')).toBeTruthy()
    expect(screen.getByText('词 5 · 读 1')).toBeTruthy()
    expect(screen.getByText('quiz：3/4（75%）')).toBeTruthy()
  })

  it('新增生词可点读；背过的词也列出', () => {
    const onSpeak = vi.fn()
    render(<JournalPanel {...props({ onSpeak })} />)
    fireEvent.click(screen.getByRole('button', { name: /run/ }))
    expect(onSpeak).toHaveBeenCalledWith('run')
    fireEvent.click(screen.getByRole('button', { name: 'walk' }))
    expect(onSpeak).toHaveBeenCalledWith('walk')
  })

  it('语言点展示来源/结构/语法/习语/词组/用法', () => {
    render(<JournalPanel {...props()} />)
    expect(screen.getByText(/AI · Article · 09:05/)).toBeTruthy()
    expect(screen.getByText('Run fast.')).toBeTruthy()
    expect(screen.getByText('结构：SV')).toBeTruthy()
    expect(screen.getByText('语法：一般现在时')).toBeTruthy()
    expect(screen.getByText('习语：run fast')).toBeTruthy()
    expect(screen.getByText('词组：run into')).toBeTruthy()
    expect(screen.getByText('用法：run a business')).toBeTruthy()
  })

  it('空数据：没有活动/成绩区块，各栏显示「没有」', () => {
    render(
      <JournalPanel
        {...props({
          data: { day, studied: [], addedWords: [], addedLanguages: [], activity: {}, practice: [] },
        })}
      />,
    )
    expect(screen.queryByText('当天活动')).toBeNull()
    expect(screen.queryByText('练习成绩')).toBeNull()
    expect(screen.getAllByText('没有')).toHaveLength(2)
    expect(screen.getByText(/语言点从生成\/添加那天起才有记录/)).toBeTruthy()
  })

  it('点遮罩关闭；点面板不关闭；关闭按钮回调', () => {
    const onClose = vi.fn()
    const { container } = render(<JournalPanel {...props({ onClose })} />)
    fireEvent.click(screen.getByText('📅 学习日志'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('.plan-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
