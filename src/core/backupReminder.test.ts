import { describe, expect, it } from 'vitest'
import { backupReminder } from './backupReminder'

const NOW = Date.parse('2026-11-01T12:00:00.000Z')

describe('backupReminder', () => {
  it('从没导出过 → never', () => {
    const r = backupReminder(null, NOW)
    expect(r.level).toBe('never')
    expect(r.days).toBe(-1)
    expect(r.text).toContain('还没导出')
  })

  it('坏时间串也当没导出过', () => {
    expect(backupReminder('not-a-date', NOW).level).toBe('never')
  })

  it('今天导出过 → ok / 0 天', () => {
    const r = backupReminder('2026-11-01T08:00:00.000Z', NOW)
    expect(r.level).toBe('ok')
    expect(r.days).toBe(0)
    expect(r.text).toBe('上次导出：今天')
  })

  it('第 6 天还是 ok，第 7 天开始 due', () => {
    expect(backupReminder('2026-10-26T12:00:00.000Z', NOW).level).toBe('ok')
    const due = backupReminder('2026-10-25T12:00:00.000Z', NOW)
    expect(due.level).toBe('due')
    expect(due.days).toBe(7)
    expect(due.text).toContain('7 天前')
  })

  it('未来时间不出现负天数', () => {
    const r = backupReminder('2026-11-03T12:00:00.000Z', NOW)
    expect(r.days).toBe(0)
    expect(r.level).toBe('ok')
  })
})
