import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArticleBook } from '../core/matchArticle'
import { wordSpans } from '../core/wordSelect'
import {
  createLibrary,
  applyExamples,
  applyLemmaMap,
  articleWordsOf,
  dedupeLibrary,
  displayMeaning,
  editItem,
  hasOwnExamples,
  isDue,
  lemmaOf,
  markWord,
  normalizeWord,
  normalizeGrammarMarks,
  removeItem,
  reviewItem,
  sortItems,
  type ReviewGrade,
  type VocabSortBy,
} from '../core/vocab'
import {
  buildBatchLookupPrompt,
  buildConfusablePrompt,
  buildLemmaPrompt,
  buildPhrasePrompt,
  buildGrammarMarkPrompt,
  buildPosPrompt,
  type AnalysisTask,
  type VocabLevel,
} from '../core/analyzer'
import { type ListeningQuestion } from '../core/listening'
import { buildLanguagePrompt, hasSentenceLanguage } from '../core/language'
import { isWordEntry } from '../core/entryKind'
import { repairLanguageKinds, splitGlossText } from '../core/langPoints'
import { collectOfflineExampleRows } from '../core/libraryAutoFill'
import {
  addPracticeRecord,
  practiceForArticle,
  type PracticeKind,
  type PracticeRecord,
} from '../core/practice'
import { buildArticleMastery, isStable } from '../core/mastery'
import { buildArticleQuestions } from '../core/articleQuiz'
import { type ArticleQuizKind } from '../core/quiz'
import {
  removeMistake,
  upsertMistake,
  type MistakeEntry,
} from '../core/mistakes'
import { buildReadiness } from '../core/readiness'
import { dueForecast, last7Days, pickDayStats, sessionTotals, studyTotals, wordsByArticle } from '../core/vocabStats'
import { type AiJobsInput } from '../core/aiPackage'
import { activityStreak, addActivity, dayKeyLocal, dayTotal, type ActivityCat, type DayActivity } from '../core/activity'
import { buildOutputBoard } from '../core/output'
import { buildSiege } from '../core/siege'
import { createVocabRepo } from '../adapters/vocabRepo'
import { createArticleRepo, type ArticleRepoPort, type SavedArticle } from '../adapters/articleRepo'
import VocabList, { type VocabEditPatch } from './VocabList'
import StatsPanel from './panels/StatsPanel'
import DictPanel from './panels/DictPanel'
import ListeningPanel from './panels/ListeningPanel'
import SpeedReadPanel from './panels/SpeedReadPanel'
import LanguageEditor from './panels/LanguageEditor'
import PlanPanel from './panels/PlanPanel'
import WritingPanel from './panels/WritingPanel'
import StudyPanel from './panels/StudyPanel'
import QuizSetupPanel from './panels/QuizSetupPanel'
import QuizPanel from './panels/QuizPanel'
import QuickPanel from './panels/QuickPanel'
import SideOverview from './panels/SideOverview'
import SideMastery from './panels/SideMastery'
import SidePick, { type BatchItem } from './panels/SidePick'
import SideVocab from './panels/SideVocab'
import ReaderBody from './panels/ReaderBody'
import Composer from './panels/Composer'
import ReaderToolbar from './panels/ReaderToolbar'
import { useSpeaking } from './hooks/useSpeaking'
import { useTtsEngines } from './hooks/useTtsEngines'
import { DEFAULT_TTS_VOICE, TTS_ACCENTS, type TtsAccent } from '../core/ttsVoices'
import { useAiPack } from './hooks/useAiPack'
import { useDictation } from './hooks/useDictation'
import { useQuizSession } from './hooks/useQuizSession'
import { useStudySession } from './hooks/useStudySession'
import { useArticleImport } from './hooks/useArticleImport'
import { useLibraryAutoFill } from './hooks/useLibraryAutoFill'
import { useReadDone } from './hooks/useReadDone'
import { useAiTasks } from './hooks/useAiTasks'
import { useReaderDoc } from './hooks/useReaderDoc'
import { useApplyTaskResult } from './hooks/useApplyTaskResult'
import { useExport } from './hooks/useExport'
import { useSelection } from './hooks/useSelection'
import { useDictionary } from './hooks/useDictionary'
import { useDictTools } from './hooks/useDictTools'
import { loadTatoeba, tatoebaExamples } from './tatoeba'
import { dictionary } from './dictionary'
import { dictLemmaPairs } from '../core/ecdict'
import { useQuickSession } from './hooks/useQuickSession'
import { useListening } from './hooks/useListening'
import { useWriting } from './hooks/useWriting'
import FishLayer from '../ui/FishLayer'
import IntensivePanel, { type DrillKind } from './panels/IntensivePanel'
import JournalPanel from './panels/JournalPanel'
import ExportPanel from './panels/ExportPanel'
import { buildIntensivePlan, type IntensiveStageKey } from '../core/intensive'
import { buildJournalDay, journalDays, journalSummary } from '../core/journal'
import GoalPanel from './panels/GoalPanel'
import { buildHeatmap } from '../core/activity'
import {
  persistentBool,
  persistentEnum,
  persistentNumber,
  persistentString,
  useLocalStorageState,
} from './hooks/useLocalStorageState'
import type { VocabRepoPort } from '../core/ports'
import type { Paragraph, Sentence, SentenceLanguage, VocabLibrary, VocabItem } from '../types/document'
import mascotAI from '../../assets/imgs/GinShinImapct.png'
import './reader.css'

interface Doc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

const TASKS: { task: AnalysisTask; label: string }[] = [
  { task: 'translate', label: '翻译' },
  { task: 'lookup', label: '查词' },
  { task: 'grammar', label: '语法' },
  { task: 'collocations', label: '搭配' },
  { task: 'extract_vocab', label: '提取生词' },
  { task: 'summarize', label: '概述' },
]

