import type { ComponentProps } from 'react'
import type { AnalysisTask } from '../core/analyzer'
import type { VocabItem, VocabLibrary } from '../types/document'
import type { useAiPack } from './hooks/useAiPack'
import type { useAiTasks } from './hooks/useAiTasks'
import type { useDictTools } from './hooks/useDictTools'
import type { useDictation } from './hooks/useDictation'
import type { useExport } from './hooks/useExport'
import type { useQuickSession } from './hooks/useQuickSession'
import type { useQuizSession } from './hooks/useQuizSession'
import type { useStudySession } from './hooks/useStudySession'
import type { BatchItem, SidePickProps } from './panels/SidePick'
import type { SideMasteryProps } from './panels/SideMastery'
import type { SideOverviewProps } from './panels/SideOverview'
import type StatsPanel from './panels/StatsPanel'
import ReaderSidebar, { type ReaderSideTab } from './panels/ReaderSidebar'
import type { SideVocabProps, SideVocabStats } from './panels/SideVocab'

/** 选区任务按钮（翻译/查词/…），与阅读页工具栏同一套。 */
const TASKS: { task: AnalysisTask; label: string }[] = [
  { task: 'translate', label: '翻译' },
  { task: 'lookup', label: '查词' },
  { task: 'grammar', label: '语法' },
  { task: 'collocations', label: '搭配' },
  { task: 'extract_vocab', label: '提取生词' },
  { task: 'summarize', label: '概述' },
]

export interface ReaderSidebarHostProps {
  sideTab: ReaderSideTab
  onSideTabChange: (tab: ReaderSideTab) => void

  /** 学习记录（错题 / 活动 / 练习）+ 清空错题 + 重建核对 */
  learning: {
    mistakes: SideOverviewProps['mistakes']
    activity: ComponentProps<typeof StatsPanel>['activity']
    practice: ComponentProps<typeof StatsPanel>['practice']
    onClearMistakes: () => void
    /** 统计页底部「重建并核对」：服务端重算 + 与本地对账 */
    rebuild: {
      run: () => void
      busy: boolean
      note: string | null
      matched: boolean
    }
  }
  /** 总览页「体检表」与重练动作 */
  overview: Pick<SideOverviewProps, 'readyRows' | 'onRetryVocab' | 'onSiege' | 'onRetryListen' | 'onRetryDict'>
  mastery: { mastery: SideMasteryProps['mastery']; onStartArticle: () => void }

  /** 阅读页派生统计簇（`useReaderDerived` 的输出，外加本篇打印/编号等） */
  derived: {
    totals: SideVocabStats['totals']
    dayStats: SideVocabStats['dayStats']
    studyTodaySeconds: number
    studyTotalSeconds: number
    studyTotalCards: number
    studiedCount: number
    last7: SideVocabStats['last7']
    dueForecast: SideVocabStats['dueForecast']
    byArticle: SideVocabStats['byArticle']
    visibleBatch: BatchItem[]
    confusableBatchCount: number
    confusableTodoCount: number
    lemmaCount: number
    posCount: number
    articleWords: VocabItem[]
    articleNums: Map<string, number>
    articleOrigins?: Map<string, 'auto' | 'manual'>
    articleAllPrinted: boolean
    articlePrintedAt: string | null
    languageCount: number
  }

  // ---- 会话 / 语料（整包传入，宿主负责映射） ----
  study: ReturnType<typeof useStudySession>
  quiz: ReturnType<typeof useQuizSession>
  quick: ReturnType<typeof useQuickSession>
  dict: ReturnType<typeof useDictation>
  speech: (text: string) => void
  library: VocabLibrary
  restorePrev: () => void
  /** 理解题：open(read=true) 为纯文本阅读理解，false 为听力模式；start 直接出题。 */
  listening: { open: (read: boolean) => void; start: () => void }
  openSpeedRead: () => void
  openWriting: () => void

  // ---- AI / 工具 / 导出（整包传入） ----
  ai: ReturnType<typeof useAiPack>
  tasks: ReturnType<typeof useAiTasks>
  exporter: ReturnType<typeof useExport>
  dictTools: ReturnType<typeof useDictTools>
  dictReady: boolean
  tatoeba: { ready: boolean; enrichExamples: () => void }
  selection: {
    addSelectionToBatch: () => void
    mark: () => void
    jumpToSource: NonNullable<SideVocabProps['onJumpSource']>
  }

