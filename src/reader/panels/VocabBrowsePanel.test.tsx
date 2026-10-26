// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { dayKeyLocal } from '../../core/activity'
import { vocabItem } from '../../core/testFixtures'
import { defaultReviewState } from '../../types/document'
import type { ArticleVocabEntry } from '../../types/document'
import VocabBrowsePanel, { type VocabBrowsePanelProps } from './VocabBrowsePanel'

vi.mock('../VocabList', () => ({
  default: ({ items, numberOf }: { items: { id: string; lemma: string }[]; numberOf?: (it: never) => number | null }) => (
    <div data-testid="vocab-list">
      {items.map((it) => {
        const n = numberOf?.(it as never)
        return (
          <span key={it.id} data-testid={`lemma-${it.lemma}`}>
            {it.lemma}
            {n != null ? `#${n}` : ''}
          </span>
        )
      })}
    </div>
  ),
}))

const at = (m: number, d: number) => new Date(2026, m - 1, d, 12).toISOString()

const alpha = vocabItem({ id: 'v-alpha', word: 'alpha', lemma: 'alpha', meaning: '阿尔法', createdAt: at(10, 1) })
const beta = vocabItem({ id: 'v-beta', word: 'beta', lemma: 'beta', note: '希腊字母', createdAt: at(10, 2) })
const done = vocabItem({ id: 'v-done', word: 'done', lemma: 'done', status: 'mastered', createdAt: at(10, 2) })
const take = vocabItem({
  id: 'v-take',
  word: 'take off',
  lemma: 'take off',
  kind: 'phrase',
  meaning: '起飞',
  createdAt: at(10, 3),
  reviewState: { ...defaultReviewState(), lapses: 1 },
})

const items = [alpha, beta, done, take]
const entry = (articleId: string, lemma: string): ArticleVocabEntry => ({
  articleId,
  lemma,
  origin: 'manual',
  addedAt: '2026-10-01T00:00:00.000Z',
})
const entries = [
  entry('A', 'alpha'),
  entry('A', 'take off'),
  entry('A', 'done'),
  entry('B', 'beta'),
]
const articles = [
  { id: 'A', title: 'A 篇' },
  { id: 'B', title: 'B 篇' },
]

function setup(over: Partial<VocabBrowsePanelProps> = {}) {
  const onClose = vi.fn()
  const onExportAnki = vi.fn()
  const onPrint = vi.fn()
  const onPrintRows = vi.fn()
  const onExportWrong = vi.fn()
  render(
    <VocabBrowsePanel
      initialScope="all"
      onClose={onClose}
      libraryItems={items}
      articleEntries={entries}
      articleId="A"
      articleTitle="A 篇"
      articles={articles}
      articleNums={new Map([['alpha', 1]])}
      meaningOf={() => '阿尔法'}
      view="card"
      onViewChange={vi.fn()}
      sortBy="word"
      onSortChange={vi.fn()}
      focusLemma={null}
      confirmDel={null}
      onSpeak={vi.fn()}
      onDelete={vi.fn()}
      onReview={vi.fn()}
      onEdit={vi.fn()}
      onExportAnki={onExportAnki}
      onPrint={onPrint}
      onPrintRows={onPrintRows}
      onExportWrong={onExportWrong}
      {...over}
    />,
  )
  return { onClose, onExportAnki, onPrint, onPrintRows, onExportWrong }
}

const listed = () =>
  [...document.querySelectorAll('[data-testid^="lemma-"]')].map((el) => el.getAttribute('data-testid')!.slice(6))

const select = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

/** 打开日期下拉，勾一天（多选由调用方连点）。 */
const pickDay = (day: string) => {
  const box = screen.getByTestId('vb-days') as HTMLDetailsElement
  if (!box.open) fireEvent.click(box.querySelector('summary')!)
  fireEvent.click(within(box).getByRole('checkbox', { name: new RegExp(day) }))
}

describe('VocabBrowsePanel：范围', () => {
  it('全部：默认含已掌握，标题和计数对', () => {
    setup()
    expect(screen.getByText('全部生词')).toBeTruthy()
    expect(screen.getByText('4 / 4 条')).toBeTruthy()
    expect(listed()).toEqual(['alpha', 'beta', 'done', 'take off'])
  })

  it('本篇：只显示按篇收录、默认不含已掌握；编号用篇内编号', () => {
    setup({ initialScope: 'article' })
    expect(screen.getByText('本篇生词')).toBeTruthy()
    expect(listed()).toEqual(['alpha', 'take off'])
    expect(screen.getByTestId('lemma-alpha').textContent).toBe('alpha#1')
  })

  it('本篇勾「含已掌握」：mastered 也出来', () => {
    setup({ initialScope: 'article' })
    fireEvent.click(screen.getByLabelText(/含已掌握/))
    expect(listed()).toContain('done')
  })

  it('按文章：只并勾选的篇（默认全选），计数跟着筛选', () => {
    setup({ initialScope: 'article' })
    select(/范围/, 'picked')
    // 切到选篇后默认不含已掌握
    expect(listed()).toEqual(['alpha', 'beta', 'take off'])
    fireEvent.click(screen.getByLabelText(/A 篇/))
    expect(listed()).toEqual(['beta'])
    expect(screen.getByText('已选 1 篇')).toBeTruthy()
  })

  it('范围切回本篇：只留当前文章的条目', () => {
    setup()
    select(/范围/, 'article')
    expect(screen.getByText('本篇生词')).toBeTruthy()
    expect(listed()).toEqual(['alpha', 'take off'])
  })

  it('深链接本篇但文章没加载：退回全部，不停在空界面', () => {
    setup({ initialScope: 'article', articleId: '' })
    expect(screen.getByText('全部生词')).toBeTruthy()
    expect(listed()).toHaveLength(4)
  })
})

