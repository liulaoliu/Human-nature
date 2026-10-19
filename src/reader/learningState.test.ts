// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { learningRepo } from '../adapters/learningRepo'
import { emptyLearning } from '../core/learning'
import { installFakeStorage } from './testStorage'
import { STORAGE_ERROR_EVENT } from './storage'
import {
  hasPendingLearningChanges,
  hydrateLearningFromServer,
  learningSectionForKey,
  markLearningDirty,
  readLearningFromLocalStorage,
  resetLearningSyncStateForTest,
  syncLearningToServer,
  writeLearningToLocalStorage,
} from './learningState'

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
})

afterEach(() => {
  restoreStorage()
  resetLearningSyncStateForTest()
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

  it('本机写失败时广播 storage-error，不静默丢学习记录', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onError = vi.fn()
    window.addEventListener(STORAGE_ERROR_EVENT, onError)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    markLearningDirty()
    writeLearningToLocalStorage(emptyLearning())

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { key: 'reader:learningDirty' } }),
    )
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ detail: { key: 'reader:practice' } }))
    window.removeEventListener(STORAGE_ERROR_EVENT, onError)
  })

  it('没有待同步修改时，启动以服务端为准，覆盖过期缓存', async () => {
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

    expect(JSON.parse(localStorage.getItem('reader:practice')!)[0].at).toBe('2026-01-01T00:00:00.000Z')
    expect(localStorage.getItem('reader:mistakes')).toContain('vocab:w1')
  })

  it('本地有待同步修改时，启动保留本地并只补缺失键', async () => {
    localStorage.setItem('reader:practice', JSON.stringify([
      { at: '2026-02-01T00:00:00.000Z', kind: 'quiz', total: 1, correct: 1 },
    ]))
    markLearningDirty()
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
    expect(hasPendingLearningChanges()).toBe(true)
  })

  it('还没问过服务端时，不拿空数据覆盖服务端', async () => {
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    await expect(syncLearningToServer()).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('问过服务端后，用户清空记录会同步空记录', async () => {
    vi.spyOn(learningRepo, 'load').mockResolvedValue(emptyLearning())
    await hydrateLearningFromServer()
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    await expect(syncLearningToServer()).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ practice: [] }))
  })

  it('按 section 增量同步：只提交变化的表，不整份重写', async () => {
    vi.spyOn(learningRepo, 'load').mockResolvedValue(emptyLearning())
    await hydrateLearningFromServer()
    localStorage.setItem(
      'reader:practice',
      JSON.stringify([{ at: '2026-03-01T00:00:00.000Z', kind: 'quiz', total: 10, correct: 9 }]),
    )
    const save = vi.spyOn(learningRepo, 'save').mockResolvedValue()
    const partial = vi.spyOn(learningRepo, 'savePartial').mockResolvedValue()

    await expect(syncLearningToServer(['practice'])).resolves.toBe(true)

    expect(save).not.toHaveBeenCalled()
    expect(partial).toHaveBeenCalledWith(expect.objectContaining({ practice: [
      expect.objectContaining({ kind: 'quiz', correct: 9 }),
    ] }))
  })

  it('写回成功才清 dirty；失败保留，下次还会重试', async () => {
    vi.spyOn(learningRepo, 'load').mockResolvedValue(emptyLearning())
    await hydrateLearningFromServer()
    localStorage.setItem(
      'reader:practice',
      JSON.stringify([{ at: '2026-04-01T00:00:00.000Z', kind: 'quiz', total: 5, correct: 4 }]),
    )
    markLearningDirty()

    vi.spyOn(learningRepo, 'save').mockResolvedValue()
    await expect(syncLearningToServer()).resolves.toBe(true)
    expect(hasPendingLearningChanges()).toBe(false)

    markLearningDirty()
    vi.spyOn(learningRepo, 'save').mockRejectedValue(new Error('offline'))
    await expect(syncLearningToServer()).resolves.toBe(false)
    expect(hasPendingLearningChanges()).toBe(true)
  })

  it('localStorage 键能映射到 section', () => {
    expect(learningSectionForKey('reader:practice')).toBe('practice')
    expect(learningSectionForKey('reader:intensiveSkimmed')).toBe('skimmed')
    expect(learningSectionForKey('reader:theme')).toBeNull()
  })
})
