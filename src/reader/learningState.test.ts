// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { learningRepo } from '../adapters/learningRepo'
import {
  hydrateLearningFromServer,
  readLearningFromLocalStorage,
  syncLearningToServer,
  writeLearningToLocalStorage,
} from './learningState'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('学习记录 localStorage 同步缓存', () => {
  it('读 / 写学习记录键', () => {
    localStorage.setItem('reader:practice', JSON.stringify([
      { at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 10, correct: 8 },
    ]))
    localStorage.setItem('reader:studiedToday', JSON.stringify([{ day: '2026-01-01', ids: ['w1'] }]))
    const data = readLearningFromLocalStorage()
    expect(data.practice).toHaveLength(1)
    expect(data.studiedDays[0].ids).toEqual(['w1'])

    writeLearningToLocalStorage(data)
    expect(JSON.parse(localStorage.getItem('reader:practice')!)).toHaveLength(1)
  })

  it('启动恢复只补缺失键，不覆盖本地已有记录', async () => {
    localStorage.setItem('reader:practice', JSON.stringify([
      { at: '2026-02-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 },
    ]))
    vi.spyOn(learningRepo, 'load').mockResolvedValue({
      practice: [{ at: '2026-01-01T00:00:00.000Z', kind: 'quiz', total: 10, correct: 8 }],
      mistakes: [{ id: 'vocab:w1', kind: 'vocab', at: '2026-01-01T00:00:00.000Z', count: 1, label: 'w1' }],
      readDone: [],
      writingHistory: [],
      retells: [],
      activity: [],
      studyDays: [],
      sessions: [],
      studiedDays: [],
      skimmed: [],
      kindStats: {},
    })

    await hydrateLearningFromServer()

    expect(JSON.parse(localStorage.getItem('reader:practice')!)[0].at).toBe('2026-02-01T00:00:00.000Z')
    expect(localStorage.getItem('reader:mistakes')).toContain('vocab:w1')
  })

  it('没有学习记录时不拿空数据覆盖服务端', async () => {
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    await expect(syncLearningToServer()).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
})
