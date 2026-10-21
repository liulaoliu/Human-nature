import { useMemo, type ComponentProps } from 'react'
import { articleKey } from '../core/docSignature'
import type { ArticleBook } from '../core/matchArticle'
import type { SavedArticle } from '../core/ports'
import type { Sentence, VocabItem, VocabLibrary, VocabMeaningSource, VocabVia } from '../types/document'
import type { ReaderDoc } from './hooks/useReaderDoc'
import ReaderShell from './ReaderShell'
import ReaderToolbarHost from './ReaderToolbarHost'
import ReaderSidebarHost from './ReaderSidebarHost'
import ReaderOverlaysHost from './ReaderOverlaysHost'
import SessionHost from './SessionHost'
import ReaderArticle from './ReaderArticle'
import type { ReaderSideTab } from './panels/ReaderSidebar'
import ReaderToolbarZone from './screen/ReaderToolbarZone'
import ReaderSidebarZone from './screen/ReaderSidebarZone'
import ReaderBodyZone from './screen/ReaderBodyZone'
import type { useArticleWorkspace } from './hooks/useArticleWorkspace'
import type { useSessionServices } from './hooks/useSessionServices'
import type { useAiServices } from './hooks/useAiServices'
import type { useArticleUiActions } from './hooks/useArticleUiActions'
import type { useReaderDerived } from './hooks/useReaderDerived'
import type { useArticleDerived } from './hooks/useArticleDerived'
import type { useReaderViewData } from './hooks/useReaderViewData'
import type { useLearningData } from './hooks/useLearningData'
import type { useSelection } from './hooks/useSelection'
import type { useBatchQueue } from './hooks/useBatchQueue'
import type { useVocabEdits } from './hooks/useVocabEdits'
import type { useSpeaking } from './hooks/useSpeaking'
import type { usePregenerate } from './hooks/usePregenerate'


type ShellP = ComponentProps<typeof ReaderShell>
type ToolbarP = ComponentProps<typeof ReaderToolbarHost>
type SidebarP = ComponentProps<typeof ReaderSidebarHost>
type OverlayP = ComponentProps<typeof ReaderOverlaysHost>
type SessionP = ComponentProps<typeof SessionHost>
type ArticleP = ComponentProps<typeof ReaderArticle>

export interface ReaderScreenProps {
  // ---- 外壳 / 字号 / 主题 ----
  fontSize: ShellP['fontSize']
  bold: boolean
  serif: boolean
  examActive: boolean
  sideTab: ReaderSideTab
  onSideTabChange: (tab: ReaderSideTab) => void
  sideRef: ShellP['sideRef']
  onMouseDown: ShellP['onMouseDown']
  onMouseUp: ShellP['onMouseUp']
  onContextMenu: ShellP['onContextMenu']
  toast: string
  setFontSize: (v: string) => void
  setBold: (v: boolean) => void
  setSerif: (v: boolean) => void
  eye: boolean
  setEye: (v: boolean) => void
  /** 顶栏按钮区宽度档位（自适应 / 窄 / 宽 / 铺满），选择存在本机 */
  toolbarWidth: ToolbarP['display']['toolbarWidth']
  setToolbarWidth: ToolbarP['display']['onToolbarWidthChange']
  /** 顶栏按钮区占几行（4 / 3 / 2），选择存在本机 */
  toolbarRows: ToolbarP['display']['toolbarRows']
  setToolbarRows: ToolbarP['display']['onToolbarRowsChange']
  readingView: boolean

  // ---- 文章 / 词库 / 选区状态 ----
  saved: SavedArticle[]
  book: ArticleBook | null
  library: VocabLibrary
  restorePrevLibrary: () => void | Promise<void>
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  doc: ReaderDoc | null
  bookError: boolean
  selectedId: string | null
  exact: string
  useExact: boolean
  lastTask: string | null
  target: string
  sentence: Sentence | null
  batchCount: number
  articleWords: VocabItem[]
  articleNums: Map<string, number>
  articleOrigins: Map<string, 'auto' | 'manual'>
  articleVias: Map<string, VocabVia>
  /** 本篇语境释义来源：lemma → 手动/语境/词典/AI（没条目释义的不放） */
  articleMeaningSources: Map<string, VocabMeaningSource>
  articleFirst: ArticleP['articleFirst']
  articleAllPrinted: boolean
  articlePrintedAt: string | null
  languageSentCount: number
  knownLemmas: Set<string>
  libraryLemmas: Set<string>
  vocabSidSet: Set<string>
  wordsInSentence: (sid: string) => string[]
  /** 本篇语境释义（悬浮提示；`sentenceId` 用于优先同句语境） */
  meaningOf: (word: string, sentenceId?: string | null) => string | null
  allList: VocabItem[]
  studiedTodayIds: string[]

