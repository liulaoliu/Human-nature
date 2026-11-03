// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GoldenLangPointAnswer from './GoldenLangPointAnswer'
import type { GoldenLangPointApi } from '../../hooks/useGoldenLangPoint'
import type { WritingRecord } from '../../../core/writing'

/** 一条「语言点造句」的批改记录（同篇同句同 focus）。 */
function rec(at: string, text: string, over: Partial<WritingRecord> = {}): WritingRecord {
  return {
    at,
    articleId: 'a1',
    articleTitle: 'A',
    model: 'We keep up with the news.',
    text,
    feedback: { scores: [], total: 8, max: 10, issues: [], summary: '还行' },
    task: { task: '用 keep up with 写一句', model: 'We keep up with the news.', mustUse: ['keep up with'], rubric: [], focus: 'keep up with' },
    source: 'goldenSentence',
    sentenceId: 's1',
    ...over,
  }
}

function api(writingHistory: WritingRecord[]): GoldenLangPointApi {
  return {
    choices: [{ en: 'keep up with', zh: '跟上', done: writingHistory.length > 0 }],
    selected: ['keep up with'],
    toggle: vi.fn(),
    sentence: { id: 's1', text: 'We keep up with the news.' },
    articleId: 'a1',
    articleTitle: 'A',
    writingHistory,
    setWritingHistory: vi.fn(),
    flash: vi.fn(),
    recordActivity: vi.fn(),
  }
}

const point = { en: 'keep up with', zh: '跟上', done: false }

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('语言点造句框：接上批改历史', () => {
  it('同一题有 2 次批改时能翻页（上一次 / 下一次）', () => {
    render(
      <GoldenLangPointAnswer
        point={point}
        index={0}
        api={api([rec('2026-10-29T10:00:00.000Z', 'I keep up with it.'), rec('2026-10-30T10:00:00.000Z', 'She keeps up with us.')])}
        showZh
      />,
    )
    // 翻页条只在有 2 次以上批改时出现；之前没把 writingHistory 传下去，这里恒为空。
    expect(screen.getByRole('button', { name: /上一次/ })).toBeTruthy()
    expect(screen.getByText(/第 2\/2 次批改/)).toBeTruthy()
  })

  it('只有 1 次批改 / 没有记录时不显示翻页条', () => {
    const { unmount } = render(
      <GoldenLangPointAnswer
        point={point}
        index={0}
        api={api([rec('2026-10-29T10:00:00.000Z', 'I keep up with it.')])}
        showZh
      />,
    )
    expect(screen.queryByRole('button', { name: /上一次/ })).toBeNull()
    unmount()
    render(<GoldenLangPointAnswer point={point} index={0} api={api([])} showZh />)
    expect(screen.queryByRole('button', { name: /上一次/ })).toBeNull()
  })

  it('复制批改提示词展开粘贴框，应用成功后收起', async () => {
    render(<GoldenLangPointAnswer point={point} index={0} api={api([])} showZh />)
    const box = document.querySelector('details.golden-exam-paste') as HTMLDetailsElement
    expect(box.open).toBe(false)

    fireEvent.change(screen.getByPlaceholderText(/写一句新的英文/), {
      target: { value: 'I keep up with the news.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '复制批改提示词' }))
    await waitFor(() => expect(box.open).toBe(true))

    fireEvent.change(screen.getByPlaceholderText(/scores/), {
      target: {
        value: JSON.stringify({
          scores: [{ dimension: '词块使用', score: 45, max: 50 }],
          issues: [],
          summary: 'OK',
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(box.open).toBe(false))
  })
})
