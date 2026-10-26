// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ReaderOverlaysHost, { type ReaderOverlaysHostProps } from './ReaderOverlaysHost'
import { vocabItem } from '../core/testFixtures'

const captures = vi.hoisted(() => ({
  speed: null as Record<string, unknown> | null,
  plan: null as Record<string, unknown> | null,
  intensive: null as Record<string, unknown> | null,
  goal: null as Record<string, unknown> | null,
}))

vi.mock('./panels/SpeedReadPanel', () => ({
  default: (props: Record<string, unknown>) => {
    captures.speed = props
    return <div data-testid="speed" />
  },
}))
vi.mock('./panels/LanguageEditor', () => ({ default: () => <div data-testid="lang" /> }))
vi.mock('./panels/PlanPanel', () => ({
  default: (props: Record<string, unknown>) => {
    captures.plan = props
    return <div data-testid="plan" />
  },
}))
vi.mock('./panels/IntensivePanel', () => ({
  default: (props: Record<string, unknown>) => {
    captures.intensive = props
    return <div data-testid="intensive" />
  },
}))
vi.mock('./panels/GoalPanel', () => ({
  default: (props: Record<string, unknown>) => {
    captures.goal = props
    return <div data-testid="goal" />
  },
}))
vi.mock('./panels/ExportPanel', () => ({ default: () => <div data-testid="export" /> }))
vi.mock('./panels/JournalPanel', () => ({ default: () => <div data-testid="journal" /> }))
vi.mock('./VocabList', () => ({
  default: () => <div data-testid="vocab-list" />,
}))

const noop = () => {}
const item = (over = {}) => vocabItem({ id: 'v1', word: 'run', lemma: 'run', ...over })

function props(over: Partial<ReaderOverlaysHostProps> = {}): ReaderOverlaysHostProps {
  return {
    speed: { open: false } as ReaderOverlaysHostProps['speed'],
    lang: { open: false } as ReaderOverlaysHostProps['lang'],
    plan: { open: false } as ReaderOverlaysHostProps['plan'],
    intensive: { open: false } as ReaderOverlaysHostProps['intensive'],
    goal: { open: false } as ReaderOverlaysHostProps['goal'],
    exporter: { open: false } as ReaderOverlaysHostProps['exporter'],
    journal: { open: false } as ReaderOverlaysHostProps['journal'],
    allVocab: {
      open: false,
      initialScope: 'all',
      libraryItems: [],
      articleEntries: [],
      articleId: '',
      articleTitle: '',
      articles: [],
      articleNums: new Map(),
      meaningOf: () => null,
      view: 'card',
      onViewChange: noop,
      sortBy: 'updatedAt',
      onSortChange: noop,
      focusLemma: null,
      confirmDel: null,
      onSpeak: noop,
      onDelete: noop,
      onReview: noop,
      onEdit: noop,
      onClose: noop,
      onExportAnki: noop,
      onPrint: noop,
      onPrintRows: noop,
      onExportWrong: noop,
    },
    ...over,
  }
}

