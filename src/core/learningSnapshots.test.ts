import { describe, expect, it } from 'vitest'
import {
  formatSnapshotAt,
  formatSnapshotBytes,
  parseLearningSnapshots,
  snapshotReasonLabel,
} from './learningSnapshots'

describe('parseLearningSnapshots', () => {
  it('只留下合法条目，并统计丢弃数', () => {
    const out = parseLearningSnapshots([
      { at: '2026-01-01T00:00:00.000Z', reason: 'auto', bytes: 1024 },
      { at: 'bad', reason: 'manual', bytes: 10 },
      { at: '2026-01-02T00:00:00.000Z', bytes: -1 },
      { at: '2026-01-03T00:00:00.000Z', reason: 'manual', bytes: 2048 },
      'nope',
      null,
    ])
    expect(out.dropped).toBe(4)
    expect(out.snapshots.map((s) => s.at)).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ])
  })

  it('非数组直接返回空，不抛', () => {
    expect(parseLearningSnapshots(null)).toEqual({ snapshots: [], dropped: 0 })
    expect(parseLearningSnapshots({ at: 'x' })).toEqual({ snapshots: [], dropped: 0 })
  })

  it('缺 reason 时降级为空串', () => {
    const out = parseLearningSnapshots([{ at: '2026-01-01T00:00:00.000Z', bytes: 1 }])
    expect(out.snapshots[0].reason).toBe('')
  })
})

describe('快照展示', () => {
  it('来源标签', () => {
    expect(snapshotReasonLabel('auto')).toBe('自动')
    expect(snapshotReasonLabel('before-rebuild')).toBe('重建前')
    expect(snapshotReasonLabel('weird')).toBe('weird')
    expect(snapshotReasonLabel('')).toBe('未知')
  })

  it('时间按本地时区到分钟', () => {
    const d = new Date('2026-01-03T04:05:06.000Z')
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    expect(formatSnapshotAt('2026-01-03T04:05:06.000Z')).toBe(local)
    expect(formatSnapshotAt('bad')).toBe('bad')
  })

  it('体积', () => {
    expect(formatSnapshotBytes(0)).toBe('0 KB')
    expect(formatSnapshotBytes(800)).toBe('800 B')
    expect(formatSnapshotBytes(2048)).toBe('2 KB')
    expect(formatSnapshotBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
