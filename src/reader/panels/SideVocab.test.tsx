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

describe('SideVocab：找回入口（黄条）', () => {
  it('词库只剩语言点时：给出「一键全部重建」+ 找回顺序', () => {
    setup({ articleWords: langs, libraryItems: langs, onRecoverAll: vi.fn(), onRestorePrev: vi.fn() })
    expect(screen.getByRole('button', { name: /一键全部重建词库/ })).toBeTruthy()
    expect(screen.getByText(/一个普通单词都没有/)).toBeTruthy()
  })

  it('黄条列出三个来源的条数（正文标记 / 待选清单 / 错题本），先看数再决定', () => {
    setup({
      libraryItems: langs,
      articleWords: langs,
      markedWordCount: 7,
      rescueBatch: 812,
      rescueMistakes: 13,
      onKeepOnlyMarked: vi.fn(),
    })
    const banner = document.querySelector('.side-warn')!.textContent ?? ''
    expect(banner).toContain('812')
    expect(banner).toContain('13')
    expect(banner).toContain('7')
  })

  it('「用我原来的标记重建」要两步确认（防误触覆盖整库）', () => {
    const onKeepOnlyMarked = vi.fn()
    setup({ libraryItems: langs, articleWords: langs, markedWordCount: 7, onKeepOnlyMarked })
    fireEvent.click(screen.getByRole('button', { name: /用我原来的标记重建词库/ }))
    expect(onKeepOnlyMarked).not.toHaveBeenCalled() // 第一次只「武装」
    fireEvent.click(screen.getByRole('button', { name: /确认：用这些标记重建/ }))
    expect(onKeepOnlyMarked).toHaveBeenCalledTimes(1)
  })

  it('语言点页签有「重收语言点」入口', () => {
    const onRecollectLang = vi.fn()
    setup({ libraryItems: langs, articleWords: langs, onRecollectLang })
    fireEvent.click(screen.getByRole('button', { name: /语言点（2）/ }))
    expect(screen.getByRole('button', { name: /重收语言点/ })).toBeTruthy()
  })
})
