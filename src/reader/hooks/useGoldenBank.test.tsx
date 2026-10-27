// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildLocalGoldenLesson } from '../../core/golden'
import type { ReaderDoc } from './useReaderDoc'
import type { SavedArticle, Sentence } from '../../types/document'
import { useGoldenBank } from './useGoldenBank'

const sentence: Sentence = {
  id: 's1',
  paraId: 'p01',
  text: 'In response to the pandemic, remote collaboration has become the new norm.',
  audio: null,
  translation: '为了应对疫情，远程协作已经成为新常态。',
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  language: { phrases: ['in response to — 为了应对'] },
}

const saved: SavedArticle = {
  id: 'a1',
  title: '旧标题',
  sourceKey: null,
  text: sentence.text,
  paragraphs: [{ id: 'p01', sentenceIds: ['s1'] }],
  sentences: [sentence],
  golden: buildLocalGoldenLesson([sentence], undefined, { selected: ['s1'] }),
  updatedAt: '2026-10-27T00:00:00.000Z',
}

const doc: ReaderDoc = {
  paragraphs: [{ id: 'p01', sentenceIds: ['s1'] }],
  sentences: [sentence],
  golden: buildLocalGoldenLesson([sentence], undefined, { selected: ['s1'] }),
}

describe('useGoldenBank', () => {
  it('当前文章覆盖存档里的旧标题，并只读摊平', () => {
    const { result } = renderHook(() =>
      useGoldenBank({
        saved: [saved],
        savedId: 'a1',
        articleKey: 'a1@x',
        articleTitle: '新标题',
        articleIdentity: 'a1@x',
        doc,
        lesson: doc.golden ?? null,
        records: [],
        download: vi.fn(),
        flash: vi.fn(),
      }),
    )
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].articleTitle).toBe('新标题')
    expect(result.current.rows[0].text).toContain('remote collaboration')
  })

  it('导出 / 打印走注入的动作，不直接碰存储', () => {
    const download = vi.fn()
    const write = vi.fn()
    const close = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({
      document: { write, close, title: '' },
    } as unknown as Window)
    const { result } = renderHook(() =>
      useGoldenBank({
        saved: [saved],
        savedId: 'a1',
        articleKey: 'a1@x',
        articleTitle: 'A',
        articleIdentity: 'a1@x',
        doc,
        lesson: doc.golden ?? null,
        records: [],
        download,
        flash: vi.fn(),
      }),
    )
    act(() => result.current.exportMarkdown())
    expect(download).toHaveBeenCalledWith('全库金句本.md', expect.stringContaining('全库金句本'), 'text/markdown;charset=utf-8')
    act(() => result.current.exportAnki())
    expect(download).toHaveBeenCalledWith('全库金句本-anki.csv', expect.stringContaining('Front,Back,Tags'), 'text/csv;charset=utf-8')
    act(() => result.current.printBank())
    expect(open).toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(expect.stringContaining('remote collaboration'))
    open.mockRestore()
  })
})
