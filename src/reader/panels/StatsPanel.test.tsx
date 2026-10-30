// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { dayKeyLocal, type DayActivity } from '../../core/activity'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { RetellRecord } from '../../core/learning'
import type { PracticeRecord } from '../../core/practice'
import type { WritingRecord } from '../../core/writing'
import StatsPanel from './StatsPanel'

const today = dayKeyLocal(new Date())
const iso = new Date().toISOString()

const activity: DayActivity[] = [{ day: today, counts: { vocab: 5, listen: 2, read: 1 } }]

const practice: PracticeRecord[] = [
  { at: iso, kind: 'quiz', total: 4, correct: 3 },
  { at: iso, kind: 'listening', total: 2, correct: 2 },
]

/** 六份记录的全量 props（大部分用例只关心其中一两份）。 */
const empty = {
  studyDays: [] as never[],
  writingHistory: [] as WritingRecord[],
  retells: [] as RetellRecord[],
  readDone: [] as never[],
  goldenDrills: [] as GoldenDrillRecord[],
}

function renderPanel(over: Partial<Parameters<typeof StatsPanel>[0]> = {}) {
  return render(<StatsPanel activity={activity} practice={[]} {...empty} {...over} />)
}

/** 汇总表里某一行的三格文本（本周 / 本月 / 累计）。 */
function summaryRow(label: string): string[] {
  const tr = [...document.querySelectorAll('.stat-summary tbody tr')].find(
    (el) => el.querySelector('th')?.textContent === label,
  )
  if (!tr) throw new Error(`没有汇总行：${label}`)
  return [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '')
}

