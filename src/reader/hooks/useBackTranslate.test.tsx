// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBackTranslate } from './useBackTranslate'
import type { ReaderDoc } from './useReaderDoc'
import type { BackTranslationRecord } from '../../core/backTranslate'

const feedbackRaw = JSON.stringify({
  scores: [
    { dimension: '意思还原', score: 36, max: 40 },
    { dimension: '语法', score: 27, max: 30 },
    { dimension: '用词与搭配', score: 16, max: 20 },
    { dimension: '连贯简洁', score: 9, max: 10 },
  ],
  issues: [
    { original: 'Rachman', suggestion: 'Rahman', reason: '音译差异', type: 'properNoun', deduct: false },
  ],
  polished: 'He went to school.',
  alternatives: ['He attended school.'],
  summary: '注意专名。',
})

const doc = {
  paragraphs: [{ id: 'p1', sentenceIds: ['s1', 's2', 's3'] }],
  sentences: [
    { id: 's1', paraId: 'p1', text: 'He went to school.', translation: '他去了学校。' },
    { id: 's2', paraId: 'p1', text: 'No translation here.' },
    { id: 's3', paraId: 'p1', text: 'She reads books.', translation: '她读书。' },
  ],
} as unknown as ReaderDoc

function params(over: Partial<Parameters<typeof useBackTranslate>[0]> = {}) {
  return {
    doc,
    selectedId: 's1',
    articleIdentity: 'a1',
    articleTitle: 'A Day',
    history: [] as BackTranslationRecord[],
    saveRecord: vi.fn(),
    recordActivity: vi.fn(),
    flash: vi.fn(),
    closeOthers: vi.fn(),
    aiStatus: vi.fn(async () => true),
    runAi: vi.fn(async () => ({ results: [{ id: 'x', raw: feedbackRaw }], failed: [], dropped: 0 })),
    now: () => new Date('2026-10-26T00:00:00.000Z'),
    ...over,
  }
}

function stubClipboard() {
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => vi.restoreAllMocks())

describe('useBackTranslate：出题', () => {
  it('没有译文的文章不开会话，并提示先补译文', () => {
    const flash = vi.fn()
    const { result } = renderHook(() =>
      useBackTranslate(params({ doc: { ...doc, sentences: [doc.sentences[1]] }, flash })),
    )
    act(() => result.current.start())
    expect(result.current.open).toBe(false)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('全文翻译'))
  })

  it('没有文档但有历史存档时仍能打开，只用于回看', () => {
    const rec: BackTranslationRecord = {
      id: 'r1',
      at: '2026-10-20T00:00:00.000Z',
      articleId: 'old',
      sentenceId: 's1',
      sourceZh: '旧句子。',
      answer: 'Old sentence.',
      reference: 'Old sentence.',
      feedback: { scores: [], total: 0, max: 0, issues: [], alternatives: [] },
      closeness: { exact: true, ratio: 1 },
    }
    const { result } = renderHook(() => useBackTranslate(params({ doc: null, history: [rec] })))
    act(() => result.current.start())
    expect(result.current.open).toBe(true)
    expect(result.current.current).toBeNull()
    expect(result.current.history).toHaveLength(1)
  })

  it('只出有译文的句子；从当前选中句开始，上下句切换会清空作答', () => {
    const { result } = renderHook(() => useBackTranslate(params()))
    act(() => result.current.start())
    expect(result.current.open).toBe(true)
    expect(result.current.queueLength).toBe(2)
    expect(result.current.sourceZh).toBe('他去了学校。')
    expect(result.current.contextZh).toBeUndefined()

    act(() => result.current.setAnswer('He went to school.'))
    act(() => result.current.next())
    expect(result.current.sourceZh).toBe('她读书。')
    expect(result.current.contextZh).toBeUndefined() // 上一句没译文，不硬塞
    expect(result.current.answer).toBe('')
  })
})

describe('useBackTranslate：批改与存档', () => {
  it('本机直连：解析 → 追加存档 → 记活动；专名提示不计分', async () => {
    const saveRecord = vi.fn()
    const recordActivity = vi.fn()
    const { result } = renderHook(() => useBackTranslate(params({ saveRecord, recordActivity })))
    act(() => result.current.start())
    act(() => result.current.setAnswer('He went to school.'))

    await act(async () => {
      await result.current.grade()
    })

    await waitFor(() => expect(saveRecord).toHaveBeenCalledTimes(1))
    const rec = saveRecord.mock.calls[0][0] as BackTranslationRecord
    expect(rec).toMatchObject({
      articleId: 'a1',
      sentenceId: 's1',
      sourceZh: '他去了学校。',
      answer: 'He went to school.',
      reference: 'He went to school.',
      gradedBy: 'local',
    })
    expect(rec.closeness.exact).toBe(true)
    expect(rec.feedback.issues[0]).toMatchObject({ type: 'properNoun', deduct: false })
    expect(recordActivity).toHaveBeenCalledWith('write', 1)
    expect(result.current.feedback?.total).toBe(88)
    expect(result.current.gradedAnswer).toBe('He went to school.')
  })

  it('没配 key：复制提示词并打开粘贴框，不落库', async () => {
    const writeText = stubClipboard()
    const saveRecord = vi.fn()
    const { result } = renderHook(() =>
      useBackTranslate(params({ saveRecord, aiStatus: vi.fn(async () => false) })),
    )
    act(() => result.current.start())
    act(() => result.current.setAnswer('He went to school.'))

    await act(async () => {
      await result.current.grade()
    })

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('他去了学校。'))
    expect(result.current.manualOpen).toBe(true)
    expect(result.current.grading).toBe(false)
    expect(saveRecord).not.toHaveBeenCalled()
  })

  it('粘贴兜底：坏 JSON 报错不落库；好 JSON 落库并标 manual', () => {
    const saveRecord = vi.fn()
    const { result } = renderHook(() =>
      useBackTranslate(params({ saveRecord, aiStatus: vi.fn(async () => false) })),
    )
    act(() => result.current.start())
    act(() => result.current.setAnswer('He went to school.'))

    act(() => result.current.setManualText('not json'))
    act(() => result.current.applyManual())
    expect(result.current.error).toContain('没解析出批改结果')
    expect(saveRecord).not.toHaveBeenCalled()

    act(() => result.current.setManualText(feedbackRaw))
    act(() => result.current.applyManual())
    expect(saveRecord).toHaveBeenCalledTimes(1)
    expect((saveRecord.mock.calls[0][0] as BackTranslationRecord).gradedBy).toBe('manual')
  })

  it('历史记录只在同句时载入作答，跨文章不硬塞', () => {
    const rec: BackTranslationRecord = {
      id: 'r1',
      at: '2026-10-20T00:00:00.000Z',
      articleId: 'a1',
      sentenceId: 's3',
      sourceZh: '她读书。',
      answer: 'She reads books.',
      reference: 'She reads books.',
      feedback: { scores: [], total: 0, max: 0, issues: [], alternatives: [] },
      closeness: { exact: true, ratio: 1 },
    }
    const flash = vi.fn()
    const { result } = renderHook(() => useBackTranslate(params({ flash })))
    act(() => result.current.start())
    let loaded = false
    act(() => {
      loaded = result.current.loadHistory(rec)
    })
    expect(loaded).toBe(true)
    expect(result.current.sourceZh).toBe('她读书。')
    expect(result.current.answer).toBe('She reads books.')

    let other = true
    act(() => {
      other = result.current.loadHistory({ ...rec, id: 'r2', sentenceId: 'nope' })
    })
    expect(other).toBe(false)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('另一篇'))
  })
})