  /** 选词 / 粘贴 / AI 范围等交互状态（值 + setter 成对传） */
  pick: {
    lastTask: string | null
    target: string
    useExact: boolean
    vocabMode: boolean
    canMark: boolean
    batchCount: number
    pasted: string
    onPastedChange: (value: string) => void
    pasteReport: string[]
    pasteMissingCount: number
    onApplyPaste: () => void
    onCopyMissingAgain: () => void
    onOpenLang: () => void
    onRemoveWord: (item: BatchItem) => void
    onClearBatch: () => void
    scope: SidePickProps['aiScope']
    onScopeChange: (scope: SidePickProps['aiScope']) => void
    autoVocabDirect: boolean
    onAutoVocabDirectChange: (on: boolean) => void
    confusableBatchSize: number
    onConfusableBatchSizeChange: (n: number) => void
  }

  /** 生词本 / 学习入口 / 导出的交互状态 */
  vocab: {
    view: SideVocabProps['view']
    onViewChange: SideVocabProps['onViewChange']
    sortBy: SideVocabProps['sortBy']
    onSortChange: SideVocabProps['onSortChange']
    hasDoc: boolean
    listenCount: number
    onListenCountChange: (n: number) => void
    onLanguagePrompt: () => void
    showLanguage: boolean
    onShowLanguageChange: (on: boolean) => void
    onOpenPlan: () => void
    onBrowseAll: () => void
    printTitle: string
    articleIdentity?: string
    meaningOf?: SideVocabProps['meaningOf']
    onOpenExport: () => void
    onToggleStats: () => void
    statsOpen: boolean
    dailyGoal: number
    onDailyGoalChange: (n: number) => void
    focusLemma: string | null
    onFocusLemmaChange: (lemma: string | null) => void
    confirmDel: string | null
    onConfirmDelChange: (id: string | null) => void
    onDelete: SideVocabProps['onDelete']
    onDeleteArticle?: SideVocabProps['onDeleteArticle']
    onEdit: SideVocabProps['onEdit']
    onReview: SideVocabProps['onReview']
  }
}

/**
 * 右侧栏宿主：把各 hook 的整包输出映射成 `ReaderSidebar` 的五组面板 props。
 *
 * 之前这 190 行接线全铺在 `ReaderApp` 里；现在只在宿主里做一次映射，
 * `ReaderApp` 只传 hook 结果、派生值和少量交互状态。
 */
