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

  it('六个专用任务各走自己的 handler（表驱动，防止映射写错）', () => {
    const cases: [string, string, string][] = [
      ['auto_vocab', '!!!', '没解析出单词'],
      ['golden', '{}', '先打开一篇文章'],
      ['listening', '{}', '没解析出题目'],
      ['language', '{}', '没解析出语言点'],
      ['imitation', '{}', '没解析出仿写任务'],
      ['feedback', '{}', '没解析出批改结果'],
    ]
    for (const [task, raw, expected] of cases) {
      const params = makeParams()
      const apply = createApplyTaskResult(params)
      const out = apply(task as never, raw, [], [])
      expect(out.report.join(' '), task).toContain(expected)
    }
  })

  it('切篇后拒绝应用：s001 只能写回复制提示词时的那篇', () => {
    const params = { ...makeParams(), articleKey: 'saved:B' }
    const apply = createApplyTaskResult(params)
    const raw = '{"sentences":[{"id":"s001","translation":"缅甸新政府…"}]}'
    const out = apply(null, raw, [], ['s001'], { articleKey: 'saved:A' })
    expect(out.ok).toBe(false)
    expect(out.report[0]).toContain('文章已切换')
    expect(params.setDoc).not.toHaveBeenCalled()
    expect(params.setPendingSave).not.toHaveBeenCalled()
  })

  it('同一篇文章正常写回；没带 articleKey 的旧调用保持兼容', () => {
    const params = { ...makeParams(), articleKey: 'saved:B' }
    const apply = createApplyTaskResult(params)
    const raw = '{"sentences":[{"id":"s001","translation":"译文"}]}'
    expect(apply(null, raw, [], ['s001'], { articleKey: 'saved:B' }).ok).toBe(true)
    expect(params.setDoc).toHaveBeenCalled()
  })
})