describe('VocabBrowsePanel：筛选', () => {
  it('类型：语言点只留词组 / 习语 / 用法', () => {
    setup()
    select(/类型/, 'lang')
    expect(listed()).toEqual(['take off'])
  })

  it('搜索：词形 / 释义 / 笔记', () => {
    setup()
    fireEvent.change(screen.getByLabelText('搜索生词'), { target: { value: '希腊' } })
    expect(listed()).toEqual(['beta'])
    fireEvent.change(screen.getByLabelText('搜索生词'), { target: { value: 'ALPHA' } })
    expect(listed()).toEqual(['alpha'])
  })

  it('日期：按入库日筛，可多选（04:00 结算由 core 测）', () => {
    setup()
    const d1 = dayKeyLocal(new Date(alpha.createdAt))
    const d2 = dayKeyLocal(new Date(beta.createdAt))
    pickDay(d1)
    expect(listed()).toEqual(['alpha'])
    pickDay(d2)
    expect(listed()).toEqual(['alpha', 'beta', 'done'])
  })

  it('状态：新词 / 错过 / 已掌握', () => {
    setup()
    select(/状态/, 'fresh')
    expect(listed()).toEqual(['alpha', 'beta', 'take off'])
    select(/状态/, 'lapsed')
    expect(listed()).toEqual(['take off'])
    select(/状态/, 'mastered')
    expect(listed()).toEqual(['done'])
  })

  it('没有结果时给空态，清空筛选恢复', () => {
    setup()
    fireEvent.change(screen.getByLabelText('搜索生词'), { target: { value: 'zzz' } })
    expect(screen.getByText(/没有符合条件的生词/)).toBeTruthy()
    fireEvent.click(screen.getByText('清空筛选'))
    expect(listed()).toHaveLength(4)
  })
})

describe('VocabBrowsePanel：批量动作跟着筛选走', () => {
  it('Anki / 错词只用当前筛选结果', () => {
    const { onExportAnki, onExportWrong } = setup()
    select(/类型/, 'lang')
    fireEvent.click(screen.getByText(/Anki CSV/))
    expect(onExportAnki).toHaveBeenCalledWith([take], '全部生词')
    fireEvent.click(screen.getByText('导出错词'))
    expect(onExportWrong).toHaveBeenCalledWith([take])
  })

  it('本篇 A4：走按篇行（编号 + 语境释义），不拿整库', () => {
    const { onPrint, onPrintRows } = setup({ initialScope: 'article' })
    fireEvent.click(screen.getByText(/A4 打印/))
    expect(onPrint).not.toHaveBeenCalled()
    expect(onPrintRows).toHaveBeenCalledWith(
      [
        expect.objectContaining({ articleId: 'A', articleTitle: 'A 篇', number: 1, meaning: '阿尔法' }),
        expect.objectContaining({ item: expect.objectContaining({ id: 'v-take' }), articleId: 'A', number: null }),
      ],
      '本篇生词',
    )
  })

  it('选篇 A4：按篇出行（各篇编号），走 onPrintRows 而不是整库打印', () => {
    const { onPrintRows, onPrint } = setup({ initialScope: 'article' })
    select(/范围/, 'picked')
    fireEvent.click(screen.getByText(/A4 打印/))
    expect(onPrint).not.toHaveBeenCalled()
    const [rows, title] = onPrintRows.mock.calls[0]
    expect(title).toBe('所选 2 篇生词')
    expect(rows.map((r: { articleTitle: string; item: { lemma: string }; number: number | null }) => [
      r.articleTitle,
      r.item.lemma,
      r.number,
    ])).toEqual([
      ['A 篇', 'alpha', 1],
      ['A 篇', 'take off', null],
      ['B 篇', 'beta', 1],
    ])
  })

  it('本篇导出用这篇的语境释义（和侧栏 / A4 一致）', () => {
    const { onExportAnki } = setup({ initialScope: 'article' })
    fireEvent.click(screen.getByText(/Anki CSV/))
    const [items] = onExportAnki.mock.calls[0]
    expect(items.find((it: { lemma: string }) => it.lemma === 'take off').meaning).toBe('阿尔法')
  })

  it('全部 A4：走普通打印，标题=当前范围', () => {
    const { onPrint, onPrintRows } = setup()
    fireEvent.click(screen.getByText(/A4 打印/))
    expect(onPrintRows).not.toHaveBeenCalled()
    expect(onPrint).toHaveBeenCalledWith(items, '全部生词')
  })
})
