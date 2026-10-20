// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { ReaderSidebarHostProps } from './ReaderSidebarHost'

/** 捕获宿主传给 ReaderSidebar 的分组 props（不渲染真实面板）。 */
let captured: ComponentProps<typeof import('./panels/ReaderSidebar').default> | null = null
vi.mock('./panels/ReaderSidebar', () => ({
  default: (props: unknown) => {
    captured = props as ComponentProps<typeof import('./panels/ReaderSidebar').default>
    return <div data-testid="sidebar" />
  },
}))

import ReaderSidebarHost from './ReaderSidebarHost'

const fn = () => vi.fn()

/** 假 API：字段只列宿主会用到的；整体 cast，避免为测试造整个 hook 返回值。 */
function makeProps(over: Partial<ReaderSidebarHostProps> = {}): ReaderSidebarHostProps {
  const ai = {
    jobCount: 3,
    exportJobs: fn(),
    fileRef: { current: null },
    onFile: fn(),
    webBatchSize: 10,
    setWebBatchSize: fn(),
    copyWebPrompt: fn(),
    applyWeb: fn(),
    copyWebMissing: fn(),
    resetWebProgress: fn(),
    autoVocabDoneHere: true,
    rerunAutoVocab: fn(),
    webTotal: 7,
    webDone: 2,
    webPending: 5,
    webMissing: 1,
    webPendingLabels: ['补音标'],
    webBreakdown: [],
    localConfigured: true,
    localRunning: false,
    localDone: 1,
    localTotal: 2,
    localRound: 1,
    localPhase: '跑批中',
    localError: '',
    runLocal: fn(),
    skipPending: fn(),
    checklist: [],
    checklistDone: 0,
    checklistTotal: 3,
    nextHint: '还差音标',
  }
  const tasks = {
    copyPrompt: fn(),
    commitBatch: fn(),
    copyBatchPrompt: fn(),
    copyMissingPhonetic: fn(),
    copyTranslateAll: fn(),
    copyAutoVocab: fn(),
    copyConfusablePrompt: fn(),
    copyLemmaPrompt: fn(),
    copyPosPrompt: fn(),
    dedupeNow: fn(),
  }
  const exports = {
    exportBatch: fn(),
    doExportAnki: fn(),
    doPrint: fn(),
    exportJson: fn(),
    exportWordList: fn(),
    doExportWrong: fn(),
    exportAll: fn(),
    onImportBackup: fn(),
    onMergeBackup: fn(),
  }
  const study = { start: fn(), startArticleAll: fn(), close: fn() }
  const quiz = { setQueue: fn(), setSetupOpen: fn(), setResults: fn(), setScope: fn() }
  const quick = { setQueue: fn(), start: fn() }
  return {
    sideTab: 'overview',
    onSideTabChange: fn(),
    learning: {
      mistakes: [],
      activity: [],
      practice: [],
      onClearMistakes: fn(),
      rebuild: { run: fn(), busy: false, note: null, matched: false },
    },
    overview: {
      readyRows: [],
      onRetryVocab: fn(),
      onSiege: fn(),
      onRetryListen: fn(),
      onRetryDict: fn(),
    },
    mastery: { mastery: {} as never, onStartArticle: fn() },
    derived: {
      totals: { picked: 0, seconds: 0 },
      dayStats: { todayPicked: 0, streak: 0 },
      studyTodaySeconds: 0,
      studyTotalSeconds: 0,
      studyTotalCards: 0,
      studiedCount: 0,
      last7: [],
      dueForecast: [],
      byArticle: [],
      visibleBatch: [],
      confusableBatchCount: 0,
      confusableTodoCount: 0,
      lemmaCount: 0,
      posCount: 0,
      articleWords: [],
      articleNums: new Map(),
      articleAllPrinted: false,
      articlePrintedAt: null,
      languageCount: 0,
    },
    study: study as never,
    quiz: quiz as never,
    quick: quick as never,
    dict: { start: fn() } as never,
    speech: fn(),
    library: { schemaVersion: 1, items: [] },
    restorePrev: fn(),
    listening: { open: fn(), start: fn() },
    openSpeedRead: fn(),
    openWriting: fn(),
    ai: ai as never,
    tasks: tasks as never,
    exporter: exports as never,
    dictTools: {
      pickFromDict: fn(),
      enrichFromDict: fn(),
      fixLemmasFromDict: fn(),
      confuseFromDict: fn(),
    } as never,
    dictReady: true,
    tatoeba: { ready: true, enrichExamples: fn() },
    selection: { addSelectionToBatch: fn(), mark: fn(), jumpToSource: fn() },
    pick: {
      lastTask: null,
      target: '',
      useExact: false,
      vocabMode: false,
      canMark: false,
      batchCount: 0,
      pasted: '',
      onPastedChange: fn(),
      pasteReport: [],
      pasteMissingCount: 0,
      onApplyPaste: fn(),
      onCopyMissingAgain: fn(),
      onOpenLang: fn(),
      onRemoveWord: fn(),
      onClearBatch: fn(),
      scope: 'article',
      onScopeChange: fn(),
      autoVocabDirect: true,
      onAutoVocabDirectChange: fn(),
      confusableBatchSize: 60,
      onConfusableBatchSizeChange: fn(),
    },
    vocab: {
      view: 'card',
      onViewChange: fn(),
      sortBy: 'updatedAt',
      onSortChange: fn(),
      hasDoc: true,
      listenCount: 10,
      onListenCountChange: fn(),
      onLanguagePrompt: fn(),
      showLanguage: false,
      onShowLanguageChange: fn(),
      onOpenPlan: fn(),
      onBrowseAll: fn(),
      printTitle: '本篇生词',
      onOpenExport: fn(),
      onToggleStats: fn(),
      statsOpen: false,
      dailyGoal: 20,
      onDailyGoalChange: fn(),
      focusLemma: null,
      onFocusLemmaChange: fn(),
      confirmDel: null,
      onConfirmDelChange: fn(),
      onDelete: fn(),
      onEdit: fn(),
      onReview: fn(),
    },
    ...over,
  }
}

