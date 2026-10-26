import { useMemo, type ComponentProps } from 'react'
import { articleKey } from '../core/docSignature'
import type { ArticleBook } from '../core/matchArticle'
import type { SavedArticle } from '../core/ports'
import type { Sentence, VocabLibrary } from '../types/document'
import type { ReaderDoc } from './hooks/useReaderDoc'
import ReaderShell from './ReaderShell'
import ReaderToolbarHost from './ReaderToolbarHost'
import ReaderSidebarHost from './ReaderSidebarHost'
import ReaderOverlaysHost from './ReaderOverlaysHost'
import SessionHost from './SessionHost'
import ReaderArticle from './ReaderArticle'
import ReaderToolbarZone from './screen/ReaderToolbarZone'
import ReaderSidebarZone from './screen/ReaderSidebarZone'
import ReaderBodyZone from './screen/ReaderBodyZone'
import type { ReaderPrefs } from './hooks/useReaderPrefs'
import type { useArticleVocabView } from './hooks/useArticleVocabView'
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
  /**
   * 18 个本机偏好整包（字号 / 主题 / 译文 / 音色 / 词汇标准 / 顶栏档位 / 面板持久开关…）。
   *
   * 原来一条条平铺进来，这个接口得把 `useReaderPrefs` 的每个类型再抄一遍 ——
   * 抄漏一处、改了一边，就是两套类型。整包传，取哪几个由 zone 自己决定。
   */
  prefs: ReaderPrefs
  examActive: boolean
  sideRef: ShellP['sideRef']
  onMouseDown: ShellP['onMouseDown']
  onMouseUp: ShellP['onMouseUp']
  onContextMenu: ShellP['onContextMenu']
  toast: string
  readingView: boolean

  // ---- 文章 / 词库 / 选区状态 ----
  saved: SavedArticle[]
  book: ArticleBook | null
  library: VocabLibrary
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  doc: ReaderDoc | null
  /**
   * URL → 文章的路由事实（正文槽位据此区分「加载中 / 这篇没了 / 正文」）。
   * 判定在 `screen/bodyMode.ts`，别在视图里再写一份 `!doc` 条件。
   */
  articleRouting: {
    slug: string
    indexReady: boolean
    ref: string
    currentRef: string
  }
  bookError: boolean
  selectedId: string | null
  exact: string
  useExact: boolean
  lastTask: string | null
  target: string
  sentence: Sentence | null
  batchCount: number
  /** 本篇生词与对齐口径整包（条目 / 编号 / 来源 / 语境释义 / 打印情况…），见 useArticleVocabView */
  articleVocab: ReturnType<typeof useArticleVocabView>
  libraryLemmas: Set<string>
  vocabSidSet: Set<string>
  studiedTodayIds: string[]

  // ---- 粘贴 / AI 配置 ----
  pasted: string
  setPasted: (v: string) => void
  pasteReport: string[]
  setPasteReport: (v: string[]) => void
  pasteMissing: Parameters<typeof useAiServices>[0]['pasteMissing']
  setPasteMissing: (v: Parameters<typeof useAiServices>[0]['pasteMissing']) => void
  ttsAccents: ToolbarP['tts']['accents']
  ttsState: SessionP['ttsState']

  // ---- 学习配额 / 生词本视图 ----
  studyGrandSeconds: number
  articleQuizCount: number
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
  browseArticle: boolean
  setBrowseArticle: (v: boolean) => void
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
  const { examActive, sideRef, onMouseDown, onMouseUp, onContextMenu, toast } = props
  const { fontSize, bold, serif, sideTab } = props.prefs
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