export default function ReaderSidebarHost({
  sideTab,
  onSideTabChange,
  learning,
  overview,
  mastery,
  derived,
  study,
  quiz,
  quick,
  dict,
  speech,
  library,
  restorePrev,
  listening,
  openSpeedRead,
  openWriting,
  ai,
  tasks,
  exporter,
  dictTools,
  dictReady,
  tatoeba,
  selection,
  pick,
  vocab,
}: ReaderSidebarHostProps) {
  const hasItems = library.items.length > 0
  const hasLapses = library.items.some((w) => (w.reviewState.lapses ?? 0) > 0)

  /** 开始背单词（从侧栏进）：先关掉考试设置，避免两个面板叠着。 */
  const startStudy = () => {
    quiz.setQueue(null)
    quiz.setSetupOpen(false)
    study.start()
  }

  /** 仪表盘每行的「去准备」动作。 */
  const boardAction = (key: string): { label: string; run: () => void } | null => {
    switch (key) {
      case 'vocab':
        return { label: '去选词', run: () => onSideTabChange('pick') }
      case 'batch':
        return { label: '查词', run: () => void tasks.copyBatchPrompt() }
      case 'unqueried':
        return { label: '补查音标', run: () => void tasks.copyMissingPhonetic('missing') }
      case 'confusable':
        return { label: '生成混淆项', run: () => void tasks.copyConfusablePrompt() }
      case 'lemma':
        return { label: '去重整理', run: tasks.dedupeNow }
      case 'review':
        return { label: '背单词', run: startStudy }
      case 'dictation':
        return { label: '去听写', run: dict.start }
      case 'listen':
        return { label: '出题', run: listening.start }
      case 'language':
        return { label: '分析', run: () => void vocab.onLanguagePrompt() }
      case 'imitation':
        return { label: '去仿写', run: openWriting }
      default:
        return null
    }
  }

  return (
    <ReaderSidebar
      sideTab={sideTab}
      onSideTabChange={onSideTabChange}
      overview={{
        mistakes: learning.mistakes,
        readyRows: overview.readyRows,
        boardAction,
        onRetryVocab: overview.onRetryVocab,
        onSiege: overview.onSiege,
        onRetryListen: overview.onRetryListen,
        onRetryDict: overview.onRetryDict,
        onClearMistakes: learning.onClearMistakes,
      }}
      mastery={{
        mastery: mastery.mastery,
        onStartArticle: mastery.onStartArticle,
        onStartVocab: startStudy,
      }}
      stats={{
        activity: learning.activity,
        practice: learning.practice,
        onRebuild: learning.rebuild.run,
        rebuildBusy: learning.rebuild.busy,
        rebuildNote: learning.rebuild.note,
        rebuildMatched: learning.rebuild.matched,
      }}
      pick={{
        tasks: TASKS,
        onPrompt: (t) => void tasks.copyPrompt(t),
        lastTask: pick.lastTask,
        target: pick.target,
        useExact: pick.useExact,
        vocabMode: pick.vocabMode,
        canMark: pick.canMark,
        visibleBatch: derived.visibleBatch,
        batchCount: pick.batchCount,
        onRemoveWord: pick.onRemoveWord,
        onCommitBatch: tasks.commitBatch,
        onCopyBatchPrompt: () => void tasks.copyBatchPrompt(),
        onExportBatch: exporter.exportBatch,
        onClearBatch: pick.onClearBatch,
        onAddSelectionToBatch: selection.addSelectionToBatch,
        onMark: selection.mark,
        onOpenLang: pick.onOpenLang,
        pasted: pick.pasted,
        onPastedChange: pick.onPastedChange,
        pasteReport: pick.pasteReport,
        pasteMissingCount: pick.pasteMissingCount,
        onApplyPaste: pick.onApplyPaste,
        onCopyMissingAgain: pick.onCopyMissingAgain,
        aiJobCount: ai.jobCount,
        aiScope: pick.scope,
        onAiScopeChange: pick.onScopeChange,
        autoVocabDirect: pick.autoVocabDirect,
        onAutoVocabDirectChange: pick.onAutoVocabDirectChange,
        autoVocabDoneHere: ai.autoVocabDoneHere,
        onRerunAutoVocab: ai.rerunAutoVocab,
        onExportAiJobs: ai.exportJobs,
        dictReady,
        onPickFromDict: dictTools.pickFromDict,
        onEnrichFromDict: dictTools.enrichFromDict,
        onEnrichExamples: tatoeba.enrichExamples,
        examplesReady: tatoeba.ready,
        onFixLemmasFromDict: dictTools.fixLemmasFromDict,
        onConfuseFromDict: dictTools.confuseFromDict,
        aiFileRef: ai.fileRef,
        onAiFile: ai.onFile,
        localConfigured: ai.localConfigured,
        localRunning: ai.localRunning,
        localDone: ai.localDone,
        localTotal: ai.localTotal,
        localRound: ai.localRound,
        localPhase: ai.localPhase,
        localError: ai.localError,
        onRunLocal: ai.runLocal,
        checklist: ai.checklist,
        checklistDone: ai.checklistDone,
        checklistTotal: ai.checklistTotal,
        nextHint: ai.nextHint,
        onSkipPending: ai.skipPending,
        aiWebBatchSize: ai.webBatchSize,
        onAiWebBatchSizeChange: ai.setWebBatchSize,
        onCopyWebPrompt: ai.copyWebPrompt,
        onCopyWebMissing: ai.copyWebMissing,
        onRefreshWeb: ai.resetWebProgress,
        webTotal: ai.webTotal,
        webDone: ai.webDone,
        webPending: ai.webPending,
        webMissing: ai.webMissing,
        webPendingLabels: ai.webPendingLabels,
        webBreakdown: ai.webBreakdown,
        confusableBatchCount: derived.confusableBatchCount,
        confusableTodoCount: derived.confusableTodoCount,
        onCopyConfusable: () => void tasks.copyConfusablePrompt(),
        confusableBatchSize: pick.confusableBatchSize,
        onConfusableBatchSizeChange: pick.onConfusableBatchSizeChange,
        lemmaCount: derived.lemmaCount,
        onCopyLemma: () => void tasks.copyLemmaPrompt(),
        posCount: derived.posCount,
        onCopyPos: () => void tasks.copyPosPrompt(),
        hasItems,
        onDedupe: tasks.dedupeNow,
      }}
      vocab={{
        articleWords: derived.articleWords,
        libraryItems: library.items,
        view: vocab.view,
        onViewChange: vocab.onViewChange,
        sortBy: vocab.sortBy,
        onSortChange: vocab.onSortChange,
        hasDoc: vocab.hasDoc,
        hasItems,
        hasLapses,
        onStartStudy: startStudy,
        onStartArticleAll: () => {
          quiz.setQueue(null)
          quiz.setSetupOpen(false)
          study.startArticleAll()
        },
        onStartExam: () => {
          study.close()
          quiz.setResults([])
          quiz.setSetupOpen(true)
        },
        onStartQuick: () => {
          quick.setQueue(null)
          study.close()
          quiz.setSetupOpen(false)
          quick.start()
        },
        onStartDictation: dict.start,
        onOpenListening: () => listening.open(false),
        onOpenReading: () => listening.open(true),
        onOpenSpeedRead: openSpeedRead,
        listenCount: vocab.listenCount,
        onListenCountChange: vocab.onListenCountChange,
        onLanguagePrompt: vocab.onLanguagePrompt,
        showLanguage: vocab.showLanguage,
        onShowLanguageChange: vocab.onShowLanguageChange,
        languageCount: derived.languageCount,
        onOpenPlan: vocab.onOpenPlan,
        onOpenWriting: openWriting,
        onWrongPractice: () => {
          quiz.setScope('lapses')
          quiz.setResults([])
          quiz.setSetupOpen(true)
        },
        onBrowseAll: vocab.onBrowseAll,
        onExportAnki: exporter.doExportAnki,
        onPrint: exporter.doPrint,
        onPrintRows: exporter.doPrintRows,
        articleIdentity: vocab.articleIdentity,
        meaningOf: vocab.meaningOf,
        onOpenExport: vocab.onOpenExport,
        printTitle: vocab.printTitle,
        onExportJson: exporter.exportJson,
        onExportWordList: exporter.exportWordList,
        onCopyMissingPhonetic: tasks.copyMissingPhonetic,
        onToggleStats: vocab.onToggleStats,
        onExportWrong: exporter.doExportWrong,
        onExportAll: exporter.exportAll,
        onRestorePrev: restorePrev,
        onImportBackup: exporter.onImportBackup,
        onMergeBackup: exporter.onMergeBackup,
        statsOpen: vocab.statsOpen,
        stats: {
          totals: derived.totals,
          dayStats: derived.dayStats,
          studyTodaySeconds: derived.studyTodaySeconds,
          studyTotalSeconds: derived.studyTotalSeconds,
          studyTotalCards: derived.studyTotalCards,
          studiedCount: derived.studiedCount,
          dailyGoal: vocab.dailyGoal,
          last7: derived.last7,
          dueForecast: derived.dueForecast,
          byArticle: derived.byArticle,
        },
        onDailyGoalChange: vocab.onDailyGoalChange,
        articleNums: derived.articleNums,
        articleOrigins: derived.articleOrigins,
        articleAllPrinted: derived.articleAllPrinted,
        articlePrintedAt: derived.articlePrintedAt,
        focusLemma: vocab.focusLemma,
        confirmDel: vocab.confirmDel,
        onJumpSource: selection.jumpToSource,
        onSpeak: speech,
        onDelete: vocab.onDelete,
        onDeleteArticle: vocab.onDeleteArticle,
        onReview: vocab.onReview,
        onEdit: vocab.onEdit,
      }}
    />
  )
}