/** 「待选」清单按文章持久化：切页/关浏览器回来还在。 */
function loadBatchMap(): Record<string, BatchItem[]> {
  try {
    const raw = localStorage.getItem('reader:batch')
    const v = raw ? (JSON.parse(raw) as Record<string, BatchItem[]>) : {}
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export default function ReaderApp() {
  const [book, setBook] = useState<ArticleBook | null>(null)
  const [bookError, setBookError] = useState(false)
  const [articleKey, setArticleKey] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 鼠标精确选中的片段（划选 / 双击选词），可能为空 */
  const [exact, setExact] = useState('')
  /** 是否用精确片段：有精确选区时为真，默认用整句 */
  const [useExact, setUseExact] = useState(false)
  /** 精确选区：哪个句子 + 哪些词（可离散，支持下划线多选） */
  const [selSid, setSelSid] = useState<string | null>(null)
  const [selIndices, setSelIndices] = useState<number[]>([])
  const [library, setLibrary] = useState<VocabLibrary>(() => createLibrary())
  /** 词库是否已从 IndexedDB 读回来（读完才做「语言点自动收藏」，避免和加载抢写）。 */
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  /** 词库的可变引用：跑批里多条任务挨个应用时用它串起来，避免相互覆盖（见 useApplyTaskResult）。 */
  const libraryRef = useRef(library)
  libraryRef.current = library
  const [pasted, setPasted] = useState('')
  /** 上次「复制提示词」请求的词（用于校验 AI 返回是否齐全） */
  const askedWordsRef = useRef<string[]>([])
  /** 上次「全文翻译」请求的句子 id（用于校验是否逐句返回） */
  const askedIdsRef = useRef<string[]>([])
  /** 应用结果后的回执（成功 / 缺失 / 无效） */
  const [pasteReport, setPasteReport] = useState<string[]>([])
  /** 上次回执里缺失的词（用于「一键复制未返回的」重试） */
  const [pasteMissing, setPasteMissing] = useState<{
    task: 'confusable' | 'lookup' | 'lemma' | 'pos' | 'phrase' | 'grammar_mark'
    words: string[]
  } | null>(null)
  const [lastTask, setLastTask] = useState<
    | AnalysisTask
    | 'confusable'
    | 'example'
    | 'phrase'
    | 'lemma'
    | 'pos'
    | 'grammar_mark'
    | 'listening'
    | 'language'
    | 'imitation'
    | 'feedback'
    | null
  >(null)
  const [toast, setToast] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [saved, setSaved] = useState<SavedArticle[]>([])
  /** 「已保存文章」列表是否已从 IndexedDB 取回（未取回前别做自动恢复，否则会漏掉已存的分析）。 */
  const [savedLoaded, setSavedLoaded] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  /** 有内容改动、需要（首次则建立记录）自动保存 */
  const [pendingSave, setPendingSave] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  /** 是否按住 Ctrl / ⌘（决定「整句」还是「按词吸附」） */
  const [ctrlHeld, setCtrlHeld] = useState(false)
  /** 是否按住 Alt（选词模式下：Alt+拖动选词组，否则只选一个词） */
  const [altHeld, setAltHeld] = useState(false)
  const [edition, setEdition] = useState('全部')
  /** 阅读字号 / 字重，存本机 */
  const [fontSize, setFontSize] = useLocalStorageState('reader:size', 'md', persistentString)
  /** 右侧面板当前 Tab：总览 / 选词分析 / 生词本 / 统计 */
  const [sideTab, setSideTab] = useLocalStorageState<'overview' | 'pick' | 'vocab' | 'stats' | 'mastery'>(
    'reader:sideTab',
    'overview',
    persistentEnum(['overview', 'pick', 'vocab', 'stats', 'mastery'] as const, 'overview'),
  )
  const [bold, setBold] = useLocalStorageState('reader:bold', false, persistentBool)
  const [serif, setSerif] = useLocalStorageState('reader:serif', false, persistentBool)
  /** 护眼模式：浅色纸感 */
  const [eye, setEye] = useLocalStorageState('reader:theme', false, {
    parse: (raw) => raw === 'green',
    serialize: (v) => (v ? 'green' : 'dark'),
  })
  const [composing, setComposing] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  /** 新建/导入时可选的书名（epub 自动用文件名） */
  const [newBook, setNewBook] = useState('')
  /** 当前打开文章所属的书 */
  const [articleBook, setArticleBook] = useState('')
  /** 每日统计面板是否展开 */
  const [statsOpen, setStatsOpen] = useState(false)
  /** 「全部生词」独立视图（侧栏只显示本篇） */
  const [browseAll, setBrowseAll] = useState(false)
  /** 译文显示：只看原文 / 原文+译文 / 只看译文 */
  const [translateView, setTranslateView] = useLocalStorageState<'off' | 'below' | 'only'>(
    'reader:translateView',
    'off',
    persistentEnum(['off', 'below', 'only'] as const, 'off'),
  )
  const [pdfRange, setPdfRange] = useState('')
  const [importing, setImporting] = useState('')
  /** 选中句子后自动 TTS 朗读 */
  const [autoSpeak, setAutoSpeak] = useLocalStorageState('reader:autoSpeak', false, persistentBool)
  /** 朗读音色（Edge TTS 口音）——改口音就是改它。 */
  const [ttsVoice, setTtsVoice] = useLocalStorageState('reader:ttsVoice', DEFAULT_TTS_VOICE, persistentString)
  // 引擎探测：发现离线的系统语音（SAPI）后，并入音色下拉
  const ttsEngines = useTtsEngines()
  const ttsAccents = useMemo<TtsAccent[]>(() => {
    const sapi = ttsEngines?.sapi
    if (!sapi?.available || !sapi.voices.length) return TTS_ACCENTS
    const short = (n: string) => n.replace(/^Microsoft\s+/i, '').replace(/\s+Desktop$/i, '')
    return [
      ...TTS_ACCENTS,
      {
        label: '离线 · 系统语音（免下载、不联网）',
        voices: sapi.voices.map((v) => ({
          id: v.id,
          name: v.lang ? `${short(v.name)}（${v.lang}）` : short(v.name),
          gender: v.gender === 'Male' ? '男' : '女',
        })),
      },
    ]
  }, [ttsEngines])
  /** 自动标词的词汇标准 */
  const [vocabLevel, setVocabLevel] = useLocalStorageState<VocabLevel>(
    'reader:vocabLevel',
    'cet6',
    persistentEnum(['cet4', 'cet6', 'kaoyan', 'ielts', 'ielts65'] as const, 'cet6'),
  )
  /** a/d 临时提示的句子（有生词，底色与"选中句"略不同） */
  const [peekSid, setPeekSid] = useState<string | null>(null)
  /** 生词本视图：卡片 / 密排表格 */
  const [vocabView, setVocabView] = useLocalStorageState<'card' | 'table'>(
    'reader:vocabView',
    'card',
    persistentEnum(['card', 'table'] as const, 'card'),
  )
  /** 生词本里被高亮/滚到的词条（点正文生词时用） */
  const [focusLemma, setFocusLemma] = useState<string | null>(null)
  /** 待确认删除的词条 id（两步防误触） */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  /** 「删除保存」文章的两步确认 */
  const [confirmDelSave, setConfirmDelSave] = useState(false)
  /** 朗读（TTS）：单句 / 整篇 / 选中句自动读。speak 身份稳定，后面的回调可直接用，不用 ref 绕顺序。 */
  const {
    speak,
    speakFromWord,
    speakRange,
    startReadAll,
    stopReadAll,
    resetSpeech,
    warmTexts,
    warmTimings,
    readingAll,
    ttsState,
    nowPlaying,
  } = useSpeaking({
    doc,
    selectedId,
    voice: ttsVoice,
    onFallback: (reason) => {
      if (reason === 'server') {
        flash('Edge 在线语音连不上，已临时改用浏览器语音；可在音色里选「离线 · 系统语音」')
      } else {
        flash('浏览器拦了自动播放，已改用浏览器语音（点一下页面再试）')
      }
    },
  })

  /** 预生成整篇朗读：先查缓存、只补缺的句子（增量），带进度、可取消。 */
  const [pregen, setPregen] = useState<{ done: number; total: number; running: boolean; allCached: boolean }>({
    done: 0,
    total: 0,
    running: false,
    allCached: false,
  })
  const pregenAbortRef = useRef(false)
  // 换音色 / 换文章后，「已全部缓存」不再成立
  useEffect(() => {
    setPregen((p) => (p.allCached ? { ...p, allCached: false } : p))
  }, [ttsVoice, doc])
  const pregenerateAll = useCallback(async () => {
    const list = doc?.sentences.map((s) => s.text.trim()).filter(Boolean) ?? []
    if (!list.length) return
    const voice = ttsVoice
    pregenAbortRef.current = false
    setPregen({ done: 0, total: list.length, running: true, allCached: false })

    // 1) 查缓存（不合成）——找出缺哪几句
    let ci = 0
    const missing: string[] = []
    await Promise.all(
      Array.from({ length: Math.min(8, list.length) }, async () => {
        for (;;) {
          if (pregenAbortRef.current) return
          const i = ci++
          if (i >= list.length) return
          let cached = false
          try {
            const r = await fetch(
              `/api/tts?check=1&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(list[i])}`,
            )
            const j = r.ok ? await r.json() : null
            cached = !!(j && j.cached)
          } catch {
            cached = false
          }
          if (!cached) missing.push(list[i])
          setPregen((p) => ({ ...p, done: Math.min(i + 1, list.length) }))
        }
      }),
    )
    if (pregenAbortRef.current) {
      setPregen((p) => ({ ...p, running: false }))
      return
    }
    if (!missing.length) {
      setPregen({ done: list.length, total: list.length, running: false, allCached: true })
      return
    }

    // 2) 只合成缺的（并发 3）
    setPregen({ done: 0, total: missing.length, running: true, allCached: false })
    let next = 0
    let done = 0
    await Promise.all(
      Array.from({ length: Math.min(3, missing.length) }, async () => {
        for (;;) {
          if (pregenAbortRef.current) return
          const idx = next++
          if (idx >= missing.length) return
          try {
            await fetch(`/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(missing[idx])}`)
          } catch {
            // 单句失败不打断整篇
          }
          done++
          setPregen((p) => ({ ...p, done }))
        }
      }),
    )
    setPregen((p) => ({ ...p, running: false }))
  }, [doc, ttsVoice])
  const cancelPregenerate = useCallback(() => {
    pregenAbortRef.current = true
  }, [])

  /** 逐词高亮：当前朗读句 + 正读到的词下标。 */
  const karaoke = useMemo(() => {
    const np = nowPlaying
    if (!np || !doc) return null
    const s = doc.sentences.find((x) => x.text.trim() === np.text)
    if (!s) return null
    let activeIndex: number | null = null
    for (let i = 0; i < np.wordTimings.length; i++) {
      const wt = np.wordTimings[i]
      if (np.ms >= wt.start && np.ms < wt.end) {
        activeIndex = i
        break
      }
    }
    return { sid: s.id, activeIndex }
  }, [nowPlaying, doc])
  /** 背单词时长统计：按天累计（落盘，供统计用） */
  const [studyDays, setStudyDays] = useLocalStorageState<{ day: string; seconds: number; cards: number }[]>(
    'reader:studyStats',
    [],
  )

  /**
   * 每天「学过的不同单词 id」历史（每日目标进度 + 学习日志）。
   * 兼容旧格式（单个 `{ day, ids }` 对象 → 收成一条）。
   */
  const [studiedDays, setStudiedDays] = useLocalStorageState<{ day: string; ids: string[] }[]>(
    'reader:studiedToday',
    [],
    {
      parse: (raw) => {
        try {
          const v = JSON.parse(raw) as unknown
          const ok = (x: unknown): x is { day: string; ids: string[] } =>
            !!x && typeof x === 'object' && typeof (x as { day?: unknown }).day === 'string' &&
            Array.isArray((x as { ids?: unknown }).ids)
          if (Array.isArray(v)) return v.filter(ok).map((x) => ({ day: x.day, ids: x.ids.filter((i): i is string => typeof i === 'string') }))
          if (ok(v)) return [{ day: v.day, ids: v.ids.filter((i): i is string => typeof i === 'string') }]
        } catch {
          // 忽略
        }
        return []
      },
    },
  )
  /** 每日目标（个不同单词，0=不设目标） */
  const [dailyGoal, setDailyGoal] = useLocalStorageState('reader:dailyGoal', 20, persistentNumber)
  /** 听写会话 API 的引用：供定义在 useDictation 之前的少数回调（打开听力/仿写、错题重练）使用。 */
  const dictApiRef = useRef<ReturnType<typeof useDictation> | null>(null)
  /** 考试会话 API 的引用：供定义在 useQuizSession 之前的少数回调（背单词开始时关闭考试）使用。 */
  const quizApiRef = useRef<ReturnType<typeof useQuizSession> | null>(null)
  /** 快刷会话 API 的引用：供定义在 useQuickSession 之前的少数回调使用。 */
  const quickApiRef = useRef<ReturnType<typeof useQuickSession> | null>(null)
  /** 听力理解会话 API 的引用：供定义在 useListening 之前的少数回调（错题本重练）使用。 */
  const listenApiRef = useRef<ReturnType<typeof useListening> | null>(null)
  /** 是否在正文里显示语言点 */
  const [showLanguage, setShowLanguage] = useLocalStorageState('reader:showLanguage', false, persistentBool)
  /** 学习活动统计（按天，落 localStorage） */
  const [activity, setActivity] = useLocalStorageState<DayActivity[]>('reader:activity', [])
  /** 练习成绩记录（考试 / 听写 / 听力理解） */
  const [practice, setPractice] = useLocalStorageState<PracticeRecord[]>('reader:practice', [])
  /** 统一错题本（考试错词 / 听力错题 / 听写漏词） */
  const [mistakes, setMistakes] = useLocalStorageState<MistakeEntry[]>('reader:mistakes', [])
  /** 按「文章 → 题型」统计的练习正确率（词块/搭配量化用）。 */
  const [kindStats, setKindStats] = useLocalStorageState<Record<string, Record<string, { total: number; correct: number }>>>(
    'reader:kindStats',
    {},
  )
  /** 复述打卡：用自己的话复述的留档（按篇）。 */
  const [retells, setRetells] = useLocalStorageState<
    { at: string; articleId: string; text: string; words: number }[]
  >('reader:retells', [])
  /** 每次生成混淆项的批量大小（0=全部） */
  const [confusableBatchSize, setConfusableBatchSize] = useLocalStorageState(
    'reader:confusableBatch',
    60,
    persistentNumber,
  )
  /** AI 工作包范围：只处理本篇 / 整个词库 */
  const [aiPackScope, setAiPackScope] = useLocalStorageState<'article' | 'all'>(
    'reader:aiPackScope',
    'article',
    persistentEnum(['article', 'all'] as const, 'article'),
  )
  /** 自动标词是否**直接**写进生词本（跳过「待选」，省一步人工入库）。 */
  const [autoVocabDirect, setAutoVocabDirect] = useLocalStorageState('reader:autoVocabDirect', true, persistentBool)
  /** 每天引入新词的上限（0=不限）与今天已引入 */
  const [newLimit, setNewLimit] = useLocalStorageState('reader:newLimit', 20, persistentNumber)
  const [newToday, setNewToday] = useLocalStorageState('reader:newToday', 0, {
    parse: (raw) => {
      try {
        const obj = JSON.parse(raw) as { day?: string; count?: number } | null
        return obj && obj.day === dayKeyLocal() && typeof obj.count === 'number' ? obj.count : 0
      } catch {
        return 0
      }
    },
    serialize: (count) => JSON.stringify({ day: dayKeyLocal(), count }),
  })
  /** 选词模式：最近选中的词 + 气泡位置 */
  const [lastPicked, setLastPicked] = useState<{ word: string; sid: string } | null>(null)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null)
  /** 选词模式计时（秒）与历史统计 */
  const [vocabSeconds, setVocabSeconds] = useState(0)
  const [sessions, setSessions] = useLocalStorageState<{ at: string; seconds: number; picked: number }[]>(
    'reader:vocabStats',
    [],
  )
  /** 选词模式：点/划直接选生词，攒一批后一键导出 */
  const [vocabMode, setVocabMode] = useState(false)
  const [batch, setBatch] = useState<BatchItem[]>([])
  /** 当前文章的稳定标识：内置用 book key；手动/已保存用 savedId。生词据此归属到文章。 */
  const articleIdentity = articleKey ?? savedId ?? articleTitle
  /** 一轮考完 → 按题型累加到本篇（每次练习都算，产出看板据此算正确率）。 */
  const mergeKindStats = useCallback(
    (rows: { kind: string; total: number; correct: number }[]) => {
      if (!articleIdentity) return
      setKindStats((prev) => {
        const forArticle = { ...(prev[articleIdentity] ?? {}) }
        for (const r of rows) {
          const cur = forArticle[r.kind] ?? { total: 0, correct: 0 }
          forArticle[r.kind] = { total: cur.total + r.total, correct: cur.correct + r.correct }
        }
        return { ...prev, [articleIdentity]: forArticle }
      })
    },
    [articleIdentity, setKindStats],
  )

  /** 每个句子的 lemma 集合（只随 doc 变，避免「本篇」过滤时对每个词条重扫全文）。 */
  const sentenceLemmas = useMemo(() => {
    const m = new Map<string, Set<string>>()
    if (doc) {
      for (const s of doc.sentences) {
        const set = new Set<string>()
        for (const w of wordSpans(s.text)) set.add(lemmaOf(w.text))
        m.set(s.id, set)
      }
    }
    return m
  }, [doc])
  /** 全文出现过的 lemma 集合（「本篇」范围用）。 */
  const docLemmas = useMemo(() => {
    const all = new Set<string>()
    for (const set of sentenceLemmas.values()) for (const l of set) all.add(l)
    return all
  }, [sentenceLemmas])

  /**
   * 本篇生词：**来源是本文**，或**本文正文里出现过**该词。
   * 后者很关键：`markWord` 去重时沿用旧来源，从别的文章带过来的同一词来源留在那边，
   * 只按 source 过滤的话「本篇生词」会一直不涨。
   */
  const articleWords = useMemo(
    () => articleWordsOf(library, articleIdentity, docLemmas),
    [library, articleIdentity, docLemmas],
  )

  /** 生词本已有原形集合（速读里标记「已收录」）。 */
  const knownLemmas = useMemo(() => new Set(library.items.map((it) => it.lemma)), [library.items])
  /** 本篇已有语言点的句子数（侧栏显示用）。 */
  const languageSentCount = useMemo(
    () => (doc?.sentences ?? []).filter((s) => hasSentenceLanguage(s)).length,
    [doc],
  )
  /** 某一句来源的词条（含短语），给速读的「本句已在生词本」用。 */
  const wordsInSentence = useCallback(
    (sid: string) =>
      library.items
        .filter((it) => it.source?.fileName === articleIdentity && it.source.sentenceId === sid)
        .map((it) => it.word),
    [library.items, articleIdentity],
  )
  /**
   * 本篇生词编号：按**手动标记顺序**（createdAt 升序），同一时刻批量加入的
   * （如「自动标词」一次入库）再按**正文出现顺序**兜底，所以自动标词自然就是文中顺序。
   * 每篇文章独立编号，跨篇重置。`articleFirst` 记录每个词在正文首次出现的位置（用于上标）。
   */
  const { articleNums, articleFirst } = useMemo(() => {
    const nums = new Map<string, number>()
    const first = new Set<string>()
    if (!doc) return { articleNums: nums, articleFirst: first }
    const byLemma = new Map<string, VocabItem>()
    for (const it of articleWords) byLemma.set(it.lemma, it)
    // 每个 lemma 在正文的首次出现位置与顺序
    const docOrder = new Map<string, number>()
    for (const s of doc.sentences) {
      wordSpans(s.text).forEach((w, i) => {
        const lem = lemmaOf(w.text)
        if (byLemma.has(lem) && !docOrder.has(lem)) {
          docOrder.set(lem, docOrder.size)
          first.add(`${s.id}:${i}`)
        }
      })
    }
    const ordered = [...articleWords].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        (docOrder.get(a.lemma) ?? 1e9) - (docOrder.get(b.lemma) ?? 1e9) ||
        a.lemma.localeCompare(b.lemma),
    )
    ordered.forEach((it, i) => nums.set(it.lemma, i + 1))
    return { articleNums: nums, articleFirst: first }
  }, [doc, articleWords])
  /** 本篇打印情况：最近打印时间 + 是否全部打印过（用于「不重复打印」提示）。 */
  const articlePrintedAt = useMemo(() => {
    let latest: string | null = null
    for (const it of articleWords) {
      if (it.lastPrintedAt && (!latest || it.lastPrintedAt > latest)) latest = it.lastPrintedAt
    }
    return latest
  }, [articleWords])
  const articleAllPrinted = articleWords.length > 0 && articleWords.every((it) => !!it.lastPrintedAt)
  const applyingDom = useRef(false)
  const repo = useRef<VocabRepoPort | null>(null)
  const articles = useRef<ArticleRepoPort | null>(null)
  const batchMapRef = useRef<Record<string, BatchItem[]>>(loadBatchMap())
  const vocabStartRef = useRef<number | null>(null)
  const vocabAccumRef = useRef(0)
  const sessionPickedRef = useRef(0)
  const articleRef = useRef<HTMLElement | null>(null)
  const sideRef = useRef<HTMLElement | null>(null)
  const confirmTimerRef = useRef<number | null>(null)
  /** 右键按下中（右键期间跳过 selectionchange 处理，保住 Ctrl 多选的精确选区） */
  const rightDownRef = useRef(false)

  useEffect(() => {
    const r = createVocabRepo()
    repo.current = r
    r.load()
      .then((lib) => {
        // 加载时合并去重，保证不会出现两个同根词；顺手修早先版本误标的类型
        const fixed = normalizeGrammarMarks(repairLanguageKinds(dedupeLibrary(lib)))
        libraryRef.current = fixed
        setLibrary(fixed)
        setLibraryLoaded(true)
        const dirty = fixed.items.length !== lib.items.length || fixed.items.some((it, i) => it !== lib.items[i])
        if (dirty) r.save(fixed).catch(() => {})
      })
      .catch(() => setLibraryLoaded(true))
    // 申请持久存储，降低 IndexedDB 被浏览器回收的概率
    try {
      void navigator.storage?.persist?.()
    } catch {
      // 老浏览器忽略
    }
    const ar = createArticleRepo()
    articles.current = ar
    ar
      .list()
      .then((list) => {
        setSaved(list)
        setSavedLoaded(true)
      })
      .catch(() => setSavedLoaded(true))
    fetch(`${import.meta.env.BASE_URL}articles.json`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
      .then((b: ArticleBook) => setBook(b))
      .catch(() => setBookError(true))
  }, [])

  // 跟踪 Ctrl / ⌘ 按住状态（选择逻辑靠它切换「整句 / 按词吸附」）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true)
      if (e.key === 'Alt') setAltHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false)
      if (e.key === 'Alt') setAltHeld(false)
    }
    const blur = () => {
      setCtrlHeld(false)
      setAltHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // 键盘 W 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词时不触发）
  const toggleVocabRef = useRef<() => void>(() => {})
  const navVocabRef = useRef<(dir: 1 | -1) => void>(() => {})

  // 护眼主题：eye 已由 useLocalStorageState 存成 'green'/'dark'，这里只负责应用到 DOM
  useEffect(() => {
    document.documentElement.dataset.theme = eye ? 'green' : 'dark'
  }, [eye])

  // 待选清单按文章持久化
  useEffect(() => {
    batchMapRef.current[articleIdentity] = batch
    try {
      localStorage.setItem('reader:batch', JSON.stringify(batchMapRef.current))
    } catch {
      // 忽略
    }
  }, [batch, articleIdentity])
  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1900)
  }, [])

  /** 按住 Alt 点句子：把文本复制到剪贴板（方便拿去翻译）。 */
  const altCopyText = useCallback(
    (text: string) => {
      const t = (text ?? '').trim()
      if (!t) return
      navigator.clipboard?.writeText(t).then(
        () => flash('已复制（Alt 点击）'),
        () => flash('复制失败：可按住 Alt 拖选后按 Ctrl+C'),
      )
    },
    [flash],
  )

  const persist = useCallback((lib: VocabLibrary) => {
    libraryRef.current = lib
    setLibrary(lib)
    repo.current?.save(lib).catch(() => {})
  }, [])

  /**
   * 词库自动补全的**唯一写入口**（语言点收藏 + 离线例句）。
   * 纯计划与幂等保证在 core/libraryAutoFill.ts；接线与「不写第二个 effect」的约定在同名 hook 里。
   */
  const { lookupTatoeba, tatoebaReady } = useLibraryAutoFill({
    sentences: doc?.sentences ?? null,
    saved,
    articleIdentity,
    libraryRef,
    libraryLoaded,
    persist,
  })


  /** 删除词条：两步确认（第一次点变红「确认删除」，3 秒内再点才真删）。 */
  const askDelete = useCallback(
    (id: string) => {
      if (confirmDel === id) {
        persist(removeItem(library, id))
        setConfirmDel(null)
        if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
        return
      }
      setConfirmDel(id)
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = window.setTimeout(() => setConfirmDel(null), 3000)
    },
    [confirmDel, library, persist],
  )

  /** 记录今天新引入了一个词（用于每日配额）。 */
  const bumpNewToday = useCallback(() => {
    // newToday 已由 useLocalStorageState 落盘（自动带上当天日期）
    setNewToday((prev) => prev + 1)
  }, [setNewToday])

  /** 把背单词时长 / 评分次数累加到「今天」（落盘供统计）。 */
  const studyFlush = useCallback((seconds: number, cards: number) => {
    if (seconds <= 0 && cards <= 0) return
    setStudyDays((prev) => {
      const day = dayKeyLocal()
      const i = prev.findIndex((d) => d.day === day)
      if (i < 0) return [...prev, { day, seconds, cards }]
      const next = [...prev]
      next[i] = { day, seconds: next[i].seconds + seconds, cards: next[i].cards + cards }
      return next
    })
  }, [])

  /** 今天学过的不同单词 id（每日目标进度）。 */
  const studiedTodayIds = useMemo(() => {
    const t = dayKeyLocal()
    return studiedDays.find((d) => d.day === t)?.ids ?? []
  }, [studiedDays])

  /** 记「今天学过这个词」（每日目标按不同单词计数）。 */
  const markStudied = useCallback((itemId: string) => {
    setStudiedDays((prev) => {
      const day = dayKeyLocal()
      const cur = prev.find((d) => d.day === day)
      if (cur) {
        if (cur.ids.includes(itemId)) return prev
        return prev.map((d) => (d.day === day ? { ...d, ids: [...d.ids, itemId] } : d))
      }
      // 只留最近 200 天，免得无限长
      return [...prev, { day, ids: [itemId] }].slice(-200)
    })
  }, [])

  /** 记一笔学习活动（按天 / 分类累计，落盘）。 */
  const recordActivity = useCallback((cat: ActivityCat, n = 1) => {
    if (n <= 0) return
    setActivity((prev) => addActivity(prev, dayKeyLocal(new Date()), cat, n))
  }, [])

  /** 记一次练习成绩（考试 / 听写 / 听力理解）。 */
  const recordPractice = useCallback(
    (kind: PracticeKind, total: number, correct: number) => {
      if (total <= 0) return
      setPractice((prev) =>
        addPracticeRecord(prev, { at: new Date().toISOString(), kind, total, correct, articleId: articleIdentity || undefined }),
      )
    },
    [articleIdentity],
  )

  const addMistake = useCallback((entry: MistakeEntry) => {
    setMistakes((prev) => upsertMistake(prev, entry))
  }, [])
  const dropMistake = useCallback((id: string) => {
    setMistakes((prev) => removeMistake(prev, id))
  }, [])

  // ===== 背单词会话（hooks/useStudySession）=====
  const studyApi = useStudySession({
    library,
    articleIdentity,
    docLemmas,
    closeQuiz: () => quizApiRef.current?.close(),
    flash,
    persist,
    markStudied,
    recordActivity,
    addStudyTime: studyFlush,
    newLimit,
    newToday,
    onBumpNewToday: bumpNewToday,
  })
  const {
    scope: studyScope,
    spelling: studySpelling,
    setSpelling: setStudySpelling,
    mode: studyMode,
    queue: studyQueue,
    index: studyIndex,
    revealed: studyRevealed,
    setRevealed: setStudyRevealed,
    input: studyInput,
    setInput: setStudyInput,
    checked: studyChecked,
    setChecked: setStudyChecked,
    counts: studyCounts,
    liveSeconds: studyLive,
    cardSeconds,
    gradeInfo,
    editOpen: studyEditOpen,
    setEditOpen: setStudyEditOpen,
    pool: studyPool,
    draft: studyDraft,
    setDraft: setStudyDraft,
    delArmed: studyDelArmed,
    forgotCount: studyForgotCount,
    roundTotal: studyRoundTotal,
    extraCount: studyExtraCount,
    card: studyCard,
    dueCount,
    newCount,
    drillOn: studyDrillOn,
    drillAfter: studyDrillAfter,
    setDrillAfter: setStudyDrillAfter,
    clearDrill: studyClearDrill,
    unflushedSeconds: studyUnflushed,
    start: startStudy,
    switchMode,
    switchScope,
    startArticleAll,
    grade: gradeStudy,
    back: studyBack,
    markUnknown: studyMarkUnknown,
    close: closeStudy,
    retryForgot,
    openEdit: openStudyEdit,
    saveEdit: saveStudyEdit,
    removeCard: studyDelete,
  } = studyApi

  // ===== 考试会话（hooks/useQuizSession）=====
  const quizApi = useQuizSession({
    library,
    articleIdentity,
    docLemmas,
    doc,
    closeOthers: () => closeStudy(),
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
    onKinds: mergeKindStats,
  })
  quizApiRef.current = quizApi
  const {
    kinds: quizKinds,
    setKinds: setQuizKinds,
    scope: quizScope,
    setScope: setQuizScope,
    limit: quizLimit,
    setLimit: setQuizLimit,
    auto: quizAuto,
    setAuto: setQuizAuto,
    unique: quizUnique,
    setUnique: setQuizUnique,
    speakAfter: quizSpeak,
    setSpeakAfter: setQuizSpeak,
    articleKinds: quizArticleKinds,
    setArticleKinds: setQuizArticleKinds,
    articleRun: quizArticleRun,
    loopWrong: quizLoopWrong,
    setLoopWrong: setQuizLoopWrong,
    drillRound: quizDrillRound,
    setupOpen: quizSetupOpen,
    setSetupOpen: setQuizSetupOpen,
    queue: quizQueue,
    setQueue: setQuizQueue,
    index: quizIndex,
    input: quizInput,
    setInput: setQuizInput,
    checked: quizChecked,
    result: quizResult,
    results: quizResults,
    setResults: setQuizResults,
    seconds: quizSeconds,
    poolSizes: quizPoolSizes,
    availableCount: quizAvailableCount,
    start: startQuiz,
    startArticle: startArticleQuiz,
    startItems: startQuizItems,
    startDrill: startQuizDrill,
    startArticleDrill: startQuizArticleDrill,
    check: checkQuiz,
    next: nextQuiz,
    close: closeQuiz,
    retryWrong: retryQuizWrong,
  } = quizApi

  // ===== 听力理解会话（hooks/useListening）=====
  const listenApi = useListening({
    doc,
    articleIdentity,
    flash,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      quickApiRef.current?.close()
      dictApiRef.current?.close()
    },
  })
  listenApiRef.current = listenApi
  const {
    quiz: listenQuiz,
    setQuiz: setListenQuiz,
    open: listenOpen,
    setOpen: setListenOpen,
    questions: listenQuestions,
    answers: listenAnswers,
    setAnswers: setListenAnswers,
    submitted: listenSubmitted,
    result: listenResult,
    wrongIds: listenWrongIds,
    count: listenCount,
    setCount: setListenCount,
    copyPrompt: copyListeningPrompt,
    start: openListening,
    startQuestions: startListenQuestions,
    submit: submitListening,
    retryWrong: retryListenWrong,
    showAll: showAllListen,
  } = listenApi

  /** 理解题面板：听力模式 / 阅读理解（文本）模式。 */
  const [listenReadMode, setListenReadMode] = useState(false)
  const openListeningMode = useCallback(
    (read: boolean) => {
      setListenReadMode(read)
      openListening()
    },
    [openListening],
  )

  /** 逐句速读。 */
  const [speedReadOpen, setSpeedReadOpen] = useState(false)
  /** 手动加/改语言点。 */
  const [langOpen, setLangOpen] = useState(false)
  /** 语言点编辑的目标句（阅读页选中的句 / 速读当前句）。 */
  const [langTarget, setLangTarget] = useState<Sentence | null>(null)
  /** 今日计划。
   */
  const [planOpen, setPlanOpen] = useState(false)
  /** 精读工作流面板。 */
  const [intensiveOpen, setIntensiveOpen] = useState(false)
  /** 学习日志面板 + 选中的日期。 */
  const [journalOpen, setJournalOpen] = useState(false)
  const [journalDay, setJournalDay] = useState(() => dayKeyLocal(new Date()))
  /** 打印 / 导出面板。 */
  const [exportOpen, setExportOpen] = useState(false)
  /** 目标备忘面板 + 今日读文目标 + 自由备忘。 */
  const [goalOpen, setGoalOpen] = useState(false)
  const [readGoal, setReadGoal] = useLocalStorageState('reader:readGoal', 2, persistentNumber)
  const [goalMemo, setGoalMemo] = useLocalStorageState('reader:goalMemo', '', persistentString)
  /** 生词本排序方式。 */
  const [vocabSort, setVocabSort] = useLocalStorageState<VocabSortBy>(
    'reader:vocabSort',
    'updatedAt',
    persistentEnum(['word', 'createdAt', 'updatedAt', 'due'] as const, 'updatedAt'),
  )
  /** 已「通读」的文章标识（勾选，本地持久化）。 */
  const [skimmedArticles, setSkimmedArticles] = useLocalStorageState<string[]>('reader:intensiveSkimmed', [])
  const openSpeedRead = useCallback(() => {
    if (!doc?.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    closeStudy()
    setQuizSetupOpen(false)
    setQuizQueue(null)
    setQuickQueue(null)
    setListenOpen(false)
    setSpeedReadOpen(true)
  }, [doc, closeStudy, flash])

  /** 用指定片段开一轮听写（错题本「重练听写」用）。 */
  const startDictItems = useCallback((items: { id: string; text: string }[]) => {
    dictApiRef.current?.startItems(items)
  }, [])

  /** 错题本：重练考试错词。 */
  const retryMistakeVocab = useCallback(() => {
    const ids = mistakes.filter((m) => m.kind === 'vocab' && m.itemId).map((m) => m.itemId as string)
    if (!ids.length) {
      flash('没有考试错词')
      return
    }
    startQuizItems(ids)
  }, [mistakes, startQuizItems, flash])

  /** 错题本：重练听力错题。 */
  const retryMistakeListen = useCallback(() => {
    const qs = mistakes
      .filter((m) => m.kind === 'listen' && m.question)
      .map((m) => m.question as ListeningQuestion)
    if (!qs.length) {
      flash('没有听力错题')
      return
    }
    startListenQuestions(qs)
  }, [mistakes, startListenQuestions, flash])

  /** 错题本：重练听写漏词。 */
  const retryMistakeDict = useCallback(() => {
    const items = mistakes
      .filter((m) => m.kind === 'dict' && m.text)
      .map((m, i) => ({ id: `mk-${i}`, text: m.text as string }))
    if (!items.length) {
      flash('没有听写漏词')
      return
    }
    startDictItems(items)
  }, [mistakes, startDictItems, flash])

  /** 快刷：按到期优先排序，只看单词+音标，一键过卡。 */
  /** 快刷会话（逻辑在 hooks/useQuickSession）。 */
  const quickApi = useQuickSession({
    studyPool,
    library,
    persist,
    markStudied,
    recordActivity,
    flash,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
    },
  })
  quickApiRef.current = quickApi
  const {
    queue: quickQueue,
    setQueue: setQuickQueue,
    index: quickIndex,
    revealed: quickRevealed,
    setRevealed: setQuickRevealed,
    start: startQuick,
    grade: gradeQuick,
  } = quickApi

  /** 选词模式：把词加入 / 移出待选清单（同词按 lemma 去重）。 */
  const addToBatch = useCallback((words: string[], sentence: string, sentenceId: string | null) => {
    setBatch((prev) => {
      const next = [...prev]
      for (const w of words) {
        const key = lemmaOf(w)
        const i = next.findIndex((x) => lemmaOf(x.word) === key)
        if (i >= 0) next.splice(i, 1)
        else next.push({ word: w, sentence, sentenceId })
      }
      return next
    })
  }, [])

  /** 批量并入选区/待选（按 lemma 去重）。用于自动标词导入。 */
  const mergeBatch = useCallback((items: BatchItem[]) => {
    setBatch((prev) => {
      const next = [...prev]
      for (const it of items) {
        const key = lemmaOf(it.word)
        if (!next.some((x) => lemmaOf(x.word) === key)) next.push(it)
      }
      return next
    })
  }, [])

  /** 把一串词映射成待选项，并尽量在正文里找到它所在的句子（回填来源）。 */
  const batchItemsFromWords = useCallback(
    (words: string[]): BatchItem[] =>
      words.map((w) => {
        const key = lemmaOf(w)
        const s = doc?.sentences.find((x) =>
          wordSpans(x.text).some(
            (t) => t.text.toLowerCase() === w.toLowerCase() || lemmaOf(t.text) === key,
          ),
        )
        return { word: w, sentence: s?.text ?? '', sentenceId: s?.id ?? null }
      }),
    [doc],
  )

  /** 把词条**直接**加进生词本（跳过「待选」）。用于「自动标词」直入模式。 */
  const commitBatchItems = useCallback(
    (items: BatchItem[]) => {
      const valid = items.filter((it) => it.word.trim())
      if (!valid.length) return
      let lib = libraryRef.current
      for (const it of valid) {
        lib = markWord(lib, {
          word: it.word,
          articleId: articleTitle || articleKey || '手动粘贴',
          fileName: articleIdentity,
          sentenceId: it.sentenceId,
          sentenceText: it.sentence,
        }).library
      }
      persist(lib)
    },
    [persist, articleTitle, articleKey, articleIdentity],
  )

  /** 速读里手动加生词/词组（可一次多个；针对自动标词漏掉的）。 */
  const addItemsToVocab = useCallback(
    (items: { word: string; sentenceId: string | null; sentenceText: string }[]) => {
      const list = items.map((it) => ({ ...it, word: it.word.trim() })).filter((it) => it.word)
      if (!list.length) return
      let lib = library
      let created = 0
      for (const it of list) {
        const r = markWord(lib, {
          word: it.word,
          articleId: articleTitle || articleKey || '手动粘贴',
          fileName: articleIdentity,
          sentenceId: it.sentenceId,
          sentenceText: it.sentenceText,
        })
        lib = r.library
        if (r.created) created++
      }
      persist(lib)
      const names = list.map((it) => it.word).join('、')
      flash(created ? `已加入 ${created} 个生词：${names}` : `已在生词本：${names}`)
    },
    [library, articleIdentity, articleTitle, articleKey, persist, flash],
  )

  /** 把语言点里的词组 / 习语一键加入生词本：`英文 — 中文` 拆成 词条 + 释义。 */
  const addPhrasesToVocab = useCallback(
    (items: string[], sentence: Sentence | null) => {
      if (!items.length) return
      let lib = library
      let created = 0
      for (const raw of items) {
        const { word, gloss } = splitGlossText(raw)
        if (!word) continue
        const r = markWord(lib, {
          word,
          articleId: articleTitle || articleKey || '手动粘贴',
          fileName: articleIdentity,
          sentenceId: sentence?.id ?? null,
          sentenceText: sentence?.text ?? '',
          meaning: gloss,
        })
        lib = r.library
        if (r.created) created++
      }
      persist(lib)
      flash(created ? `已加入 ${created} 个词组 / 习语${created < items.length ? '（其余已在生词本）' : ''}` : '这些词组 / 习语都已在生词本里（语言点会自动收藏）')
    },
    [library, articleTitle, articleKey, articleIdentity, persist, flash],
  )

  /** 速读里把误加的词从生词本移出（两步确认在面板里做）。 */
  const removeWordFromVocab = useCallback(
    (word: string) => {
      const lem = lemmaOf(word)
      const item = library.items.find((it) => it.lemma === lem)
      if (!item) {
        flash(`不在生词本：${word}`)
        return
      }
      persist(removeItem(library, item.id))
      flash(`已移出生词本：${item.word}`)
    },
    [library, persist, flash],
  )

  /** 复制听力理解题出题提示词。 */
  const copyLanguagePrompt = useCallback(async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    setLastTask('language')
    askedWordsRef.current = []
    askedIdsRef.current = doc.sentences.map((s) => s.id)
    try {
      await navigator.clipboard.writeText(
        buildLanguagePrompt(doc.sentences.map((s) => ({ id: s.id, text: s.text }))),
      )
      flash('已复制语言点分析提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [doc, flash])

  /** 仿写训练（逻辑在 hooks/useWriting）。 */
  const {
    open: writingOpen,
    setOpen: setWritingOpen,
    model: writingModel,
    setModel: setWritingModel,
    task: writingTask,
    setTask: setWritingTask,
    text: writingText,
    setText: setWritingText,
    feedback: writingFeedback,
    setFeedback: setWritingFeedback,
    history: writingHistory,
    setHistory: setWritingHistory,
    start: openWriting,
    copyImitationTask,
    copyFeedback,
    loadRecord: loadWritingRecord,
  } = useWriting({
    doc,
    selectedId,
    flash,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      quickApiRef.current?.close()
      dictApiRef.current?.close()
      setListenOpen(false)
    },
  })

  // 听力理解题 / 仿写：Esc 退出
  useEffect(() => {
    if (!listenOpen && !writingOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setListenOpen(false)
        setWritingOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listenOpen, writingOpen])

  /** 记一次选词模式会话（sessions 由 useLocalStorageState 落盘，最多留 500 条）。 */
  const recordSession = useCallback((seconds: number, picked: number) => {
    if (seconds < 1 && picked === 0) return
    setSessions((prev) => [...prev, { at: new Date().toISOString(), seconds, picked }].slice(-500))
  }, [setSessions])

  /** 开关选词模式：开时开始计时，关时记一次会话。 */
  const toggleVocabMode = useCallback(() => {
    if (vocabMode) {
      const start = vocabStartRef.current
      const seconds = Math.round(vocabAccumRef.current + (start ? (Date.now() - start) / 1000 : 0))
      recordSession(seconds, sessionPickedRef.current)
      vocabStartRef.current = null
      vocabAccumRef.current = 0
      setVocabMode(false)
    } else {
      vocabStartRef.current = Date.now()
      vocabAccumRef.current = 0
      sessionPickedRef.current = 0
      setVocabSeconds(0)
      setVocabMode(true)
    }
  }, [vocabMode, recordSession])

  // 计时：选词模式打开时每秒刷新
  useEffect(() => {
    if (!vocabMode) return
    const id = window.setInterval(() => {
      const start = vocabStartRef.current
      setVocabSeconds(Math.round(vocabAccumRef.current + (start ? (Date.now() - start) / 1000 : 0)))
    }, 1000)
    return () => window.clearInterval(id)
  }, [vocabMode])

  // 切走标签页就暂停计时（只算真正盯着读的时间）
  useEffect(() => {
    if (!vocabMode) return
    const onVis = () => {
      if (document.hidden) {
        if (vocabStartRef.current) {
          vocabAccumRef.current += (Date.now() - vocabStartRef.current) / 1000
          vocabStartRef.current = null
        }
      } else if (!vocabStartRef.current) {
        vocabStartRef.current = Date.now()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [vocabMode])

  const totals = useMemo(() => sessionTotals(sessions), [sessions])

  /** 背单词时长统计：累计 / 今日 / 评分次数；显示时加上本轮尚未落盘的部分。 */
  const studyStats = useMemo(() => studyTotals(studyDays), [studyDays])

  /** 今日计划用：今天背了几张、写了几条。 */
  const todayKey = dayKeyLocal(new Date())
  const todayCards = useMemo(() => studyDays.find((d) => d.day === todayKey)?.cards ?? 0, [studyDays, todayKey])
  const todayWrites = useMemo(() => {
    let n = 0
    for (const r of writingHistory) {
      try {
        if (dayKeyLocal(new Date(r.at)) === todayKey) n++
      } catch {
        // 忽略
      }
    }
    return n
  }, [writingHistory, todayKey])
  const studyTotalSeconds = studyStats.totalSeconds
  const studyTotalCards = studyStats.totalCards
  const studyTodaySeconds = studyStats.todaySeconds
  const studyGrandSeconds = studyTotalSeconds + studyUnflushed

  /** 按天统计：今天选了多少 + 连续打卡天数。 */
  const dayStats = useMemo(() => pickDayStats(sessions), [sessions])

  /** 最近 7 天每天选了多少词（统计面板用）。 */
  const last7 = useMemo(() => last7Days(sessions), [sessions])

  /** 未来 30 天每天的到期词数（到期日历热力图用）。 */
  const dueForecastRows = useMemo(() => dueForecast(library.items), [library.items])

  /** 已保存文章按「书」分组（EPUB 导入的用书名）。 */
  const savedGroups = useMemo(() => {
    const map = new Map<string, SavedArticle[]>()
    for (const a of saved) {
      const b = a.book || '单篇'
      const arr = map.get(b)
      if (arr) arr.push(a)
      else map.set(b, [a])
    }
    return [...map.entries()]
  }, [saved])

  /** 按文章统计生词产出（Top 10）。 */
  const byArticle = useMemo(() => wordsByArticle(library.items), [library.items])

  /** 还缺 AI 混淆项、且有释义的词（生成干扰项用）。 */
  const confusableTodo = useMemo(
    () => library.items.filter((it) => isWordEntry(it) && it.meaning && !it.confusables?.length),
    [library.items],
  )
  /** 一次生成多少（可自选；0=全部）；应用后再点，处理下一批。 */
  const confusableBatch = useMemo(
    () => (confusableBatchSize > 0 ? confusableTodo.slice(0, confusableBatchSize) : confusableTodo),
    [confusableTodo, confusableBatchSize],
  )

  /** 疑似「非原型」的词（word 与 lemma 不一致）——供 AI 校正原形。 */
  const lemmaCandidates = useMemo(
    () => library.items.filter((it) => isWordEntry(it) && normalizeWord(it.word) !== it.lemma).slice(0, 100),
    [library.items],
  )

  /** 含 -ing / -ed 形式的词或短语——供 AI 辨析语法身份。 */
  const posCandidates = useMemo(() => {
    const hasIngEd = (s: string) => s.split(/\s+/).some((t) => /(ing|ed)$/i.test(t))
    return library.items
      .filter((it) => isWordEntry(it) && (hasIngEd(it.word) || normalizeWord(it.word) !== it.lemma))
      .slice(0, 60)
  }, [library.items])

  /** 生词本里所有词形 + lemma（正文里据此标出"生词"并可点）。 */
  const libraryLemmas = useMemo(() => {
    const s = new Set<string>()
    for (const it of library.items) {
      s.add(it.word.toLowerCase())
      s.add(it.lemma)
    }
    return s
  }, [library.items])

  /** 听写会话（队列 / 判分 / 自动下一句 / 错题重练）；逻辑在 hooks/useDictation。 */
  const dictApi = useDictation({
    doc,
    libraryLemmas,
    speak,
    warmTexts,
    warmTimings,
    flash,
    mergeBatch,
    batchItemsFromWords,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
    closeOthers: () => {
      closeStudy()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      setQuickQueue(null)
    },
  })
  // 供定义在 hook 之前的少数回调（打开听力/仿写、错题重练）通过 ref 调用
  dictApiRef.current = dictApi
  const {
    mode: dictMode,
    words: dictWords,
    blankCount: dictBlankCount,
    clozeWords: dictClozeWords,
    maxQuestions: dictMaxQuestions,
    roundInfo: dictRoundInfo,
    queue: dictQueue,
    index: dictIndex,
    input: dictInput,
    checked: dictChecked,
    diff: dictDiff,
    blanks: dictBlanks,
    results: dictResults,
    wrongItems: dictWrongItems,
    cloze: dictCloze,
    setInput: setDictInput,
    setBlank: setDictBlank,
    start: startDictation,
    check: checkDict,
    next: nextDict,
    retryWrong: retryDictWrong,
    wrongNow: dictWrongNow,
    close: closeDict,
  } = dictApi

  // 键盘 W 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词/听写/考试/快刷时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 全屏练习/速读/语言点编辑打开时，别抢键盘（它们各有自己的按键）
      if (studyQueue || quizQueue || quickQueue || dictQueue) return
      if (speedReadOpen || listenOpen || langOpen) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'w') toggleVocabRef.current()
      else if (k === 'a') navVocabRef.current(-1)
      else if (k === 'd') navVocabRef.current(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studyQueue, quizQueue, speedReadOpen, listenOpen, langOpen])

  /** 待选里「还没入库」的词（已入库的隐藏，避免和生词本重复）。 */
  const visibleBatch = useMemo(
    () => batch.filter((b) => !libraryLemmas.has(lemmaOf(b.word))),
    [batch, libraryLemmas],
  )

  /** 未掌握的词（a/d 只在这些句子里跳）。 */
  const activeLemmas = useMemo(() => {
    const s = new Set<string>()
    for (const it of library.items) {
      if (it.status === 'mastered') continue
      s.add(it.word.toLowerCase())
      s.add(it.lemma)
    }
    return s
  }, [library.items])

  /**
   * 有生词的句子 id，按正文顺序。
   * 直接看「这句话里有没有生词（按 lemma）」——和正文里的琥珀下划线一致，
   * 不依赖词条记的 source（更直观，a/d 不会因为没记来源就找不到）。
   */
  const vocabSids = useMemo(() => {
    if (!doc) return []
    const batchSids = new Set<string>()
    for (const b of batch) if (b.sentenceId) batchSids.add(b.sentenceId)
    return doc.sentences
      .filter((s) => {
        if (batchSids.has(s.id)) return true
        const set = sentenceLemmas.get(s.id)
        if (!set) return false
        for (const l of set) if (activeLemmas.has(l)) return true
        return false
      })
      .map((s) => s.id)
  }, [doc, sentenceLemmas, activeLemmas, batch])
  const vocabSidSet = useMemo(() => new Set(vocabSids), [vocabSids])

  // 考试听力题出现时自动朗读（句子 / 单词）
  useEffect(() => {
    if (!quizQueue) return
    const q = quizQueue[quizIndex]
    if ((q?.kind === 'listen' || q?.kind === 'ear') && q.audioText) speak(q.audioText)
  }, [quizQueue, quizIndex, speak])

  // 听写：每换一句自动播放
  useEffect(() => {
    if (!dictQueue || dictIndex >= dictQueue.length) return
    speak(dictQueue[dictIndex].text)
  }, [dictQueue, dictIndex, speak])

  /** 点句子：切换选中；再点同一句 = 停止朗读。 */
  toggleVocabRef.current = toggleVocabMode


  const resetSelection = useCallback(() => {
    setSelectedId(null)
    setExact('')
    setUseExact(false)
    setBatch([])
    setPeekSid(null)
    setLastPicked(null)
    setConfirmDelSave(false)
    setSelSid(null)
    setSelIndices([])
  }, [])

  /** 文章文档管理（加载/保存/删除/改名/编辑/自动存/恢复）；逻辑在 hooks/useReaderDoc。 */
  const {
    loadSaved,
    saveCurrent,
    askDeleteSave,
    renameArticle,
    enterEdit,
    applyEdit,
    cancelEdit,
    onPick,
    bookKeys,
    editions,
    shownKeys,
  } = useReaderDoc({
    articles,
    batchMapRef,
    setBatch,
    resetSelection,
    flash,
    book,
    articleKey,
    setArticleKey,
    doc,
    setDoc,
    articleTitle,
    setArticleTitle,
    saved,
    setSaved,
    savedLoaded,
    savedId,
    setSavedId,
    pendingSave,
    setPendingSave,
    sourceText,
    setSourceText,
    setEditing,
    draft,
    setDraft,
    articleBook,
    setArticleBook,
    confirmDelSave,
    setConfirmDelSave,
    edition,
  })

  /** 新建/导入文章（含 PDF/EPUB 与清洗提示词）。 */
  const { copyCleanupPrompt, createArticle, onImportFiles, onPickPdf, onPickEpub } = useArticleImport({
    repo: articles,
    setSaved,
    loadSaved,
    newBook,
    pdfRange,
    manual,
    newTitle,
    setManual,
    setNewTitle,
    setNewBook,
    setComposing,
    setImporting,
    flash,
  })

  const currentValue = savedId ? `s:${savedId}` : articleKey ? `b:${articleKey}` : ''


  /** 选区所在的句子 —— 默认的操作对象。 */
  const sentence = useMemo(() => {
    if (!doc) return null
    if (selectedId) {
      const s = doc.sentences.find((x) => x.id === selectedId)
      if (s) return s
    }
    if (exact) return doc.sentences.find((x) => x.text.includes(exact)) ?? null
    return null
  }, [doc, selectedId, exact])

  /** 打开语言点编辑（针对指定句子）。 */
  const openLangFor = useCallback((s: Sentence | null) => {
    if (!s) return
    setLangTarget(s)
    setLangOpen(true)
  }, [])

  /** 手动保存语言点列表（写回目标句的 languages）。 */
  const saveLanguage = useCallback(
    (langs: SentenceLanguage[]) => {
      const target = langTarget
      if (!target) return
      const sid = target.id
      setDoc((d) =>
        d
          ? { ...d, sentences: d.sentences.map((s) => (s.id === sid ? { ...s, languages: langs, language: undefined } : s)) }
          : d,
      )
      setPendingSave(true)
      setLangOpen(false)
      flash(langs.length ? `已保存语言点（${langs.length} 条）` : '已清空该句语言点')
    },
    [langTarget, setDoc, setPendingSave, flash],
  )

  /** 实际用于提示词/复制的文本：默认整句；有精确选区时用选区。 */
  const target = useExact && exact ? exact : sentence?.text || exact

  /** 选区/划词（逻辑在 hooks/useSelection）。 */
  const {
    selectSentence,
    focusEntry,
    jumpToSource,
    onMouseUp,
    onMouseDown,
    onContextMenu,
    addSelectionToBatch,
    mark,
  } = useSelection({
    selectedId,
    setSelectedId,
    exact,
    setExact,
    setUseExact,
    selSid,
    setSelSid,
    selIndices,
    setSelIndices,
    ctrlHeld,
    altHeld,
    peekSid,
    setPeekSid,
    lastPicked,
    setLastPicked,
    setBubblePos,
    batch,
    addToBatch,
    sentence,
    vocabMode,
    editing,
    doc,
    library,
    persist,
    articleIdentity,
    articleTitle,
    articleKey,
    setFocusLemma,
    articleRef,
    sideRef,
    applyingDom,
    rightDownRef,
    sessionPickedRef,
    navVocabRef,
    stopReadAll,
    fontSize,
    bold,
    serif,
    flash,
  })

  /** 点正文生词：先切到「生词本」Tab（默认在「总览」时词表是 display:none），再滚到对应词条。 */
  const revealVocabWord = useCallback(
    (word: string) => {
      setSideTab('vocab')
      focusEntry(word)
    },
    [focusEntry, setSideTab],
  )

  /**
   * 听写播放：整句模式复用整句音频 + 逐词 seek（零额外合成）；填空并段没有源句，直接播该块。
   */
  const playDictItem = useCallback(
    (item: { text: string; src?: string; sw?: number; ew?: number }) => {
      if (item.src && item.sw != null && item.ew != null) speakRange(item.src, item.sw, item.ew)
      else speak(item.text)
    },
    [speak, speakRange],
  )

  /**
   * 点句子：选中；开了「选中朗读」就在**点击手势里**直接读新句。
   * 不放在 useEffect 里，避免被「先 mouseup 选中、再 click 当成重点同句停掉」的时序问题打断。
   */
  const selectSentenceAndRead = useCallback(
    (sid: string) => {
      const wasSelected = selectedId === sid
      const s = doc?.sentences.find((x) => x.id === sid)
      selectSentence(sid)
      if (!wasSelected && autoSpeak && s && s.text.trim()) speak(s.text)
    },
    [selectedId, doc, selectSentence, autoSpeak, speak],
  )

  /** 各类「复制提示词给 AI」的动作（逻辑在 hooks/useAiTasks）。 */
  const {
    copyPrompt,
    commitBatch,
    copyBatchPrompt,
    copyMissingPhonetic,
    copyTranslateAll,
    copyAutoVocab,
    copyConfusablePrompt,
    copyLemmaPrompt,
    copyPosPrompt,
    dedupeNow,
  } = useAiTasks({
    exact,
    useExact,
    sentence,
    visibleBatch,
    library,
    persist,
    articleIdentity,
    articleTitle,
    articleKey,
    doc,
    vocabLevel,
    confusableBatch,
    confusableTodo,
    lemmaCandidates,
    posCandidates,
    flash,
    setLastTask,
    setBatch,
    askedWordsRef,
    askedIdsRef,
  })

  /** 应用一份 AI 结果（按任务分派）；逻辑在 hooks/useApplyTaskResult。 */
  const applyTaskResult = useApplyTaskResult({
    library,
    libraryRef,
    sentence,
    persist,
    mergeBatch,
    batchItemsFromWords,
    autoVocabDirect,
    commitBatchItems,
    articleTitle,
    articleKey,
    articleIdentity,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
    ecdictLevel: vocabLevel,
    articleText: (doc?.sentences ?? []).map((s) => s.text).join(' '),
    sentenceForWord: (word) => {
      const it = batchItemsFromWords([word])[0]
      return { sentence: it?.sentence ?? '', sentenceId: it?.sentenceId ?? null }
    },
    setDoc,
    setPendingSave,
    setListenQuiz,
    setWritingTask,
    setWritingFeedback,
    setWritingHistory,
  })

  const applyPaste = useCallback(() => {
    const raw = pasted.trim()
    if (!raw) return
    // 语言点 JSON 若没先点过「语言点」按钮（lastTask≠language），会被当成翻译空转。
    // 这里自动识别：含 structure/grammar/idioms/phrases/usage 且没有 translation → 按语言点应用。
    const looksLikeLang = /"(structure|grammar|idioms|phrases|usage)"\s*:/.test(raw) && !/"translation"\s*:/.test(raw)
    const task = lastTask === 'language' || looksLikeLang ? 'language' : lastTask
    const res = applyTaskResult(task, raw, askedWordsRef.current, askedIdsRef.current)
    setPasteReport(res.report)
    setPasteMissing(res.missing)
    if (res.ok) {
      setPasted('')
      flash(res.report[0] ?? '已应用')
    } else {
      flash(res.report[0] ?? '没解析出内容')
    }
  }, [pasted, lastTask, applyTaskResult, flash])

  /** 把上次未返回的词重新组成提示词，一键复制重试。 */
  const copyMissingAgain = useCallback(async () => {
    if (!pasteMissing || !pasteMissing.words.length) return
    const { task, words } = pasteMissing
    const byLemma = new Map(library.items.map((it) => [it.lemma, it]))
    try {
      if (task === 'confusable') {
        const entries = words.map((w) => {
          const it = byLemma.get(lemmaOf(w))
          return { word: it?.word ?? w, meaning: it?.meaning ?? null }
        })
        askedWordsRef.current = words
        askedIdsRef.current = []
        setLastTask('confusable')
        await navigator.clipboard.writeText(buildConfusablePrompt(entries))
      } else if (task === 'lemma') {
        const entries = words.map((w) => {
          const it = byLemma.get(lemmaOf(w))
          return { word: it?.word ?? w, context: it?.source?.sentenceText }
        })
        askedWordsRef.current = words
        askedIdsRef.current = []
        setLastTask('lemma')
        await navigator.clipboard.writeText(buildLemmaPrompt(entries))
      } else if (task === 'pos') {
        const entries = words.map((w) => {
          const it = byLemma.get(lemmaOf(w))
          return { word: it?.word ?? w, context: it?.source?.sentenceText }
        })
        askedWordsRef.current = words
        askedIdsRef.current = []
        setLastTask('pos')
        await navigator.clipboard.writeText(buildPosPrompt(entries))
      } else if (task === 'phrase') {
        const entries = words.map((w) => {
          const it = byLemma.get(lemmaOf(w))
          return { word: it?.word ?? w, meaning: it?.meaning ?? null }
        })
        askedWordsRef.current = words
        askedIdsRef.current = []
        setLastTask('phrase')
        await navigator.clipboard.writeText(buildPhrasePrompt(entries))
      } else if (task === 'grammar_mark') {
        const entries = words.map((w) => {
          const it = byLemma.get(lemmaOf(w))
          return { word: it?.word ?? w, meaning: it?.meaning ?? null }
        })
        askedWordsRef.current = words
        askedIdsRef.current = []
        setLastTask('grammar_mark')
        await navigator.clipboard.writeText(buildGrammarMarkPrompt(entries))
      } else {
        const entries = words.map((w) => {
          const it = byLemma.get(lemmaOf(w))
          return { word: it?.word ?? w, context: it?.source?.sentenceText }
        })
        askedWordsRef.current = words
        askedIdsRef.current = []
        setLastTask('lookup')
        await navigator.clipboard.writeText(buildBatchLookupPrompt(entries))
      }
      flash(`已复制缺失的 ${words.length} 个词，去 AI 后再贴回`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [pasteMissing, library.items, flash])

  /** 导出 / 打印 / 备份；逻辑在 hooks/useExport。 */
  /** 「读完一篇」的记账（localStorage + 派生值 + 动作）——接线在 hooks/useReadDone，规则在 core/goals。 */
  const { readDone, todayReadDone, articleReadDay, readDays, markReadDone, undoReadDone, setReadDone } = useReadDone({
    articleIdentity,
    articleTitle,
    articleKey,
    todayKey,
    flash,
  })

  const {
    download,
    doExportAnki,
    exportJson,
    exportWordList,
    exportBatch,
    doExportWrong,
    exportAll,
    onImportBackup,
    onMergeBackup,
    doPrint,
  } = useExport({
    articles,
    library,
    saved,
    sessions,
    studyDays,
    activity,
    writingHistory,
    practice,
    mistakes,
    readDone,
    readGoal,
    goalMemo,
    visibleBatch,
    persist,
    flash,
    setSaved,
    setSessions,
    setStudyDays,
    setActivity,
    setWritingHistory,
    setPractice,
    setMistakes,
    setReadDone,
    setReadGoal,
    setGoalMemo,
  })


  /** 由当前数据推导 AI 待办（纯逻辑在 core/aiPackage，便于单测）。 */
  const aiJobsInput = useMemo<AiJobsInput>(
    () => ({
      batch: visibleBatch.map((b) => ({ word: b.word, sentence: b.sentence })),
      items: library.items,
      articleWords,
      scope: aiPackScope,
      confusableBatchSize,
      articleId: articleIdentity,
      sentences: doc?.sentences ?? [],
      vocabLevel,
      hasListenQuiz: !!listenQuiz,
      listenCount,
    }),
    [
      visibleBatch,
      library,
      articleWords,
      aiPackScope,
      confusableBatchSize,
      articleIdentity,
      doc,
      vocabLevel,
      listenQuiz,
      listenCount,
    ],
  )

  /** 本篇掌握度：词（SRS）+ 精读完成度 + 本篇技能正确率 + 本篇错题。 */
  const articleMastery = useMemo(() => {
    const words = articleWords
    let stable = 0
    let due = 0
    let lapsed = 0
    let fresh = 0
    for (const it of words) {
      if (isStable(it)) stable += 1
      if (isDue(it)) due += 1
      if ((it.reviewState.lapses ?? 0) > 0) lapsed += 1
      if (it.reviewState.repetitions === 0) fresh += 1
    }
    const sents = doc?.sentences ?? []
    const reading = {
      sentences: sents.length,
      translated: sents.filter((s) => s.translation).length,
      language: sents.filter((s) => hasSentenceLanguage(s)).length,
    }
    const stat = (kind: PracticeKind) => {
      const rows = practiceForArticle(practice, articleIdentity).filter((r) => r.kind === kind)
      const total = rows.reduce((a, r) => a + r.total, 0)
      const correct = rows.reduce((a, r) => a + r.correct, 0)
      return total > 0 ? { total, correct } : undefined
    }
    const mine = mistakes.filter((m) => {
      if (m.kind === 'vocab') return !!m.itemId && words.some((it) => it.id === m.itemId)
      if (m.kind === 'listen') return m.articleId === articleIdentity
      if (m.kind === 'dict') return !!m.text && sents.some((s) => s.text.includes(m.text ?? ''))
      return false
    })
    return buildArticleMastery({
      words: { total: words.length, stable, due, lapsed, fresh },
      reading,
      skills: { quiz: stat('quiz'), dictation: stat('dictation'), listening: stat('listening') },
      mistakes: {
        words: mine.filter((m) => m.kind === 'vocab').length,
        sentences: mine.filter((m) => m.kind !== 'vocab').length,
      },
    })
  }, [articleWords, doc, practice, mistakes, articleIdentity])

  /** 精读工作流：按本篇当前数据算出各阶段进度与下一步。 */
  const intensiveSkimmed = skimmedArticles.includes(articleIdentity)
  const intensivePlan = useMemo(() => {
    const w = articleWords
    const quizRows = practiceForArticle(practice, articleIdentity).filter((r) => r.kind === 'quiz')
    const quizTotal = quizRows.reduce((a, r) => a + r.total, 0)
    const quizCorrect = quizRows.reduce((a, r) => a + r.correct, 0)
    const sents = doc?.sentences ?? []
    return buildIntensivePlan({
      hasDoc: !!doc,
      skimmed: intensiveSkimmed,
      words: {
        total: w.length,
        withMeaning: w.filter((it) => !!it.meaning).length,
        withChunks: w.filter((it) => it.usage.length > 0 || (it.phrases?.length ?? 0) > 0).length,
        withMarks: w.filter((it) => (it.grammarMarks?.length ?? 0) > 0).length,
        studied: w.filter((it) => it.reviewState.repetitions > 0).length,
        stable: w.filter((it) => isStable(it)).length,
        due: w.filter((it) => isDue(it)).length,
        noExample: w.filter((it) => !hasOwnExamples(it)).length,
      },
      sentences: {
        total: sents.length,
        translated: sents.filter((s) => !!s.translation).length,
        language: sents.filter((s) => hasSentenceLanguage(s)).length,
      },
      quiz: quizTotal > 0 ? { total: quizTotal, correct: quizCorrect } : undefined,
      writes: writingHistory.filter((r) => r.articleId === articleIdentity).length,
    })
  }, [doc, articleWords, practice, articleIdentity, writingHistory, intensiveSkimmed])

  /** 本篇的复述记录。 */
  const myRetells = useMemo(
    () => retells.filter((r) => r.articleId === articleIdentity),
    [retells, articleIdentity],
  )

  /** 产出看板：词块/搭配/习语正确率 + 仿写 + 复述 的量化。 */
  const outputBoard = useMemo(() => {
    const ks = kindStats[articleIdentity] ?? {}
    const sumKinds = (list: string[]) => {
      let total = 0
      let correct = 0
      for (const k of list) {
        const s = ks[k]
        if (s) {
          total += s.total
          correct += s.correct
        }
      }
      return { total, correct }
    }
    const chunkStats = sumKinds(['usage', 'collocation', 'prep', 'idiom'])
    const grammarStats = sumKinds(['grammar', 'phraseBlank', 'functionWord', 'ordering', 'translate', 'translate2'])
    const writes = writingHistory.filter((r) => r.articleId === articleIdentity)
    const avgScore = writes.length
      ? Math.round(
          writes.reduce(
            (a, r) => a + (r.feedback.max > 0 ? (r.feedback.total / r.feedback.max) * 100 : 0),
            0,
          ) / writes.length,
        )
      : null
    return buildOutputBoard({
      chunkStats,
      grammarStats,
      words: {
        total: articleWords.length,
        withChunks: articleWords.filter((it) => it.usage.length > 0 || (it.phrases?.length ?? 0) > 0).length,
        studied: articleWords.filter((it) => it.reviewState.repetitions > 0).length,
        stable: articleWords.filter((it) => isStable(it)).length,
      },
      writes: { count: writes.length, avgScore },
      retells: { count: myRetells.length, words: myRetells.reduce((a, r) => a + r.words, 0) },
      streak: activityStreak(activity),
    })
  }, [kindStats, articleIdentity, writingHistory, articleWords, myRetells, activity])

  /** 一键：给「还没有自己例句」的本篇生词，批量补离线例句（Tatoeba）。 */
  const enrichExamplesFromTatoeba = useCallback(async () => {
    const ok = await loadTatoeba()
    if (!ok) {
      flash('离线例句未安装：先跑 `node tools/build-tatoeba.mjs <sentences.tsv> <links.tsv> cmn --en-only` 生成 public/tatoeba-en.tsv')
      return
    }
    const targets = articleWords.filter((it) => !hasOwnExamples(it))
    if (!targets.length) {
      flash('本篇生词都已经有例句了（只有「来源句」的会算缺）')
      return
    }
    let missing = 0
    for (const it of targets) if (!tatoebaExamples(it.word, it.lemma).length) missing++
    const rows = collectOfflineExampleRows(targets, lookupTatoeba)
    if (!rows.length) {
      flash(`离线例句库里有 ${missing} 个都查不到（可让 AI 补例句）`)
      return
    }
    persist(applyExamples(library, rows, new Date(), 'tatoeba'))
    flash(`已给 ${rows.length} 个词补上离线例句（Tatoeba）${missing ? `；${missing} 个库里没有` : ''}`)
  }, [articleWords, library, persist, flash])

  /** 学习日志：按天回顾。 */
  const journalInput = useMemo(
    () => ({
      studied: studiedDays,
      items: library.items,
      articles: saved.map((a) => ({ id: a.id, title: a.title, sentences: a.sentences })),
      activity,
      practice,
    }),
    [studiedDays, library.items, saved, activity, practice],
  )
  const journalAllDays = useMemo(() => journalDays(journalInput), [journalInput])
  const journalData = useMemo(() => buildJournalDay(journalInput, journalDay), [journalInput, journalDay])
  const journalSummaryRows = useMemo(() => journalSummary(journalInput), [journalInput])
  const journalHeat = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of activity) counts[a.day] = dayTotal(a)
    return buildHeatmap(counts, 13)
  }, [activity])

  /** 打印面板：已保存文章 + 每篇正文里的 lemma（用于「按篇」）。 */
  const exportArticles = useMemo(
    () =>
      saved.map((a) => {
        const lemmas = new Set<string>()
        for (const s of a.sentences) for (const w of wordSpans(s.text)) lemmas.add(lemmaOf(w.text))
        return { id: a.id, title: a.title, lemmas }
      }),
    [saved],
  )

  /** 记一条复述打卡。 */
  const saveRetell = useCallback(    (text: string) => {
      const t = text.trim()
      if (!t || !articleIdentity) return
      const words = t.split(/\s+/).filter(Boolean).length
      setRetells((prev) =>
        [{ at: new Date().toISOString(), articleId: articleIdentity, text: t, words }, ...prev].slice(0, 200),
      )
      recordActivity('write', 1)
      flash('已记录复述 ✅')
    },
    [articleIdentity, setRetells, recordActivity, flash],
 )

  const deleteRetell = useCallback((at: string) => setRetells((prev) => prev.filter((r) => r.at !== at)), [setRetells])

  /** 文章测验可出题数（设置面板提示用）。 */
  const articleQuizCount = useMemo(
    () => buildArticleQuestions(doc?.sentences ?? [], { kinds: quizArticleKinds as ArticleQuizKind[] }).length,
    [doc, quizArticleKinds],
  )

  /** AI 工作包：导出待办 / 导入结果（agent）+ 网页版提示词 / 应用 / 重问缺项。 */
  const {
    jobCount: aiJobCount,
    exportJobs: exportAiJobs,
    fileRef: aiFileRef,
    onFile: onAiFile,
    webBatchSize: aiWebBatchSize,
    setWebBatchSize: setAiWebBatchSize,
    copyWebPrompt: copyAiWebPrompt,
    applyWeb: applyAiWeb,
    copyWebMissing: copyAiWebMissing,
    resetWebProgress: resetAiWebProgress,
    autoVocabDoneHere: aiAutoVocabDoneHere,
    rerunAutoVocab,
    webTotal: aiWebTotal,
    webDone: aiWebDone,
    webPending: aiWebPending,
    webMissing: aiWebMissing,
    webPendingLabels: aiWebPendingLabels,
    webBreakdown: aiWebBreakdown,
    localConfigured: aiLocalConfigured,
    localRunning: aiLocalRunning,
    localDone: aiLocalDone,
    localTotal: aiLocalTotal,
    localRound: aiLocalRound,
    localPhase: aiLocalPhase,
    localError: aiLocalError,
    runLocal: runAiLocal,
    skipPending: aiSkipPending,
    checklist: aiChecklist,
    checklistDone: aiChecklistDone,
    checklistTotal: aiChecklistTotal,
    nextHint: aiNextHint,
  } = useAiPack({
    jobsInput: aiJobsInput,
    applyTaskResult,
    download,
    flash,
    onReport: setPasteReport,
  })

  /**
   * 统一的「应用结果」：先按网页版工作包（@@@ANSWER / JSON results）解析，
   * 认得出就应用并清空输入栏；否则退回单任务（lastTask）解析。
   */
  const applyAnyPaste = useCallback(() => {
    const text = pasted.trim()
    if (!text) return
    const isPack = text.includes('@@@ANSWER') || /"results"\s*:/.test(text)
    if (isPack) {
      if (applyAiWeb(text)) setPasted('')
      return
    }
    applyPaste()
  }, [pasted, applyAiWeb, applyPaste])

  /** 离线词典（ECDICT）：就绪状态 + 三个"纯本地"动作。 */
  const dictReady = useDictionary()

  /**
   * 离线词典就绪后：把「非原型」的词条自动归一到词典原形并合并（幂等）。
   * 修的是 `overthrown`（没释义）、`sprawling`（和 `sprawl` 并列）这类残留。
   * 手动改过（edited/mastered）的不动。
   */
  useEffect(() => {
    if (!dictReady) return
    const dict = dictionary()
    if (!dict) return
    const pairs = dictLemmaPairs(dict, library.items, { skipLocked: true })
    if (!pairs.length) return
    persist(dedupeLibrary(applyLemmaMap(library, pairs)))
  }, [dictReady, library, persist])

  const { enrichFromDict, fixLemmasFromDict, pickFromDict, confuseFromDict } = useDictTools({
    library,
    persist,
    doc,
    level: vocabLevel,
    mergeBatch,
    batchItemsFromWords,
    flash,
  })

  const allList = sortItems(library.items, vocabSort)
  const handleReview = useCallback(
    (id: string, grade: ReviewGrade) => persist(reviewItem(library, id, grade)),
    [library, persist],
  )
  const handleEdit = useCallback(
    (id: string, patch: VocabEditPatch) => persist(editItem(library, id, patch)),
    [library, persist],
  )

  /** 仪表盘：各能力当前可用性 */
  const readyRows = useMemo(
    () =>
      buildReadiness({
        hasDoc: !!doc,
        sentences: doc?.sentences.length ?? 0,
        translated: doc?.sentences.filter((s) => s.translation).length ?? 0,
        language: doc?.sentences.filter((s) => hasSentenceLanguage(s)).length ?? 0,
        listenQuiz: listenQuiz?.questions.length ?? 0,
        vocab: library.items.length,
        batch: batch.length,
        unqueried: library.items.filter((it) => it.status === 'unqueried').length,
        noMeaning: library.items.filter((it) => !it.meaning).length,
        noExampleUsage: library.items.filter(
          (it) => !hasOwnExamples(it) || (it.usage.length === 0 && !it.phrases?.length),
        ).length,
        noPhonetic: library.items.filter((it) => !it.phonetic).length,
        confusableMissing: confusableTodo.length,
        lemmaCandidates: lemmaCandidates.length,
        due: library.items.filter((it) => isDue(it)).length,
        newWords: library.items.filter((it) => it.reviewState.repetitions === 0).length,
        writingHistory: writingHistory.length,
      }),
    [doc, listenQuiz, library.items, batch, confusableTodo, lemmaCandidates, writingHistory],
  )

  /** 仪表盘每行的「去准备」动作 */
  const boardAction = (key: string): { label: string; run: () => void } | null => {
    switch (key) {
      case 'vocab':
        return { label: '去选词', run: () => setSideTab('pick') }
      case 'batch':
        return { label: '查词', run: () => void copyBatchPrompt() }
      case 'unqueried':
        return { label: '补查音标', run: () => void copyMissingPhonetic('missing') }
      case 'confusable':
        return { label: '生成混淆项', run: () => void copyConfusablePrompt() }
      case 'lemma':
        return { label: '去重整理', run: dedupeNow }
      case 'review':
        return { label: '背单词', run: () => startStudy() }
      case 'dictation':
        return { label: '去听写', run: startDictation }
      case 'listen':
        return { label: '出题', run: openListening }
      case 'language':
        return { label: '分析', run: () => void copyLanguagePrompt() }
      case 'imitation':
        return { label: '去仿写', run: openWriting }
      default:
        return null
    }
  }

  /** 精读工作流：某一步「跳到对应工具」。 */
  const openIntensiveStage = useCallback(
    (key: IntensiveStageKey) => {
      setIntensiveOpen(false)
      if (key === 'skim') openSpeedRead()
      else if (key === 'recall') startStudy()
      else if (key === 'produce') openWriting()
      // vocab / chunks / comprehend / grammar：一键跑批会把音标·释义·例句·词组·习语·
      // 语法标记·翻译·语言点一次补齐
      else void runAiLocal()
    },
    [openSpeedRead, startStudy, openWriting, runAiLocal],
  )

  /** 精读工作流：快捷「拷打」（只针对本篇）。 */
  const startIntensiveDrill = useCallback(
    (kind: DrillKind) => {
      setIntensiveOpen(false)
      if (kind === 'memory') startQuizDrill(['spell', 'meaning', 'choice'], 'article')
      else if (kind === 'chunk') startQuizDrill(['usage', 'cloze', 'collocation', 'prep', 'idiom'], 'article')
      else if (kind === 'deep') startQuizDrill(['define', 'defineChoice'], 'article')
      else if (kind === 'mark') startQuizDrill(['mark'], 'article')
      else if (kind === 'grammar')
        startQuizArticleDrill(['grammar', 'phraseBlank', 'translate2', 'functionWord', 'ordering'])
      else if (kind === 'listen') startQuizDrill(['listen'], 'article')
    },
    [startQuizDrill, startQuizArticleDrill],
  )

  /** 错题包围战：错题 + 优先重排 + 常错 + 学不稳 一起围剿，开「反复鞭打」打到全对。 */
  const startSiege = useCallback(() => {
    const picked = buildSiege(library.items, mistakes, { scope: 'all', limit: 40 })
    if (!picked.length) {
      flash('错题本是空的 —— 先做几轮「考试 / 拷打」攒点错题吧')
      return
    }
    setIntensiveOpen(false)
    setQuizLoopWrong(true)
    setQuizScope('lapses')
    startQuizItems(
      picked.map((x) => x.item.id),
      ['spell', 'meaning', 'choice', 'usage', 'collocation', 'prep', 'idiom', 'cloze'],
    )
    flash(`错题包围战：${picked.length} 个欠揍的词，打到全对`)
  }, [library.items, mistakes, startQuizItems, setQuizLoopWrong, setQuizScope, flash])

  const toggleSkimmed = useCallback(() => {
    setSkimmedArticles((prev) =>
      prev.includes(articleIdentity) ? prev.filter((x) => x !== articleIdentity) : [...prev, articleIdentity],
    )
  }, [articleIdentity, setSkimmedArticles])

  /** 考试 / 快刷 / 听写 / 听力 进行时（含设置面板）：隐藏正文，别把原文当阅读看。 */
  const examActive = quizSetupOpen || !!quizQueue || !!quickQueue || !!dictQueue || listenOpen || speedReadOpen
  /** 是否处于「阅读」视图：否则（背单词/考试/听写/听力/仿写/全部生词）隐藏精读工具栏 */
  const readingView = !studyQueue && !examActive && !writingOpen && !browseAll

  return (
    <div className={`reader size-${fontSize}${bold ? ' weight-bold' : ''}${serif ? ' font-serif' : ''}${examActive ? ' exam' : ''}${studyQueue ? ' studying' : ''}`}>
      <FishLayer pageKey="reader" />
      <main
        className="reader-main"
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
      >
        {readingView && (
          <ReaderToolbar
            book={book}
            editions={editions}
            edition={edition}
            onEditionChange={setEdition}
            bookKeysCount={bookKeys.length}
            saved={saved}
            savedGroups={savedGroups}
            shownKeys={shownKeys}
            readDays={readDays}
            currentValue={currentValue}
            onPickArticle={onPick}
            hasDoc={!!doc}
            editing={editing}
            savedId={savedId}
            onSave={() => void saveCurrent()}
            onNewArticle={() => setComposing((v) => !v)}
            vocabMode={vocabMode}
            onToggleVocab={toggleVocabMode}
            onTranslateAll={() => void copyTranslateAll()}
            vocabLevel={vocabLevel}
            onVocabLevelChange={setVocabLevel}
            onAutoVocab={() => void copyAutoVocab()}
            translateView={translateView}
            onTranslateViewChange={setTranslateView}
            autoSpeak={autoSpeak}
            onAutoSpeakChange={setAutoSpeak}
            selectedId={selectedId}
            onSpeakSelected={() => {
              const s = doc?.sentences.find((x) => x.id === selectedId)
              if (s) speak(s.text)
            }}
            readingAll={readingAll}
            onToggleReadAll={readingAll ? stopReadAll : startReadAll}
            onSpeedRead={openSpeedRead}
            onOpenIntensive={() => setIntensiveOpen(true)}
            onOpenJournal={() => setJournalOpen(true)}
            onOpenGoals={() => setGoalOpen(true)}
            ttsState={ttsState}
            ttsVoice={ttsVoice}
            onTtsVoiceChange={setTtsVoice}
            ttsAccents={ttsAccents}
            pregenRunning={pregen.running}
            pregenDone={pregen.done}
            pregenTotal={pregen.total}
            onPregenerate={() => void pregenerateAll()}
            onCancelPregenerate={cancelPregenerate}
            pregenAllCached={pregen.allCached}
            onEnterEdit={enterEdit}
            draft={draft}
            onCleanupEdit={() => void copyCleanupPrompt(draft, '「完成」')}
            onApplyEdit={applyEdit}
            onCancelEdit={cancelEdit}
            vocabSeconds={vocabSeconds}
            sessionPicked={sessionPickedRef.current}
            todayPicked={dayStats.todayPicked}
            streak={dayStats.streak}
            totalPicked={totals.picked}
            totalSeconds={totals.seconds}
            studiedCount={studiedTodayIds.length}
            dailyGoal={dailyGoal}
            libraryCount={library.items.length}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            bold={bold}
            onBoldChange={setBold}
            serif={serif}
            onSerifChange={setSerif}
            eye={eye}
            onEyeChange={setEye}
            confirmDelSave={confirmDelSave}
            onDeleteSave={askDeleteSave}
          />
        )}

        {bookError && !book && (
          <p className="muted">没取到 articles.json（要 http://localhost 打开且文件存在）。可直接把正文粘在下面。</p>
        )}

        {studyQueue && (
          <StudyPanel
            card={studyCard}
            items={library.items}
            queueLength={studyQueue.length}
            roundTotal={studyRoundTotal}
            extraCount={studyExtraCount}
            index={studyIndex}
            mode={studyMode}
            scope={studyScope}
            spelling={studySpelling}
            revealed={studyRevealed}
            checked={studyChecked}
            input={studyInput}
            counts={studyCounts}
            cardSeconds={cardSeconds}
            liveSeconds={studyLive}
            grandSeconds={studyGrandSeconds}
            newCount={newCount}
            dueCount={dueCount}
            newLimit={newLimit}
            newToday={newToday}
            gradeInfo={gradeInfo}
            editOpen={studyEditOpen}
            draft={studyDraft}
            delArmed={studyDelArmed}
            forgotCount={studyForgotCount}
            drillOn={studyDrillOn}
            drillAfter={studyDrillAfter}
            onClose={closeStudy}
            onExam={() => {
              closeStudy()
              setQuizResults([])
              setQuizSetupOpen(true)
            }}
            onSwitchMode={switchMode}
            onSwitchScope={switchScope}
            onStartArticleAll={startArticleAll}
            onNewLimitChange={setNewLimit}
            onDrillAfterChange={setStudyDrillAfter}
            onSpellingChange={(on) => {
              setStudySpelling(on)
              setStudyChecked(false)
              setStudyInput('')
            }}
            onReveal={() => setStudyRevealed(true)}
            onInputChange={setStudyInput}
            onCheckSpelling={() => setStudyChecked(true)}
            onSpeak={speak}
            onOpenEdit={openStudyEdit}
            onDelete={studyDelete}
            onDraftChange={setStudyDraft}
            onSaveEdit={saveStudyEdit}
            onCancelEdit={() => {
              setStudyEditOpen(false)
              setStudyDraft(null)
            }}
            onGrade={gradeStudy}
            onBack={studyBack}
            onMarkUnknown={studyMarkUnknown}
            onDrillCleared={studyClearDrill}
            onRetryForgot={retryForgot}
            onRestart={() => startStudy()}
          />
        )}

        {quizSetupOpen && !quizQueue && (
          <QuizSetupPanel
            kinds={quizKinds}
            scope={quizScope}
            limit={quizLimit}
            auto={quizAuto}
            unique={quizUnique}
            speakAfter={quizSpeak}
            availableCount={quizAvailableCount}
            poolUnmastered={quizPoolSizes.unmastered}
            articleKinds={quizArticleKinds}
            articleAvailable={articleQuizCount}
            onToggleKind={(k, on) => setQuizKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)))}
            onToggleArticleKind={(k, on) => setQuizArticleKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)))}
            onScopeChange={setQuizScope}
            onLimitChange={setQuizLimit}
            onAutoChange={setQuizAuto}
            onUniqueChange={setQuizUnique}
            onSpeakChange={setQuizSpeak}
            loopWrong={quizLoopWrong}
            onLoopWrongChange={setQuizLoopWrong}
            onCancel={() => setQuizSetupOpen(false)}
            onStart={startQuiz}
            onStartArticle={startArticleQuiz}
          />
        )}

        {quizQueue && (
          <QuizPanel
            question={quizIndex < quizQueue.length ? quizQueue[quizIndex] : null}
            scope={quizScope}
            articleRun={quizArticleRun}
            queueLength={quizQueue.length}
            index={quizIndex}
            seconds={quizSeconds}
            results={quizResults}
            checked={quizChecked}
            input={quizInput}
            result={quizResult}
            items={library.items}
            drillRound={quizDrillRound}
            onClose={closeQuiz}
            onSpeak={speak}
            onResetSpeech={resetSpeech}
            ttsState={ttsState}
            onSubmit={() => checkQuiz()}
            onNext={nextQuiz}
            onRetryWrong={retryQuizWrong}
            onRestart={startQuiz}
            onSelectOption={(opt) => {
              setQuizInput(opt)
              checkQuiz(opt)
            }}
            onInputChange={setQuizInput}
          />
        )}

        {quickQueue && (
          <QuickPanel
            current={
              quickIndex < quickQueue.length
                ? (library.items.find((it) => it.id === quickQueue[quickIndex].id) ?? quickQueue[quickIndex])
                : null
            }
            queueLength={quickQueue.length}
            index={quickIndex}
            revealed={quickRevealed}
            onClose={() => setQuickQueue(null)}
            onReveal={() => setQuickRevealed(true)}
            onSpeak={speak}
            onGrade={gradeQuick}
            onRestart={startQuick}
          />
        )}

        {dictQueue && (
          <DictPanel
            queue={dictQueue}
            index={dictIndex}
            mode={dictMode}
            words={dictWords}
            blankCount={dictBlankCount}
            clozeWords={dictClozeWords}
            maxQuestions={dictMaxQuestions}
            grandTotal={dictRoundInfo.grand}
            roundOffset={dictRoundInfo.offset}
            checked={dictChecked}
            diff={dictDiff}
            cloze={dictCloze}
            blanks={dictBlanks}
            input={dictInput}
            results={dictResults}
            wrongItems={dictWrongItems}
            onStart={startDictation}
            onCheck={checkDict}
            onNext={nextDict}
            onWrongNow={dictWrongNow}
            onRetryWrong={retryDictWrong}
            onClose={closeDict}
            onSpeak={speak}
            onPlayItem={playDictItem}
            onResetSpeech={resetSpeech}
            ttsState={ttsState}
            onInputChange={setDictInput}
            onBlankChange={setDictBlank}
          />
        )}

        {speedReadOpen && doc && (
          <SpeedReadPanel
            sentences={doc.sentences}
            docKey={articleIdentity}
            onClose={() => setSpeedReadOpen(false)}
            onSpeak={speak}
            ttsState={ttsState}
            onAddItems={addItemsToVocab}
            isKnown={(w) => knownLemmas.has(lemmaOf(w))}
            wordMeaning={(w) => {
              const it = library.items.find((x) => x.lemma === lemmaOf(w) || x.word.toLowerCase() === w.toLowerCase())
              return it ? displayMeaning(it) || it.meaning || null : null
            }}
            onFinishRead={markReadDone}
            onAddPhrases={addPhrasesToVocab}
            onHint={flash}
            wordsInSentence={wordsInSentence}
            onRemoveWord={removeWordFromVocab}
            vocabMode={vocabMode}
            onOpenLang={openLangFor}
            langEditorOpen={langOpen}
          />
        )}

        {langOpen && (
          <LanguageEditor sentence={langTarget} onSave={saveLanguage} onClose={() => setLangOpen(false)} />
        )}

        {planOpen && (
          <PlanPanel
            onClose={() => setPlanOpen(false)}
            hasDoc={!!doc}
            articleTitle={articleTitle}
            todoPending={aiWebPending}
            todayCards={todayCards}
            todayWrites={todayWrites}
            todayKey={todayKey}
            onNewArticle={() => {
              setPlanOpen(false)
              setComposing(true)
            }}
            onStartStudy={() => {
              setPlanOpen(false)
              startStudy()
            }}
            onOpenSpeedRead={() => {
              setPlanOpen(false)
              openSpeedRead()
            }}
          />
        )}

        {intensiveOpen && (
          <IntensivePanel
            onClose={() => setIntensiveOpen(false)}
            articleTitle={articleTitle}
            hasDoc={!!doc}
            plan={intensivePlan}
            skimmed={intensiveSkimmed}
            onToggleSkimmed={toggleSkimmed}
            onRunBatch={() => void runAiLocal()}
            batchRunning={aiLocalRunning}
            batchRound={aiLocalRound}
            batchPhase={aiLocalPhase}
            batchDone={aiLocalDone}
            batchTotal={aiLocalTotal}
            batchError={aiLocalError}
            board={outputBoard}
            retells={myRetells}
            onSaveRetell={saveRetell}
            onDeleteRetell={deleteRetell}
            onStage={openIntensiveStage}
            onDrill={startIntensiveDrill}
            onSiege={startSiege}
          />
        )}

        {goalOpen && (
          <GoalPanel
            onClose={() => setGoalOpen(false)}
            todayKey={todayKey}
            done={todayReadDone}
            allDone={readDone}
            goal={readGoal}
            onGoalChange={setReadGoal}
            memo={goalMemo}
            onMemoChange={setGoalMemo}
            articleTitle={articleTitle}
            articleDone={articleReadDay !== null}
            articleReadDay={articleReadDay}
            onMarkDone={markReadDone}
            onUndo={undoReadDone}
          />
        )}

        {exportOpen && (
          <ExportPanel
            onClose={() => setExportOpen(false)}
            libraryItems={library.items}
            articleTitle={articleTitle}
            articleWords={articleWords}
            articles={exportArticles}
            todayKey={todayKey}
            onPrint={doPrint}
            onExportAnki={doExportAnki}
            onExportWordList={exportWordList}
          />
        )}

        {journalOpen && (
          <JournalPanel
            onClose={() => setJournalOpen(false)}
            days={journalAllDays}
            day={journalDay}
            onDayChange={setJournalDay}
            data={journalData}
            summary={journalSummaryRows}
            heat={journalHeat}
            onSpeak={speak}
          />
        )}

        {listenOpen && listenQuiz && (
          <ListeningPanel
            questions={listenQuestions}
            answers={listenAnswers}
            submitted={listenSubmitted}
            result={listenResult}
            onlyWrong={!!listenWrongIds}
            readingAll={readingAll}
            transcript={doc ? doc.sentences.map((s) => s.text).join(' ') : null}
            readMode={listenReadMode}
            onClose={() => {
              setListenOpen(false)
              setListenReadMode(false)
            }}
            onToggleRead={readingAll ? stopReadAll : startReadAll}
            onResetSpeech={resetSpeech}
            ttsState={ttsState}
            onAnswer={(id, value) => setListenAnswers((a) => ({ ...a, [id]: value }))}
            onSubmit={submitListening}
            onRetryWrong={retryListenWrong}
            onShowAll={showAllListen}
            onRegenerate={() => void copyListeningPrompt()}
          />
        )}

        {writingOpen && (
          <WritingPanel
            model={writingModel}
            text={writingText}
            task={writingTask}
            feedback={writingFeedback}
            history={writingHistory}
            onClose={() => setWritingOpen(false)}
            onGenerateTask={() => void copyImitationTask()}
            onFeedback={() => void copyFeedback()}
            onModelChange={setWritingModel}
            onTextChange={setWritingText}
            onClearHistory={() => setWritingHistory([])}
            onLoadRecord={loadWritingRecord}
          />
        )}

        {browseAll && (
          <div className="all-vocab">
            <div className="bar">
              <strong>全部生词（{library.items.length}）</strong>
              <span className="view-toggle">
                <button className={vocabView === 'card' ? 'primary' : ''} onClick={() => setVocabView('card')}>
                  卡片
                </button>
                <button className={vocabView === 'table' ? 'primary' : ''} onClick={() => setVocabView('table')}>
                  表格
                </button>
              </span>
              <button onClick={() => doExportAnki(library.items)} disabled={!library.items.length}>
                整库 Anki CSV
              </button>
              <button onClick={() => doPrint(library.items, '全部生词')} disabled={!library.items.length}>
                整库 A4 打印
              </button>
              <button
                onClick={() => doExportWrong(library.items)}
                disabled={!library.items.some((w) => (w.reviewState.lapses ?? 0) > 0)}
              >
                导出错词
              </button>
              <button className="primary" onClick={() => setBrowseAll(false)}>
                关闭
              </button>
            </div>
            {allList.length ? (
              <VocabList
                items={allList}
                view={vocabView}
                focusLemma={focusLemma}
                confirmDel={confirmDel}
                onSpeak={speak}
                onDelete={askDelete}
                onReview={handleReview}
                onEdit={handleEdit}
                showSource
              />
            ) : (
              <div className="muted">生词本是空的</div>
            )}
          </div>
        )}

        {!studyQueue && !browseAll && !examActive && (composing || !doc) && (
          <Composer
            composing={composing}
            onCancel={() => setComposing(false)}
            title={newTitle}
            onTitleChange={setNewTitle}
            book={newBook}
            onBookChange={setNewBook}
            manual={manual}
            onManualChange={setManual}
            pdfRange={pdfRange}
            onPdfRangeChange={setPdfRange}
            importing={importing}
            onImportFiles={(files) => void onImportFiles(files)}
            onPickPdf={(f) => void onPickPdf(f)}
            onPickEpub={(f) => void onPickEpub(f)}
            onCleanupPrompt={() => void copyCleanupPrompt(manual, '「创建文章」')}
            onCreate={() => void createArticle()}
          />
        )}

        {!studyQueue && !browseAll && !examActive && !writingOpen && doc && !composing && (
          <>
            <h1>
              {articleTitle || (articleKey ? articleKey : '手动粘贴')}
              <button className="title-edit" onClick={() => void renameArticle()} title="修改文章标题">
                ✎
              </button>
            </h1>
            {editing ? (
              <>
                <div className="meta">编辑正文：改完点「完成」重新切句；已粘回的翻译/语法按句文保留。</div>
                <textarea
                  className="manual"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                />
              </>
            ) : (
              <>
                <div className="meta">点句子=整句；拖动选词组（按整词吸附）；Ctrl 点单词。</div>
                <ReaderBody
                  paragraphs={doc.paragraphs}
                  sentences={doc.sentences}
                  translateView={translateView}
                  selectedId={selectedId}
                  peekSid={peekSid}
                  vocabSidSet={vocabSidSet}
                  selSid={selSid}
                  selIndices={selIndices}
                  libraryLemmas={libraryLemmas}
                  articleNums={articleNums}
                  articleFirst={articleFirst}
                  showLanguage={showLanguage}
                  vocabMode={vocabMode}
                  lastPicked={lastPicked}
                  bubblePos={bubblePos}
                  articleRef={articleRef}
                  onSelectSentence={selectSentenceAndRead}
                  onFocusEntry={revealVocabWord}
                  onAltCopyText={altCopyText}
                  karaoke={karaoke}
                  onWordSeek={(sid, i) => {
                    const s = doc?.sentences.find((x) => x.id === sid)
                    if (s) speakFromWord(s.text, i)
                  }}
                  onAddPhrase={addPhrasesToVocab}
                />
              </>
            )}
          </>
        )}
      </main>

      <aside className={'reader-side tab-' + sideTab} ref={sideRef}>
        <div className="side-brand">
          <img src={mascotAI} alt="" title="精读" />
        </div>
        <div className="side-tabs">
          <button className={sideTab === 'overview' ? 'primary' : ''} onClick={() => setSideTab('overview')}>
            总览
          </button>
          <button className={sideTab === 'pick' ? 'primary' : ''} onClick={() => setSideTab('pick')}>
            选词 / 分析
          </button>
          <button className={sideTab === 'vocab' ? 'primary' : ''} onClick={() => setSideTab('vocab')}>
            生词本
          </button>
          <button className={sideTab === 'stats' ? 'primary' : ''} onClick={() => setSideTab('stats')}>
            统计
          </button>
          <button className={sideTab === 'mastery' ? 'primary' : ''} onClick={() => setSideTab('mastery')}>
            掌握度
          </button>
        </div>
        <SideOverview
          mistakes={mistakes}
          readyRows={readyRows}
          boardAction={boardAction}
          onRetryVocab={retryMistakeVocab}
          onSiege={startSiege}
          onRetryListen={retryMistakeListen}
          onRetryDict={retryMistakeDict}
          onClearMistakes={() => setMistakes([])}
        />
        <SideMastery
          mastery={articleMastery}
          onStartArticle={startArticleQuiz}
          onStartVocab={() => {
            setQuizQueue(null)
            setQuizSetupOpen(false)
            startStudy()
          }}
        />
        <div className="side-sec" data-sec="stats">
          <StatsPanel activity={activity} practice={practice} />
        </div>
        <SidePick
          tasks={TASKS}
          onPrompt={(t) => void copyPrompt(t)}
          lastTask={lastTask}
          target={target}
          useExact={useExact}
          vocabMode={vocabMode}
          canMark={!!exact}
          visibleBatch={visibleBatch}
          batchCount={batch.length}
          onRemoveWord={(b) => addToBatch([b.word], b.sentence, b.sentenceId)}
          onCommitBatch={commitBatch}
          onCopyBatchPrompt={() => void copyBatchPrompt()}
          onExportBatch={exportBatch}
          onClearBatch={() => setBatch([])}
          onAddSelectionToBatch={addSelectionToBatch}
          onMark={mark}
          onOpenLang={() => openLangFor(sentence)}
          pasted={pasted}
          onPastedChange={(v) => {
            setPasted(v)
            if (pasteReport.length) setPasteReport([])
            if (pasteMissing) setPasteMissing(null)
          }}
          pasteReport={pasteReport}
          pasteMissingCount={pasteMissing?.words.length ?? 0}
          onApplyPaste={applyAnyPaste}
          onCopyMissingAgain={() => void copyMissingAgain()}
          aiJobCount={aiJobCount}
          aiScope={aiPackScope}
          onAiScopeChange={setAiPackScope}
          autoVocabDirect={autoVocabDirect}
          onAutoVocabDirectChange={setAutoVocabDirect}
          autoVocabDoneHere={aiAutoVocabDoneHere}
          onRerunAutoVocab={rerunAutoVocab}
          onExportAiJobs={exportAiJobs}
          dictReady={dictReady}
          onPickFromDict={pickFromDict}
          onEnrichFromDict={enrichFromDict}
          onEnrichExamples={() => void enrichExamplesFromTatoeba()}
          examplesReady={tatoebaReady}
          onFixLemmasFromDict={fixLemmasFromDict}
          onConfuseFromDict={confuseFromDict}
          aiFileRef={aiFileRef}
          onAiFile={onAiFile}
          localConfigured={aiLocalConfigured}
          localRunning={aiLocalRunning}
          localDone={aiLocalDone}
          localTotal={aiLocalTotal}
          localRound={aiLocalRound}
          localPhase={aiLocalPhase}
          localError={aiLocalError}
          onRunLocal={() => void runAiLocal()}
          checklist={aiChecklist}
          checklistDone={aiChecklistDone}
          checklistTotal={aiChecklistTotal}
          nextHint={aiNextHint}
          onSkipPending={aiSkipPending}
          aiWebBatchSize={aiWebBatchSize}
          onAiWebBatchSizeChange={setAiWebBatchSize}
          onCopyWebPrompt={() => void copyAiWebPrompt()}
          onCopyWebMissing={() => void copyAiWebMissing()}
          onRefreshWeb={resetAiWebProgress}
          webTotal={aiWebTotal}
          webDone={aiWebDone}
          webPending={aiWebPending}
          webMissing={aiWebMissing}
          webPendingLabels={aiWebPendingLabels}
          webBreakdown={aiWebBreakdown}
          confusableBatchCount={confusableBatch.length}
          confusableTodoCount={confusableTodo.length}
          onCopyConfusable={() => void copyConfusablePrompt()}
          confusableBatchSize={confusableBatchSize}
          onConfusableBatchSizeChange={setConfusableBatchSize}
          lemmaCount={lemmaCandidates.length}
          onCopyLemma={() => void copyLemmaPrompt()}
          posCount={posCandidates.length}
          onCopyPos={() => void copyPosPrompt()}
          hasItems={!!library.items.length}
          onDedupe={dedupeNow}
        />

        <SideVocab
          articleWords={articleWords}
          libraryItems={library.items}
          view={vocabView}
          onViewChange={setVocabView}
          sortBy={vocabSort}
          onSortChange={setVocabSort}
          hasDoc={!!doc}
          hasItems={!!library.items.length}
          hasLapses={library.items.some((w) => (w.reviewState.lapses ?? 0) > 0)}
          onStartStudy={() => {
            setQuizQueue(null)
            setQuizSetupOpen(false)
            startStudy()
          }}
          onStartArticleAll={() => {
            setQuizQueue(null)
            setQuizSetupOpen(false)
            startArticleAll()
          }}
          onStartExam={() => {
            closeStudy()
            setQuizResults([])
            setQuizSetupOpen(true)
          }}
          onStartQuick={() => {
            setQuickQueue(null)
            closeStudy()
            setQuizSetupOpen(false)
            startQuick()
          }}
          onStartDictation={() => startDictation()}
          onOpenListening={() => openListeningMode(false)}
          onOpenReading={() => openListeningMode(true)}
          onOpenSpeedRead={openSpeedRead}
          listenCount={listenCount}
          onListenCountChange={setListenCount}
          onLanguagePrompt={() => void copyLanguagePrompt()}
          showLanguage={showLanguage}
          onShowLanguageChange={setShowLanguage}
          languageCount={languageSentCount}
          onOpenPlan={() => setPlanOpen(true)}
          onOpenWriting={openWriting}
          onWrongPractice={() => {
            setQuizScope('lapses')
            setQuizResults([])
            setQuizSetupOpen(true)
          }}
          onBrowseAll={() => setBrowseAll(true)}
          onExportAnki={doExportAnki}
          onPrint={doPrint}
          onOpenExport={() => setExportOpen(true)}
          printTitle={articleTitle || articleKey || '本篇生词'}
          onExportJson={exportJson}
          onExportWordList={exportWordList}
          onCopyMissingPhonetic={(only) => void copyMissingPhonetic(only)}
          onToggleStats={() => setStatsOpen((v) => !v)}
          onExportWrong={doExportWrong}
          onExportAll={exportAll}
          onImportBackup={(f) => void onImportBackup(f)}
          onMergeBackup={(f) => void onMergeBackup(f)}
          statsOpen={statsOpen}
          stats={{
            totals,
            dayStats,
            studyTodaySeconds,
            studyTotalSeconds,
            studyTotalCards,
            studiedCount: studiedTodayIds.length,
            dailyGoal,
            last7,
            dueForecast: dueForecastRows,
            byArticle,
          }}
          onDailyGoalChange={setDailyGoal}
          articleNums={articleNums}
          articleAllPrinted={articleAllPrinted}
          articlePrintedAt={articlePrintedAt}
          focusLemma={focusLemma}
          confirmDel={confirmDel}
          onJumpSource={jumpToSource}
          onSpeak={speak}
          onDelete={askDelete}
          onReview={handleReview}
          onEdit={handleEdit}
        />
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