function renderHost(over: Partial<ReaderSidebarHostProps> = {}) {
  const props = makeProps(over)
  render(<ReaderSidebarHost {...props} />)
  if (!captured) throw new Error('没有渲染 ReaderSidebar')
  return { props, sidebar: captured }
}

describe('ReaderSidebarHost：AI / 工具 / 导出整包映射', () => {
  it('ai 整包按 SidePick 口径改名（jobCount/exportJobs/fileRef/web*/local*）', () => {
    const { props, sidebar } = renderHost()
    const ai = props.ai as unknown as Record<string, any>
    const pick = sidebar.pick
    expect(pick.aiJobCount).toBe(ai.jobCount)
    expect(pick.onExportAiJobs).toBe(ai.exportJobs)
    expect(pick.aiFileRef).toBe(ai.fileRef)
    expect(pick.onAiFile).toBe(ai.onFile)
    expect(pick.aiWebBatchSize).toBe(ai.webBatchSize)
    expect(pick.onAiWebBatchSizeChange).toBe(ai.setWebBatchSize)
    expect(pick.onCopyWebPrompt).toBe(ai.copyWebPrompt)
    expect(pick.onCopyWebMissing).toBe(ai.copyWebMissing)
    expect(pick.onRefreshWeb).toBe(ai.resetWebProgress)
    expect(pick.webTotal).toBe(ai.webTotal)
    expect(pick.webPendingLabels).toBe(ai.webPendingLabels)
    expect(pick.localRunning).toBe(ai.localRunning)
    expect(pick.onRunLocal).toBe(ai.runLocal)
    expect(pick.checklistTotal).toBe(ai.checklistTotal)
    expect(pick.onSkipPending).toBe(ai.skipPending)
  })

  it('tasks / exports / dictTools / tatoeba 接到对应入口', () => {
    const { props, sidebar } = renderHost()
    const tasks = props.tasks as unknown as Record<string, any>
    const exports = props.exporter as unknown as Record<string, any>
    const dictTools = props.dictTools as unknown as Record<string, any>
    sidebar.pick.onPrompt('translate')
    expect(tasks.copyPrompt).toHaveBeenCalledWith('translate')
    expect(sidebar.pick.onCommitBatch).toBe(tasks.commitBatch)
    sidebar.pick.onCopyBatchPrompt()
    expect(tasks.copyBatchPrompt).toHaveBeenCalledOnce()
    sidebar.pick.onCopyConfusable()
    expect(tasks.copyConfusablePrompt).toHaveBeenCalledOnce()
    sidebar.pick.onCopyLemma()
    expect(tasks.copyLemmaPrompt).toHaveBeenCalledOnce()
    sidebar.pick.onCopyPos()
    expect(tasks.copyPosPrompt).toHaveBeenCalledOnce()
    expect(sidebar.pick.onDedupe).toBe(tasks.dedupeNow)
    expect(sidebar.pick.onExportBatch).toBe(exports.exportBatch)
    expect(sidebar.vocab.onExportAnki).toBe(exports.doExportAnki)
    expect(sidebar.vocab.onPrint).toBe(exports.doPrint)
    expect(sidebar.vocab.onExportAll).toBe(exports.exportAll)
    expect(sidebar.pick.onEnrichFromDict).toBe(dictTools.enrichFromDict)
    expect(sidebar.pick.onPickFromDict).toBe(dictTools.pickFromDict)
    expect(sidebar.pick.onFixLemmasFromDict).toBe(dictTools.fixLemmasFromDict)
    expect(sidebar.pick.onConfuseFromDict).toBe(dictTools.confuseFromDict)
    expect(sidebar.pick.onEnrichExamples).toBe(props.tatoeba.enrichExamples)
    expect(sidebar.pick.examplesReady).toBe(true)
    expect(sidebar.pick.dictReady).toBe(true)
  })

  it('统计 / 总览 / 掌握度按分组透传', () => {
    const { props, sidebar } = renderHost()
    expect(sidebar.stats.activity).toBe(props.learning.activity)
    expect(sidebar.stats.practice).toBe(props.learning.practice)
    expect(sidebar.overview.mistakes).toBe(props.learning.mistakes)
    expect(sidebar.overview.readyRows).toBe(props.overview.readyRows)
    expect(sidebar.overview.onRetryListen).toBe(props.overview.onRetryListen)
    expect(sidebar.mastery.mastery).toBe(props.mastery.mastery)
    expect(sidebar.mastery.onStartArticle).toBe(props.mastery.onStartArticle)
  })

  it('统计页「重建并核对」：动作 / 忙碌 / 结论原样接到面板', () => {
    const props = makeProps()
    props.learning.rebuild = { run: fn(), busy: true, note: '核对一致：活动 8 次 · 答题 0 道', matched: true }
    render(<ReaderSidebarHost {...props} />)
    expect(captured!.stats.onRebuild).toBe(props.learning.rebuild.run)
    expect(captured!.stats.rebuildBusy).toBe(true)
    expect(captured!.stats.rebuildNote).toBe('核对一致：活动 8 次 · 答题 0 道')
    expect(captured!.stats.rebuildMatched).toBe(true)
  })
})