  // ---- 粘贴 / AI 配置 ----
  pasted: string
  setPasted: (v: string) => void
  pasteReport: string[]
  setPasteReport: (v: string[]) => void
  pasteMissing: Parameters<typeof useAiServices>[0]['pasteMissing']
  setPasteMissing: (v: Parameters<typeof useAiServices>[0]['pasteMissing']) => void
  aiPackScope: SidebarP['pick']['scope']
  setAiPackScope: (v: SidebarP['pick']['scope']) => void
  autoVocabDirect: boolean
  setAutoVocabDirect: (v: boolean) => void
  confusableBatchSize: number
  setConfusableBatchSize: (v: number) => void
  translateView: ToolbarP['vocab']['translateView']
  setTranslateView: (v: ToolbarP['vocab']['translateView']) => void
  autoSpeak: boolean
  setAutoSpeak: (v: boolean) => void
  vocabLevel: ToolbarP['vocab']['level']
  setVocabLevel: (v: ToolbarP['vocab']['level']) => void
  ttsVoice: ToolbarP['tts']['voice']
  setTtsVoice: (v: ToolbarP['tts']['voice']) => void
  ttsAccents: ToolbarP['tts']['accents']
  ttsState: SessionP['ttsState']

  // ---- 学习配额 / 生词本视图 ----
  newLimit: number
  setNewLimit: (v: number) => void
  newToday: number
  studyGrandSeconds: number
  articleQuizCount: number
  dailyGoal: number
  setDailyGoal: (v: number) => void
  showLanguage: boolean
  setShowLanguage: (v: boolean) => void
  vocabView: 'card' | 'table'
  setVocabView: (v: 'card' | 'table') => void
  vocabSort: SidebarP['vocab']['sortBy']
  setVocabSort: (v: SidebarP['vocab']['sortBy']) => void
  statsOpen: boolean
  setStatsOpen: (updater: boolean | ((prev: boolean) => boolean)) => void
  focusLemma: string | null
  setFocusLemma: (v: string | null) => void
  confirmDel: string | null
  setConfirmDel: (v: string | null) => void
  todayKey: string

  // ---- 面板开关 ----
  setComposing: (updater: boolean | ((prev: boolean) => boolean)) => void
  setPlanOpen: (v: boolean) => void
  setBrowseAll: (v: boolean) => void
  setExportOpen: (v: boolean) => void
  setJournalOpen: (v: boolean) => void
  setIntensiveOpen: (v: boolean) => void
  setGoalOpen: (v: boolean) => void
  setSpeedReadOpen: (v: boolean) => void
  setListenOpen: (v: boolean) => void
  speedReadOpen: boolean
  planOpen: boolean
  intensiveOpen: boolean
  journalOpen: boolean
  journalDay: string
  setJournalDay: (v: string) => void
  exportOpen: boolean
  goalOpen: boolean
  browseAll: boolean
  flash: (message: string) => void
  peekSid: string | null
  selSid: string | null
  selIndices: number[]
  lastPicked: { word: string; sid: string } | null
  bubblePos: { top: number; left: number } | null
  articleRef: ArticleP['articleRef']
  startIntensiveDrill: (kind: Parameters<OverlayP['intensive']['onDrill']>[0]) => void
  openIntensiveStage: OverlayP['intensive']['onStage']
  dictTools: SidebarP['dictTools']
  dictReady: boolean
  tatoebaReady: boolean
  exporter: SidebarP['exporter']

  // ---- 各领域 hook 的完整结果 ----
  workspace: ReturnType<typeof useArticleWorkspace>
  services: ReturnType<typeof useSessionServices>
  ai: ReturnType<typeof useAiServices>
  ui: ReturnType<typeof useArticleUiActions>
  derived: ReturnType<typeof useReaderDerived>
  articleDerived: ReturnType<typeof useArticleDerived>
  viewData: ReturnType<typeof useReaderViewData>
  learning: ReturnType<typeof useLearningData>
  selection: ReturnType<typeof useSelection>
  batchQueue: ReturnType<typeof useBatchQueue>
  vocabEdits: ReturnType<typeof useVocabEdits>
  speaking: ReturnType<typeof useSpeaking>
  pregenApi: ReturnType<typeof usePregenerate>
}

/**
 * 阅读页视图：只负责把三个槽位交给 zone 组件，自己只留外壳。
 *
 * 状态与动作都在 `ReaderApp` / hooks 里；这一层不读存储、不发请求，
 * 方便单独调布局与条件渲染。
 */
export default function ReaderScreen(props: ReaderScreenProps) {
  const { fontSize, bold, serif, examActive, sideTab, sideRef, onMouseDown, onMouseUp, onContextMenu, toast } = props
  /**
   * 滚动进度按「文章标识 + 正文签名」存：标识可能是空标题 / 同名 / 「未命名」，
   * 只按标识存会让另一篇同标识的文章继承这里的滚动位置。
   */
  const scrollKey = useMemo(
    () => articleKey(props.articleIdentity, props.doc?.sentences ?? []),
    [props.articleIdentity, props.doc],
  )

  return (
    <ReaderShell
      fontSize={fontSize}
      bold={bold}
      serif={serif}
      examActive={examActive}
      studying={!!props.services.studyQueue}
      docKey={scrollKey}
      sideTab={sideTab}
      sideRef={sideRef}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      toast={toast}
      toolbar={<ReaderToolbarZone {...props} />}
      sidebar={<ReaderSidebarZone {...props} />}
    >
      <ReaderBodyZone {...props} />
    </ReaderShell>
  )
}
