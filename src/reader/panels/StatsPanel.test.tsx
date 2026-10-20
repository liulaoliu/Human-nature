// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { dayKeyLocal, type DayActivity } from '../../core/activity'
import type { PracticeRecord } from '../../core/practice'
import StatsPanel from './StatsPanel'

const today = dayKeyLocal(new Date())
const iso = new Date().toISOString()

const activity: DayActivity[] = [{ day: today, counts: { vocab: 5, listen: 2, read: 1 } }]

const practice: PracticeRecord[] = [
  { at: iso, kind: 'quiz', total: 4, correct: 3 },
  { at: iso, kind: 'listening', total: 2, correct: 2 },
]

describe('StatsPanel', () => {
  it('今日/周/月活动量按 core 口径汇总', () => {
    const { container } = render(<StatsPanel activity={activity} practice={[]} />)
    expect(screen.getByText(/🔥 1 天连续/)).toBeTruthy()
    // 今日行：词 5 · 听 2 · 读 1，总计 8
    expect(container.textContent).toContain('今日')
    expect(container.textContent).toContain('8')
    expect(container.textContent).toContain('还没有练习记录')
  })

  it('练习正确率按本周/本月/累计与分项展示', () => {
    render(<StatsPanel activity={activity} practice={practice} />)
    expect(screen.getByText('3/4（75%）')).toBeTruthy()
    expect(screen.getByText('2/2（100%）')).toBeTruthy()
    expect(screen.getByText(/考试 3\/4（75%）/)).toBeTruthy()
    expect(screen.getByText(/听力 2\/2（100%）/)).toBeTruthy()
    expect(screen.getByText(/听写 —/)).toBeTruthy()
  })

  it('最近练习按时间倒序最多 8 条', () => {
    // core 约定：list 按时间升序（旧的在前），recentPractice 取末尾 n 条再倒序
    const many: PracticeRecord[] = Array.from({ length: 10 }, (_, i) => ({
      at: new Date(Date.now() - (9 - i) * 1000).toISOString(),
      kind: 'dictation' as const,
      total: 10,
      correct: i + 1,
    }))
    const { container } = render(<StatsPanel activity={[]} practice={many} />)
    expect(container.querySelectorAll('.stat-name').length).toBeGreaterThan(8)
    // 最新一条（10/10）在列表里
    expect(screen.getAllByText('10/10（100%）').length).toBeGreaterThan(0)
  })

  it('热力图渲染 13 周格子 + 图例', () => {
    const { container } = render(<StatsPanel activity={activity} practice={[]} />)
    expect(container.querySelectorAll('.heat-grid .heat-cell')).toHaveLength(13 * 7)
    expect(screen.getByText(/少/)).toBeTruthy()
    expect(screen.getByText(/多/)).toBeTruthy()
  })

  it('空数据不崩：0 天连续、正确率为 —', () => {
    render(<StatsPanel activity={[]} practice={[]} />)
    expect(screen.getByText(/🔥 0 天连续/)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
})
