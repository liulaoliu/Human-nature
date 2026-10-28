// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../../core/vocab'
import { createApplyTaskResult } from './createApplyTaskResult'
import type { ApplyTaskParams } from './types'

function makeParams(): ApplyTaskParams {
  const library = createLibrary()
  return {
    library,
    libraryRef: { current: library },
    sentence: null,
    persist: vi.fn(),
    mergeBatch: vi.fn(),
    batchItemsFromWords: () => [],
    autoVocabDirect: false,
    commitBatchItems: vi.fn(),
    articleTitle: '',
    articleKey: null,
    articleIdentity: '',
    listeningKey: '',
    writingModel: '',
    writingText: '',
    writingTask: null,
    recordActivity: vi.fn(),
    ecdictLevel: 'cet6',
    articleText: '',
    sentenceForWord: () => ({ sentence: '', sentenceId: null }),
    setDoc: vi.fn(),
    setPendingSave: vi.fn(),
    setListenQuiz: vi.fn(),
    setWritingTask: vi.fn(),
    setWritingFeedback: vi.fn(),
    setWritingHistory: vi.fn(),
  }
}

describe('createApplyTaskResult：普通 factory', () => {
  it('空输入直接失败，不写库、不碰 UI', () => {
    const params = makeParams()
    const apply = createApplyTaskResult(params)
    expect(apply(null, '   ', [], [])).toEqual({ report: [], missing: null, ok: false })
    expect(params.persist).not.toHaveBeenCalled()
    expect(params.setDoc).not.toHaveBeenCalled()
  })

  it('表格型任务走 core/aiApply，并提交新词库', () => {
    const params = makeParams()
    const apply = createApplyTaskResult(params)
    const outcome = apply('lemma', 'running | run', [], [])
    expect(outcome.ok).toBe(true)
    expect(outcome.report.join(' ')).toContain('词形')
    expect(params.persist).toHaveBeenCalled()
  })
})
