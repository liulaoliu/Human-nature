import ReaderScreen, { type ReaderScreenProps } from './ReaderScreen'
import type { useArticleDocState, usePasteState, useReaderHighlightState } from './hooks/useReaderLocalState'
import type { useReaderPanelRouting } from './hooks/useReaderRouting'
import type { Sentence } from '../types/document'

/**
 * `ReaderApp` 的装配结果（不是业务状态）。
 *
 * 组合根只负责把各 hook 的结果按组交出来；真正平铺成 `ReaderScreen` 的
 * 80 多个 props 的脏活在这里做。这样 `ReaderApp` 不会因为加一个面板 prop
 * 就再长 3 行，也避免它同时承担「接线」和「视图接口翻译」两件事。
 */
export interface ReaderAppModel {
  prefs: ReaderScreenProps['prefs']
  docState: ReturnType<typeof useArticleDocState>
  paste: ReturnType<typeof usePasteState>
  highlight: ReturnType<typeof useReaderHighlightState>
  services: ReaderScreenProps['services']
  golden: ReaderScreenProps['golden']
  onExportGoldenMarkdown: () => void
  onGenerateGolden: () => void
  panels: ReturnType<typeof useReaderPanelRouting>['panels']
  browseFilters: ReaderScreenProps['browseFilters']
  articleRouting: ReaderScreenProps['articleRouting']

  saved: ReaderScreenProps['saved']
  book: ReaderScreenProps['book']
  bookError: ReaderScreenProps['bookError']
  library: ReaderScreenProps['library']
  articleIdentity: string
  target: string
  sentence: Sentence | null
  batchCount: number
  articleVocab: ReaderScreenProps['articleVocab']
  libraryLemmas: ReaderScreenProps['libraryLemmas']
  vocabSidSet: ReaderScreenProps['vocabSidSet']
  studiedTodayIds: ReaderScreenProps['studiedTodayIds']

  ttsAccents: ReaderScreenProps['ttsAccents']
  ttsState: ReaderScreenProps['ttsState']
  studyGrandSeconds: number
  articleQuizCount: number
  todayKey: string
  flash: ReaderScreenProps['flash']
  toast: string
  examActive: boolean
  readingView: boolean

  sideRef: ReaderScreenProps['sideRef']
  articleRef: ReaderScreenProps['articleRef']
  startIntensiveDrill: ReaderScreenProps['startIntensiveDrill']
  openIntensiveStage: ReaderScreenProps['openIntensiveStage']
  dictTools: ReaderScreenProps['dictTools']
  dictReady: boolean
  tatoebaReady: boolean
  exporter: ReaderScreenProps['exporter']

  workspace: ReaderScreenProps['workspace']
  ai: ReaderScreenProps['ai']
  ui: ReaderScreenProps['ui']
  derived: ReaderScreenProps['derived']
  articleDerived: ReaderScreenProps['articleDerived']
  viewData: ReaderScreenProps['viewData']
  learning: ReaderScreenProps['learning']
  selection: ReaderScreenProps['selection']
  batchQueue: ReaderScreenProps['batchQueue']
  vocabEdits: ReaderScreenProps['vocabEdits']
  speaking: ReaderScreenProps['speaking']
  pregenApi: ReaderScreenProps['pregenApi']
}

/** 把分组模型平铺成 `ReaderScreen` 的 props（视图接口的唯一翻译层）。 */
export function toReaderScreenProps(app: ReaderAppModel): ReaderScreenProps {
  const { docState: d, paste: p, highlight: h, panels, services, selection, browseFilters } = app
  return {
    prefs: app.prefs,
    examActive: app.examActive,
    sideRef: app.sideRef,
    onMouseDown: selection.onMouseDown,
    onMouseUp: selection.onMouseUp,
    onContextMenu: selection.onContextMenu,
    toast: app.toast,
    readingView: app.readingView,

    saved: app.saved,
    book: app.book,
    library: app.library,
    articleIdentity: app.articleIdentity,
    articleTitle: d.articleTitle,
    articleKey: d.articleKey,
    doc: d.doc,
    articleRouting: app.articleRouting,
    bookError: app.bookError,
    selectedId: d.selectedId,
    exact: d.exact,
    useExact: d.useExact,
    lastTask: p.lastTask,
    target: app.target,
    sentence: app.sentence,
    batchCount: app.batchCount,
    articleVocab: app.articleVocab,
    libraryLemmas: app.libraryLemmas,
    vocabSidSet: app.vocabSidSet,
    studiedTodayIds: app.studiedTodayIds,

    pasted: p.pasted,
    setPasted: p.setPasted,
    pasteReport: p.pasteReport,
    setPasteReport: p.setPasteReport,
    pasteMissing: p.pasteMissing,
    setPasteMissing: p.setPasteMissing,
    ttsAccents: app.ttsAccents,
    ttsState: app.ttsState,

    studyGrandSeconds: app.studyGrandSeconds,
    articleQuizCount: app.articleQuizCount,
    statsOpen: panels.statsOpen,
    setStatsOpen: panels.setStatsOpen,
    focusLemma: h.focusLemma,
    setFocusLemma: h.setFocusLemma,
    confirmDel: h.confirmDel,
    setConfirmDel: h.setConfirmDel,
    todayKey: app.todayKey,

    setComposing: app.workspace.setComposing,
    setPlanOpen: panels.setPlanOpen,
    setBrowseAll: panels.setBrowseAll,
    setExportOpen: panels.setExportOpen,
    setJournalOpen: panels.setJournalOpen,
    setIntensiveOpen: panels.setIntensiveOpen,
    setGoalOpen: panels.setGoalOpen,
    setSpeedReadOpen: panels.setSpeedReadOpen,
    setListenOpen: services.setListenOpen,
    speedReadOpen: panels.speedReadOpen,
    planOpen: panels.planOpen,
    intensiveOpen: panels.intensiveOpen,
    journalOpen: panels.journalOpen,
    journalDay: panels.journalDay,
    setJournalDay: panels.setJournalDay,
    exportOpen: panels.exportOpen,
    goalOpen: panels.goalOpen,
    browseAll: panels.browseAll,
    browseArticle: panels.browseArticle,
    setBrowseArticle: panels.setBrowseArticle,
    browseFilters,
    flash: app.flash,
    peekSid: h.peekSid,
    selSid: d.selSid,
    selIndices: d.selIndices,
    lastPicked: h.lastPicked,
    bubblePos: h.bubblePos,
    articleRef: app.articleRef,
    startIntensiveDrill: app.startIntensiveDrill,
    openIntensiveStage: app.openIntensiveStage,
    dictTools: app.dictTools,
    dictReady: app.dictReady,
    tatoebaReady: app.tatoebaReady,
    exporter: app.exporter,

    workspace: app.workspace,
    services: app.services,
    golden: app.golden,
    onExportGoldenMarkdown: app.onExportGoldenMarkdown,
    onGenerateGolden: app.onGenerateGolden,
    ai: app.ai,
    ui: app.ui,
    derived: app.derived,
    articleDerived: app.articleDerived,
    viewData: app.viewData,
    learning: app.learning,
    selection: app.selection,
    batchQueue: app.batchQueue,
    vocabEdits: app.vocabEdits,
    speaking: app.speaking,
    pregenApi: app.pregenApi,
  }
}

export default function ReaderScreenFromModel({ app }: { app: ReaderAppModel }) {
  return <ReaderScreen {...toReaderScreenProps(app)} />
}