describe('ReaderSidebarHost：派生值转成面板字段', () => {
  it('统计簇与生词本统计共用一份 derived', () => {
    const { sidebar } = renderHost()
    expect(sidebar.vocab.stats).toEqual({
      totals: { picked: 0, seconds: 0 },
      dayStats: { todayPicked: 0, streak: 0 },
      studyTodaySeconds: 0,
      studyTotalSeconds: 0,
      studyTotalCards: 0,
      studiedCount: 0,
      dailyGoal: 20,
      last7: [],
      dueForecast: [],
      byArticle: [],
    })
    expect(sidebar.pick.visibleBatch).toEqual([])
    expect(sidebar.pick.hasItems).toBe(false)
    expect(sidebar.vocab.hasLapses).toBe(false)
  })

  it('待选/混淆项/原形计数来自 derived', () => {
    const props = makeProps()
    props.derived = {
      ...props.derived,
      confusableBatchCount: 5,
      confusableTodoCount: 9,
      lemmaCount: 2,
      posCount: 4,
    }
    render(<ReaderSidebarHost {...props} />)
    expect(captured!.pick.confusableBatchCount).toBe(5)
    expect(captured!.pick.confusableTodoCount).toBe(9)
    expect(captured!.pick.lemmaCount).toBe(2)
    expect(captured!.pick.posCount).toBe(4)
  })
})

describe('ReaderSidebarHost：会话按钮的前后顺序', () => {
  it('开始考试：先关背词，再清结果、开设置', () => {
    const { props, sidebar } = renderHost()
    sidebar.vocab.onStartExam()
    const study = props.study as unknown as Record<string, any>
    const quiz = props.quiz as unknown as Record<string, any>
    expect(study.close).toHaveBeenCalledOnce()
    expect(quiz.setResults).toHaveBeenCalledWith([])
    expect(quiz.setSetupOpen).toHaveBeenCalledWith(true)
  })

  it('快刷：清队列 → 关节奏 → 关设置 → 开快刷', () => {
    const { props, sidebar } = renderHost()
    sidebar.vocab.onStartQuick()
    const quick = props.quick as unknown as Record<string, any>
    const quiz = props.quiz as unknown as Record<string, any>
    expect(quick.setQueue).toHaveBeenCalledWith(null)
    expect((props.study as unknown as Record<string, any>).close).toHaveBeenCalledOnce()
    expect(quiz.setSetupOpen).toHaveBeenCalledWith(false)
    expect(quick.start).toHaveBeenCalledOnce()
  })

  it('错题重练：只用 lapses 范围出题', () => {
    const { props, sidebar } = renderHost()
    sidebar.vocab.onWrongPractice()
    const quiz = props.quiz as unknown as Record<string, any>
    expect(quiz.setScope).toHaveBeenCalledWith('lapses')
    expect(quiz.setSetupOpen).toHaveBeenCalledWith(true)
  })

  it('挑错题/开始背词/听写/听力/速读/仿写都接到对应 API', () => {
    const { props, sidebar } = renderHost()
    sidebar.overview.onClearMistakes()
    expect((props.learning as unknown as Record<string, any>).onClearMistakes).toHaveBeenCalledOnce()
    sidebar.overview.onRetryVocab()
    expect(props.overview.onRetryVocab).toHaveBeenCalledOnce()
    sidebar.vocab.onStartStudy()
    expect((props.study as unknown as Record<string, any>).start).toHaveBeenCalledOnce()
    sidebar.vocab.onStartDictation()
    expect((props.dict as unknown as Record<string, any>).start).toHaveBeenCalledOnce()
    sidebar.vocab.onOpenReading()
    expect(props.listening.open).toHaveBeenCalledWith(true)
    sidebar.vocab.onOpenSpeedRead()
    expect(props.openSpeedRead).toHaveBeenCalledOnce()
    sidebar.vocab.onOpenWriting()
    expect(props.openWriting).toHaveBeenCalledOnce()
  })

  it('返回按钮改页签', () => {
    const { props, sidebar } = renderHost()
    sidebar.onSideTabChange('stats')
    expect(props.onSideTabChange).toHaveBeenCalledWith('stats')
  })
})
