// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SideVocab, { type SideVocabProps } from './SideVocab'
import { vocabItem } from '../../core/testFixtures'

/**
 * 侧栏生词本：**生词 / 语言点 两个页签分开显示**（用户明确要求的两类数据分开）。
 * 这里钉住：切页签换列表、计数正确、打印/Anki 只交当前页签的条目。
 */
const words = [
  vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑' }),
  vocabItem({ id: 'w2', word: 'wall', lemma: 'wall', meaning: '墙' }),
]
const langs = [
  vocabItem({ id: 'p1', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', meaning: '转而依靠' }),
  vocabItem({ id: 'u1', word: '注意 subject to 是形容词', lemma: '注意 subject to 是形容词', kind: 'usage' }),
]

function setup(over: Partial<SideVocabProps> = {}) {
  const onPrint = vi.fn()
  const onExportAnki = vi.fn()
  const props: SideVocabProps = {
    articleWords: [...words, ...langs],
    libraryItems: [...words, ...langs],
    view: 'card',
    onViewChange: vi.fn(),
    sortBy: 'updatedAt',
    onSortChange: vi.fn(),
    hasDoc: true,
    hasItems: true,
    hasLapses: false,
    onStartStudy: vi.fn(),
    onStartArticleAll: vi.fn(),
    onStartExam: vi.fn(),
    onStartQuick: vi.fn(),
    onStartDictation: vi.fn(),
    onOpenListening: vi.fn(),
    onOpenReading: vi.fn(),
    onOpenSpeedRead: vi.fn(),
    listenCount: 1,
    onListenCountChange: vi.fn(),
    onLanguagePrompt: vi.fn(),
    showLanguage: false,
    onShowLanguageChange: vi.fn(),
    languageCount: 0,
    onOpenPlan: vi.fn(),
    onOpenWriting: vi.fn(),
    onWrongPractice: vi.fn(),
    onBrowseAll: vi.fn(),
    onBrowseArticle: vi.fn(),
    onExportAnki,
    onPrint,
    onOpenExport: vi.fn(),
    printTitle: 'A 篇',
    onExportJson: vi.fn(),
    onExportWordList: vi.fn(),
    onCopyMissingPhonetic: vi.fn(),
    onToggleStats: vi.fn(),
    onExportWrong: vi.fn(),
    onExportAll: vi.fn(),
    onImportBackup: vi.fn(),
    onMergeBackup: vi.fn(),
    statsOpen: false,
    stats: {
      totals: { picked: 0, seconds: 0 },
      dayStats: { todayPicked: 0, streak: 0 },
      studyTodaySeconds: 0,
      studyTotalSeconds: 0,
      studyTotalCards: 0,
      studiedCount: 0,
      dailyGoal: 0,
      last7: [],
      dueForecast: [],
      byArticle: [],
    },
    onDailyGoalChange: vi.fn(),
    articleNums: new Map(),
    articleAllPrinted: false,
    articlePrintedAt: null,
    focusLemma: null,
    confirmDel: null,
    onSpeak: vi.fn(),
    onDelete: vi.fn(),
    onReview: vi.fn(),
    onEdit: vi.fn(),
    ...over,
  }
  render(<SideVocab {...props} />)
  return { onPrint, onExportAnki }
}

describe('SideVocab：生词 / 语言点 分开显示', () => {
  it('两个页签各带条数，默认停在「生词」', () => {
    setup()
    expect(screen.getByRole('button', { name: /生词（2）/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /语言点（2）/ })).toBeTruthy()
    // 默认显示生词：有 run，没有语言点
    expect(screen.getByText('run')).toBeTruthy()
    expect(screen.queryByText('fall back on')).toBeNull()
  })

  it('切到语言点：显示词组/习语/用法，生词消失', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /语言点（2）/ }))
    expect(screen.getByText('fall back on')).toBeTruthy()
    expect(screen.getByText('注意 subject to 是形容词')).toBeTruthy()
    expect(screen.queryByText('run')).toBeNull()
  })

  it('打印/Anki 只交当前页签的条目，标题标出「语言点」', () => {
    const { onPrint, onExportAnki } = setup()
    fireEvent.click(screen.getByRole('button', { name: /语言点（2）/ }))
    fireEvent.click(screen.getByRole('button', { name: /A4（本篇）/ }))
    const [items, title] = onPrint.mock.calls[0]
    expect(items.map((it: { id: string }) => it.id)).toEqual(['p1', 'u1'])
    expect(title).toBe('A 篇·语言点')

    fireEvent.click(screen.getByRole('button', { name: /Anki（本篇）/ }))
    expect(onExportAnki.mock.calls[0][0].map((it: { id: string }) => it.id)).toEqual(['p1', 'u1'])
  })

  it('本篇没有语言点时，语言点页签给提示而不是空白', () => {
    setup({ articleWords: words })
    fireEvent.click(screen.getByRole('button', { name: /语言点（0）/ }))
    expect(screen.getByText(/还没有语言点/)).toBeTruthy()
  })
})