describe('StatsPanel', () => {
  it('今日/周/月活动量按 core 口径汇总', () => {
    const { container } = renderPanel({ activity })
    expect(screen.getByText(/🔥 1 天连续/)).toBeTruthy()
    // 今日行：词 5 · 听 2 · 读 1，总计 8
    expect(container.textContent).toContain('今日')
    expect(container.textContent).toContain('8')
    expect(container.textContent).toContain('还没有练习记录')
  })

  it('每月 1 日凌晨仍按逻辑月统计（不空一档）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 1, 0, 30)) // 逻辑日仍是 10-31
    try {
      const { container } = render(
        <StatsPanel
          activity={[{ day: '2026-10-31', counts: { vocab: 7, listen: 0, read: 0 } }]}
          practice={[]}
          {...empty}
        />,
      )
      const monthLine = [...container.querySelectorAll('.stat-line')].find((el) =>
        el.textContent?.includes('本月'),
      )
      expect(monthLine?.textContent).toContain('7')
    } finally {
      vi.useRealTimers()
    }
  })

  it('练习正确率按本周/本月/累计与分项展示（含金句课）', () => {
    renderPanel({
      activity,
      practice: [...practice, { at: iso, kind: 'golden', total: 2, correct: 2 }],
    })
    // 汇总：考试 4 题 3 对 + 听力 2/2 + 金句课 2/2 = 8 题 7 对（本周 / 本月 / 累计各一行）
    expect(screen.getAllByText('7/8（88%）')).toHaveLength(3)
    // 分项按 PRACTICE_LABEL 全量列出：金句课原来只计入总正确率、分项漏了
    const kindLine = [...document.querySelectorAll('.muted')].find((el) => el.textContent?.startsWith('考试'))
    expect(kindLine?.textContent).toContain('考试 3/4（75%）')
    expect(kindLine?.textContent).toContain('听写 —')
    expect(kindLine?.textContent).toContain('听力理解 2/2（100%）')
    expect(kindLine?.textContent).toContain('D老师小课堂 2/2（100%）')
  })

  it('最近练习按时间倒序最多 8 条', () => {
    // core 约定：list 按时间升序（旧的在前），recentPractice 取末尾 n 条再倒序
    const many: PracticeRecord[] = Array.from({ length: 10 }, (_, i) => ({
      at: new Date(Date.now() - (9 - i) * 1000).toISOString(),
      kind: 'dictation' as const,
      total: 10,
      correct: i + 1,
    }))
    const { container } = renderPanel({ activity: [], practice: many })
    expect(container.querySelectorAll('.stat-name').length).toBeGreaterThan(8)
    // 最新一条（10/10）在列表里
    expect(screen.getAllByText('10/10（100%）').length).toBeGreaterThan(0)
  })

  it('热力图渲染 13 周格子 + 图例', () => {
    const { container } = renderPanel({ activity })
    expect(container.querySelectorAll('.heat-grid .heat-cell')).toHaveLength(13 * 7)
    expect(screen.getByText(/少/)).toBeTruthy()
    expect(screen.getByText(/多/)).toBeTruthy()
  })

  it('空数据不崩：0 天连续、正确率为 —', () => {
    renderPanel({ activity: [] })
    expect(screen.getByText(/🔥 0 天连续/)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('汇总表：六类记录按本周 / 本月 / 累计给出数字', () => {
    renderPanel({
      activity,
      practice: [{ at: iso, kind: 'quiz', total: 4, correct: 3 }],
      studyDays: [{ day: today, cards: 20, seconds: 600 }],
      writingHistory: [
        { at: iso, articleId: 'a', model: '', text: 'one two three', feedback: {} as never } as WritingRecord,
      ],
      retells: [{ at: iso, articleId: 'a', text: 'x y', words: 2 }],
      readDone: [{ day: today, articleId: 'a', title: 'A', at: iso }],
      goldenDrills: [
        {
          id: 'g1',
          articleId: 'a',
          sentenceId: 's',
          drillKey: 'k',
          at: iso,
          mastered: true,
          completedAt: iso,
        },
      ],
    })
    expect(summaryRow('背词')).toEqual(['20 张', '20 张', '20 张'])
    expect(summaryRow('写作')).toEqual(['1 篇', '1 篇', '1 篇'])
    expect(summaryRow('复述')).toEqual(['1 条', '1 条', '1 条'])
    expect(summaryRow('读完')).toEqual(['1 篇', '1 篇', '1 篇'])
    expect(summaryRow('金句')).toEqual(['1 句', '1 句', '1 句'])
    expect(summaryRow('练习')).toEqual(['4 道', '4 道', '4 道'])
  })

  it('汇总表：没有记录的指标显示破折号，不显示一排 0', () => {
    renderPanel({ activity: [] })
    expect(summaryRow('写作')).toEqual(['—', '—', '—'])
    expect(summaryRow('练习')).toEqual(['—', '—', '—'])
  })

  it('点汇总整行（含数字）都算点，把语义交给宿主（面板不认识路由）', () => {
    const onJump = vi.fn()
    renderPanel({ activity, onJump })
    fireEvent.click(screen.getByRole('button', { name: '背词' }))
    // 点数字格也走同一条路：整行都是热区，不用瞄准两个字
    const row = [...document.querySelectorAll('.stat-summary tbody tr')].find(
      (el) => el.querySelector('th')?.textContent?.startsWith('写作'),
    )!
    fireEvent.click(row.querySelector('td')!)
    fireEvent.click(screen.getByRole('button', { name: '复述' }))
    fireEvent.click(screen.getByRole('button', { name: '读完' }))
    fireEvent.click(screen.getByRole('button', { name: '金句' }))
    expect(onJump.mock.calls.map((c) => c[0])).toEqual(['vocab', 'writing', 'retell', 'readDone', 'golden'])
  })

  it('可点的行有箭头，光标行为交给样式；练习行不冒充按钮', () => {
    renderPanel({ activity, onJump: vi.fn() })
    const arrows = [...document.querySelectorAll('.stat-arrow')].map((el) => el.textContent)
    expect(arrows).toEqual(['›', '›', '›', '›', '›'])
    const practiceRow = [...document.querySelectorAll('.stat-summary tbody tr')].find(
      (el) => el.querySelector('th')?.textContent === '练习',
    )!
    expect(practiceRow.className).not.toContain('stat-row-btn')
    expect(practiceRow.querySelector('.stat-arrow')).toBeNull()
  })

  it('落点当前去不了时置灰：不渲染按钮、整行不响应，给出原因', () => {
    const onJump = vi.fn()
    renderPanel({ activity, onJump, jumpable: { writing: false, retell: false, golden: false } })
    // 背词 / 读完 始终可去
    expect(screen.getByRole('button', { name: '背词' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '读完' })).toBeTruthy()
    // 写作 / 复述 / 金句 置灰
    for (const label of ['写作', '复述', '金句']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
      const metric = screen.getByText(label)
      expect(metric.className).toContain('off')
      expect(metric.getAttribute('title')).toBe('先打开一篇文章')
      const row = metric.closest('tr')!
      expect(row.className).not.toContain('stat-row-btn')
      fireEvent.click(row)
    }
    expect(onJump).not.toHaveBeenCalled()
  })

  it('不传 onJump 时汇总指标不可点（不做假按钮）', () => {
    renderPanel({ activity })
    expect(screen.queryByRole('button', { name: '背词' })).toBeNull()
    expect(screen.getByText('背词')).toBeTruthy()
  })

  it('点热力图某天展开当天明细，再点一次收起', () => {
    const { container } = renderPanel({
      activity,
      studyDays: [{ day: today, cards: 20, seconds: 600 }],
      readDone: [{ day: today, articleId: 'a', title: 'A', at: iso }],
    })
    const cell = container.querySelector('.heat-cell.act')!
    expect(cell.getAttribute('title')).toContain('点击查看当天明细')

    fireEvent.click(cell)
    const region = screen.getByRole('region', { name: `${today} 当天明细` })
    expect(region.textContent).toContain('读 1 · 词 5 · 听 2 · 写 0 · 说 0')
    expect(region.textContent).toContain('背词 20 张（10 分钟）')
    expect(region.textContent).toContain('读完 1 篇')

    // 再点同一格 = 收起
    fireEvent.click(container.querySelector('.heat-cell.act')!)
    expect(screen.queryByRole('region', { name: `${today} 当天明细` })).toBeNull()
  })

  it('当天明细的「收起」按钮关掉明细', () => {
    const { container } = renderPanel({ activity })
    fireEvent.click(container.querySelector('.heat-cell.act')!)
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByRole('region', { name: `${today} 当天明细` })).toBeNull()
  })

  it('热力图周数可切到 26 / 52 周', () => {
    const { container } = renderPanel({ activity })
    fireEvent.click(screen.getByRole('button', { name: '52 周' }))
    expect(container.querySelectorAll('.heat-grid .heat-cell')).toHaveLength(52 * 7)
    expect(screen.getByRole('button', { name: '52 周' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '26 周' }))
    expect(container.querySelectorAll('.heat-grid .heat-cell')).toHaveLength(26 * 7)
  })

  it('不传 onRebuild 时不显示「重建并核对」入口', () => {
    renderPanel({ activity, practice })
    expect(screen.queryByRole('button', { name: '重建并核对学习记录' })).toBeNull()
    expect(screen.queryByText('学习记录核对')).toBeNull()
  })

  it('点「重建并核对」把动作交出去；重建中禁用按钮', () => {
    const onRebuild = vi.fn()
    const { rerender } = render(
      <StatsPanel activity={activity} practice={[]} {...empty} onRebuild={onRebuild} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重建并核对学习记录' }))
    expect(onRebuild).toHaveBeenCalledTimes(1)

    rerender(<StatsPanel activity={activity} practice={[]} {...empty} onRebuild={onRebuild} rebuildBusy />)
    const busy = screen.getByRole('button', { name: '重建并核对学习记录' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(busy.textContent).toBe('重建中…')
    fireEvent.click(busy)
    expect(onRebuild).toHaveBeenCalledTimes(1)
  })

  it('核对结果按 role=status 播报，一致 / 有差异用不同样式', () => {
    const { rerender } = render(
      <StatsPanel
        activity={activity}
        practice={[]}
        {...empty}
        onRebuild={() => {}}
        rebuildNote="核对一致：活动 8 次 · 答题 0 道"
        rebuildMatched
      />,
    )
    const ok = screen.getByRole('status')
    expect(ok.textContent).toBe('核对一致：活动 8 次 · 答题 0 道')
    expect(ok.className).toBe('stat-note')

    rerender(
      <StatsPanel
        activity={activity}
        practice={[]}
        {...empty}
        onRebuild={() => {}}
        rebuildNote="核对发现 1 项不一致：活动·词 本地 5 / 服务端 8"
      />,
    )
    expect(screen.getByRole('status').className).toBe('stat-note bad')
  })
})