describe('ReaderOverlaysHost：面板路由', () => {
  it('全部关着时一个面板都不渲染', () => {
    const { container } = render(<ReaderOverlaysHost {...props()} />)
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(0)
  })

  it('开关打开才渲染，面板 props 原样转发', async () => {
    const onAddItems = vi.fn()
    const onStartStudy = vi.fn()
    render(
      <ReaderOverlaysHost
        {...props({
          speed: { open: true, onAddItems } as unknown as ReaderOverlaysHostProps['speed'],
          lang: { open: true } as ReaderOverlaysHostProps['lang'],
          plan: { open: true, onStartStudy } as unknown as ReaderOverlaysHostProps['plan'],
          intensive: { open: true } as ReaderOverlaysHostProps['intensive'],
          goal: { open: true } as ReaderOverlaysHostProps['goal'],
          exporter: { open: true } as ReaderOverlaysHostProps['exporter'],
          journal: { open: true } as ReaderOverlaysHostProps['journal'],
        })}
      />,
    )
    // 面板是 `lazy()`（首屏不加载），所以这里是异步出现，必须 findBy*。
    for (const id of ['speed', 'lang', 'plan', 'intensive', 'goal', 'export', 'journal']) {
      expect(await screen.findByTestId(id)).toBeTruthy()
    }
    expect(captures.speed?.onAddItems).toBe(onAddItems)
    expect(captures.plan?.onStartStudy).toBe(onStartStudy)
  })

  it('包围战 / 目标的回调也原样转发', async () => {
    const onSiege = vi.fn()
    const onMarkDone = vi.fn()
    render(
      <ReaderOverlaysHost
        {...props({
          intensive: { open: true, onSiege } as unknown as ReaderOverlaysHostProps['intensive'],
          goal: { open: true, onMarkDone } as unknown as ReaderOverlaysHostProps['goal'],
        })}
      />,
    )
    await screen.findByTestId('intensive')
    await screen.findByTestId('goal')
    expect(captures.intensive?.onSiege).toBe(onSiege)
    expect(captures.goal?.onMarkDone).toBe(onMarkDone)
  })
})

describe('ReaderOverlaysHost：生词浏览', () => {
  it('显示数量；卡片 / 表格切换调 onViewChange', async () => {
    const onViewChange = vi.fn()
    render(
      <ReaderOverlaysHost
        {...props({
          allVocab: { ...props().allVocab, open: true, libraryItems: [item(), item({ id: 'v2' })], onViewChange },
        })}
      />,
    )
    expect(await screen.findByText('全部生词')).toBeTruthy()
    expect(screen.getByText('2 / 2 条')).toBeTruthy()
    fireEvent.click(screen.getByText('表格'))
    expect(onViewChange).toHaveBeenCalledWith('table')
    fireEvent.click(screen.getByText('卡片'))
    expect(onViewChange).toHaveBeenCalledWith('card')
  })

  it('有词时可导出 / 打印；没有错词时「导出错词」禁用', async () => {
    const onExportAnki = vi.fn()
    const onPrint = vi.fn()
    render(
      <ReaderOverlaysHost
        {...props({
          allVocab: { ...props().allVocab, open: true, libraryItems: [item()], onExportAnki, onPrint },
        })}
      />,
    )
    expect(await screen.findByText(/Anki CSV/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Anki CSV/))
    expect(onExportAnki).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText(/A4 打印/))
    expect(onPrint).toHaveBeenCalledWith(expect.any(Array), '全部生词')
    expect((screen.getByText('导出错词') as HTMLButtonElement).disabled).toBe(true)
  })

  it('空库时给空态，关闭按钮可用', async () => {
    const onClose = vi.fn()
    render(<ReaderOverlaysHost {...props({ allVocab: { ...props().allVocab, open: true, onClose } })} />)
    expect(await screen.findByText(/没有符合条件的生词/)).toBeTruthy()
    expect(screen.queryByTestId('vocab-list')).toBeNull()
    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('本篇入口：首屏范围是本篇，A4 走按篇行（带编号）', async () => {
    const onPrintRows = vi.fn()
    const articleItems = [item({ id: 'v-run', word: 'run', lemma: 'run' })]
    render(
      <ReaderOverlaysHost
        {...props({
          allVocab: {
            ...props().allVocab,
            open: true,
            initialScope: 'article',
            articleId: 'A',
            articleTitle: 'A 篇',
            libraryItems: articleItems,
            articleEntries: [{ articleId: 'A', lemma: 'run', origin: 'manual', addedAt: '2026-10-01T00:00:00.000Z' }],
            articleNums: new Map([['run', 1]]),
            meaningOf: () => '跑',
            onPrintRows,
          },
        })}
      />,
    )
    expect(await screen.findByText('本篇生词')).toBeTruthy()
    fireEvent.click(screen.getByText(/A4 打印/))
    expect(onPrintRows).toHaveBeenCalledWith(
      [expect.objectContaining({ articleId: 'A', articleTitle: 'A 篇', number: 1, meaning: '跑' })],
      '本篇生词',
    )
  })
})
