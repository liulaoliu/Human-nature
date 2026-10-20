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
      items: [],
      list: [],
      view: 'card',
      onViewChange: noop,
      focusLemma: null,
      confirmDel: null,
      onSpeak: noop,
      onDelete: noop,
      onReview: noop,
      onEdit: noop,
      onClose: noop,
      onExportAnki: noop,
      onPrint: noop,
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

  it('开关打开才渲染，面板 props 原样转发', () => {
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
    for (const id of ['speed', 'lang', 'plan', 'intensive', 'goal', 'export', 'journal']) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
    expect(captures.speed?.onAddItems).toBe(onAddItems)
    expect(captures.plan?.onStartStudy).toBe(onStartStudy)
  })

  it('包围战 / 目标的回调也原样转发', () => {
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
    expect(captures.intensive?.onSiege).toBe(onSiege)
    expect(captures.goal?.onMarkDone).toBe(onMarkDone)
  })
})

describe('ReaderOverlaysHost：全部生词', () => {
  it('显示数量；卡片 / 表格切换调 onViewChange', () => {
    const onViewChange = vi.fn()
    render(
      <ReaderOverlaysHost
        {...props({ allVocab: { ...props().allVocab, open: true, items: [item(), item({ id: 'v2' })], onViewChange } })}
      />,
    )
    expect(screen.getByText('全部生词（2）')).toBeTruthy()
    fireEvent.click(screen.getByText('表格'))
    expect(onViewChange).toHaveBeenCalledWith('table')
    fireEvent.click(screen.getByText('卡片'))
    expect(onViewChange).toHaveBeenCalledWith('card')
  })

  it('有词时可导出 / 打印；没有错词时「导出错词」禁用', () => {
    const onExportAnki = vi.fn()
    const onPrint = vi.fn()
    render(
      <ReaderOverlaysHost
        {...props({ allVocab: { ...props().allVocab, open: true, items: [item()], onExportAnki, onPrint } })}
      />,
    )
    fireEvent.click(screen.getByText('整库 Anki CSV'))
    expect(onExportAnki).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('整库 A4 打印'))
    expect(onPrint).toHaveBeenCalledWith(expect.any(Array), '全部生词')
    expect((screen.getByText('导出错词') as HTMLButtonElement).disabled).toBe(true)
  })

  it('空库时列表位置给空态，关闭按钮可用', () => {
    const onClose = vi.fn()
    render(<ReaderOverlaysHost {...props({ allVocab: { ...props().allVocab, open: true, onClose } })} />)
    expect(screen.getByText('生词本是空的')).toBeTruthy()
    expect(screen.queryByTestId('vocab-list')).toBeNull()
    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
