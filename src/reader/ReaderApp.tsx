import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArticleBook } from '../core/matchArticle'
import { wordSpans } from '../core/wordSelect'
import {
  createLibrary,
  dedupeLibrary,
  editItem,
  isDue,
  lemmaOf,
  normalizeWord,
  removeItem,
  reviewItem,
  sortItems,
  type ReviewGrade,
} from '../core/vocab'
import {
  buildBatchLookupPrompt,
  buildConfusablePrompt,
  buildLemmaPrompt,
  buildPosPrompt,
  type AnalysisTask,
  type VocabLevel,
} from '../core/analyzer'
import { type ListeningQuestion } from '../core/listening'
import { buildLanguagePrompt } from '../core/language'
import {
  addPracticeRecord,
  type PracticeKind,
  type PracticeRecord,
} from '../core/practice'
import {
  removeMistake,
  upsertMistake,
  type MistakeEntry,
} from '../core/mistakes'
import { buildReadiness } from '../core/readiness'
import { dueForecast, last7Days, pickDayStats, sessionTotals, studyTotals, wordsByArticle } from '../core/vocabStats'
import { type AiJobsInput } from '../core/aiPackage'
import { addActivity, dayKeyLocal, type ActivityCat, type DayActivity } from '../core/activity'
import { createVocabRepo } from '../adapters/vocabRepo'
import { createArticleRepo, type ArticleRepoPort, type SavedArticle } from '../adapters/articleRepo'
import VocabList, { type VocabEditPatch } from './VocabList'
import StatsPanel from './panels/StatsPanel'
import DictPanel from './panels/DictPanel'
import ListeningPanel from './panels/ListeningPanel'
import WritingPanel from './panels/WritingPanel'
import StudyPanel from './panels/StudyPanel'
import QuizSetupPanel from './panels/QuizSetupPanel'
import QuizPanel from './panels/QuizPanel'
import QuickPanel from './panels/QuickPanel'
import SideOverview from './panels/SideOverview'
import SidePick, { type BatchItem } from './panels/SidePick'
import SideVocab from './panels/SideVocab'
import ReaderBody from './panels/ReaderBody'
import Composer from './panels/Composer'
import ReaderToolbar from './panels/ReaderToolbar'
import { useSpeaking } from './hooks/useSpeaking'
import { useAiPack } from './hooks/useAiPack'
import { useDictation } from './hooks/useDictation'
import { useQuizSession } from './hooks/useQuizSession'
import { useStudySession } from './hooks/useStudySession'
import { useArticleImport } from './hooks/useArticleImport'
import { useAiTasks } from './hooks/useAiTasks'
import { useReaderDoc } from './hooks/useReaderDoc'
import { useApplyTaskResult } from './hooks/useApplyTaskResult'
import { useExport } from './hooks/useExport'
import { useSelection } from './hooks/useSelection'
import { useQuickSession } from './hooks/useQuickSession'
import { useListening } from './hooks/useListening'
import { useWriting } from './hooks/useWriting'
import FishLayer from '../ui/FishLayer'
import {
  persistentBool,
  persistentEnum,
  persistentNumber,
  persistentString,
  useLocalStorageState,
} from './hooks/useLocalStorageState'
import type { VocabRepoPort } from '../core/ports'
import type { Paragraph, Sentence, VocabLibrary, VocabItem } from '../types/document'
import mascotAI from '../../assets/imgs/GinShinImapct.png'
import './reader.css'

interface Doc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

/** 本机时区的日期键 YYYY-MM-DD */
function localDayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
  const [pasted, setPasted] = useState('')
  /** 上次「复制提示词」请求的词（用于校验 AI 返回是否齐全） */
  const askedWordsRef = useRef<string[]>([])
  /** 上次「全文翻译」请求的句子 id（用于校验是否逐句返回） */
  const askedIdsRef = useRef<string[]>([])
  /** 应用结果后的回执（成功 / 缺失 / 无效） */
  const [pasteReport, setPasteReport] = useState<string[]>([])
  /** 上次回执里缺失的词（用于「一键复制未返回的」重试） */
  const [pasteMissing, setPasteMissing] = useState<{
    task: 'confusable' | 'lookup' | 'lemma' | 'pos'
    words: string[]
  } | null>(null)
  const [lastTask, setLastTask] = useState<
    AnalysisTask | 'confusable' | 'lemma' | 'pos' | 'listening' | 'language' | 'imitation' | 'feedback' | null
  >(null)
  const [toast, setToast] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [saved, setSaved] = useState<SavedArticle[]>([])
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
  const [sideTab, setSideTab] = useLocalStorageState<'overview' | 'pick' | 'vocab' | 'stats'>(
    'reader:sideTab',
    'overview',
    persistentEnum(['overview', 'pick', 'vocab', 'stats'] as const, 'overview'),
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
  const { speak, startReadAll, stopReadAll, resetSpoken, readingAll } = useSpeaking({
    doc,
    selectedId,
    autoSpeak,
  })
  /** 背单词时长统计：按天累计（落盘，供统计用） */
  const [studyDays, setStudyDays] = useLocalStorageState<{ day: string; seconds: number; cards: number }[]>(
    'reader:studyStats',
    [],
  )

  /** 今天学过的不同单词 id（每日目标进度） */
  const [studiedToday, setStudiedToday] = useLocalStorageState<{ day: string; ids: string[] }>(
    'reader:studiedToday',
    { day: localDayKey(), ids: [] },
    {
      parse: (raw) => {
        try {
          const obj = JSON.parse(raw) as { day?: string; ids?: unknown } | null
          if (obj && Array.isArray(obj.ids)) {
            return obj.day === localDayKey()
              ? { day: obj.day as string, ids: obj.ids as string[] }
              : { day: localDayKey(), ids: [] }
          }
        } catch {
          // 忽略
        }
        return { day: localDayKey(), ids: [] }
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
  /** 每天引入新词的上限（0=不限）与今天已引入 */
  const [newLimit, setNewLimit] = useLocalStorageState('reader:newLimit', 20, persistentNumber)
  const [newToday, setNewToday] = useLocalStorageState('reader:newToday', 0, {
    parse: (raw) => {
      try {
        const obj = JSON.parse(raw) as { day?: string; count?: number } | null
        return obj && obj.day === localDayKey() && typeof obj.count === 'number' ? obj.count : 0
      } catch {
        return 0
      }
    },
    serialize: (count) => JSON.stringify({ day: localDayKey(), count }),
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
  const articleWords = useMemo(
    () => library.items.filter((it) => it.source?.fileName === articleIdentity),
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
        // 加载时合并去重，保证不会出现两个同根词
        const fixed = dedupeLibrary(lib)
        setLibrary(fixed)
        if (fixed.items.length !== lib.items.length) r.save(fixed).catch(() => {})
      })
      .catch(() => {})
    // 申请持久存储，降低 IndexedDB 被浏览器回收的概率
    try {
      void navigator.storage?.persist?.()
    } catch {
      // 老浏览器忽略
    }
    const ar = createArticleRepo()
    articles.current = ar
    ar.list().then(setSaved).catch(() => {})
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

  const persist = useCallback((lib: VocabLibrary) => {
    setLibrary(lib)
    repo.current?.save(lib).catch(() => {})
  }, [])

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

  /** 记录今天新引入了一个词（用于每日配额）。 */
  const bumpNewToday = useCallback(() => {
    // newToday 已由 useLocalStorageState 落盘（自动带上当天日期）
    setNewToday((prev) => prev + 1)
  }, [setNewToday])

  /** 把背单词时长 / 评分次数累加到「今天」（落盘供统计）。 */
  const studyFlush = useCallback((seconds: number, cards: number) => {
    if (seconds <= 0 && cards <= 0) return
    setStudyDays((prev) => {
      const day = localDayKey()
      const i = prev.findIndex((d) => d.day === day)
      if (i < 0) return [...prev, { day, seconds, cards }]
      const next = [...prev]
      next[i] = { day, seconds: next[i].seconds + seconds, cards: next[i].cards + cards }
      return next
    })
  }, [])

  /** 记「今天学过这个词」（每日目标按不同单词计数）。 */
  const markStudied = useCallback((itemId: string) => {
    setStudiedToday((prev) => {
      const day = localDayKey()
      const base = prev.day === day ? prev : { day, ids: [] }
      if (base.ids.includes(itemId)) return base
      return { day, ids: [...base.ids, itemId] }
    })
  }, [])

  /** 记一笔学习活动（按天 / 分类累计，落盘）。 */
  const recordActivity = useCallback((cat: ActivityCat, n = 1) => {
    if (n <= 0) return
    setActivity((prev) => addActivity(prev, dayKeyLocal(new Date()), cat, n))
  }, [])

  /** 记一次练习成绩（考试 / 听写 / 听力理解）。 */
  const recordPractice = useCallback((kind: PracticeKind, total: number, correct: number) => {
    if (total <= 0) return
    setPractice((prev) => addPracticeRecord(prev, { at: new Date().toISOString(), kind, total, correct }))
  }, [])

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
    card: studyCard,
    dueCount,
    newCount,
    unflushedSeconds: studyUnflushed,
    start: startStudy,
    switchMode,
    switchScope,
    startArticleAll,
    grade: gradeStudy,
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
    closeOthers: () => closeStudy(),
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    addMistake,
    dropMistake,
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
    startItems: startQuizItems,
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
    () => library.items.filter((it) => it.meaning && !it.confusables?.length),
    [library.items],
  )
  /** 一次生成多少（可自选；0=全部）；应用后再点，处理下一批。 */
  const confusableBatch = useMemo(
    () => (confusableBatchSize > 0 ? confusableTodo.slice(0, confusableBatchSize) : confusableTodo),
    [confusableTodo, confusableBatchSize],
  )

  /** 疑似「非原型」的词（word 与 lemma 不一致）——供 AI 校正原形。 */
  const lemmaCandidates = useMemo(
    () => library.items.filter((it) => normalizeWord(it.word) !== it.lemma).slice(0, 100),
    [library.items],
  )

  /** 含 -ing / -ed 形式的词或短语——供 AI 辨析语法身份。 */
  const posCandidates = useMemo(() => {
    const hasIngEd = (s: string) => s.split(/\s+/).some((t) => /(ing|ed)$/i.test(t))
    return library.items
      .filter((it) => hasIngEd(it.word) || normalizeWord(it.word) !== it.lemma)
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
      if (studyQueue || quizQueue || quickQueue || dictQueue) return
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
  }, [studyQueue, quizQueue])

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
    resetSpoken,
    fontSize,
    bold,
    serif,
    flash,
  })


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
    sentence,
    persist,
    mergeBatch,
    batchItemsFromWords,
    articleTitle,
    articleKey,
    articleIdentity,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
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
    const res = applyTaskResult(lastTask, raw, askedWordsRef.current, askedIdsRef.current)
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
  const {
    download,
    doExportAnki,
    exportJson,
    exportBatch,
    doExportWrong,
    exportAll,
    onImportBackup,
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
  })

  /** 由当前数据推导 AI 待办（纯逻辑在 core/aiPackage，便于单测）。 */
  const aiJobsInput = useMemo<AiJobsInput>(
    () => ({
      batch: visibleBatch.map((b) => ({ word: b.word, sentence: b.sentence })),
      items: library.items,
      articleWords,
      scope: aiPackScope,
      confusableBatchSize,
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
      doc,
      vocabLevel,
      listenQuiz,
      listenCount,
    ],
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
    refreshWebRound: refreshAiWebRound,
    webTotal: aiWebTotal,
    webDone: aiWebDone,
    webPending: aiWebPending,
    webMissing: aiWebMissing,
    webPendingLabels: aiWebPendingLabels,
    webBreakdown: aiWebBreakdown,
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


  const articleList = sortItems(articleWords, 'updatedAt')
  const allList = sortItems(library.items, 'updatedAt')
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
        language: doc?.sentences.filter((s) => s.language).length ?? 0,
        listenQuiz: listenQuiz?.questions.length ?? 0,
        vocab: library.items.length,
        batch: batch.length,
        unqueried: library.items.filter((it) => it.status === 'unqueried').length,
        noMeaning: library.items.filter((it) => !it.meaning).length,
        noExampleUsage: library.items.filter((it) => it.examples.length === 0 || it.usage.length === 0).length,
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

  /** 考试 / 快刷 / 听写 / 听力 进行时（含设置面板）：隐藏正文，别把原文当阅读看。 */
  const examActive = quizSetupOpen || !!quizQueue || !!quickQueue || !!dictQueue || listenOpen
  /** 是否处于「阅读」视图：否则（背单词/考试/听写/听力/仿写/全部生词）隐藏精读工具栏 */
  const readingView = !studyQueue && !examActive && !writingOpen && !browseAll

  return (
    <div className={`reader size-${fontSize}${bold ? ' weight-bold' : ''}${serif ? ' font-serif' : ''}${examActive ? ' exam' : ''}`}>
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
            studiedCount={studiedToday.ids.length}
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
            queueLength={studyQueue.length}
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
            onToggleKind={(k, on) => setQuizKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)))}
            onScopeChange={setQuizScope}
            onLimitChange={setQuizLimit}
            onAutoChange={setQuizAuto}
            onUniqueChange={setQuizUnique}
            onSpeakChange={setQuizSpeak}
            onCancel={() => setQuizSetupOpen(false)}
            onStart={startQuiz}
          />
        )}

        {quizQueue && (
          <QuizPanel
            question={quizIndex < quizQueue.length ? quizQueue[quizIndex] : null}
            queueLength={quizQueue.length}
            index={quizIndex}
            seconds={quizSeconds}
            results={quizResults}
            checked={quizChecked}
            input={quizInput}
            result={quizResult}
            items={library.items}
            onClose={closeQuiz}
            onSpeak={speak}
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
            onInputChange={setDictInput}
            onBlankChange={setDictBlank}
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
            onClose={() => setListenOpen(false)}
            onToggleRead={readingAll ? stopReadAll : startReadAll}
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
                  onSelectSentence={selectSentence}
                  onFocusEntry={focusEntry}
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
        </div>
        <SideOverview
          mistakes={mistakes}
          readyRows={readyRows}
          boardAction={boardAction}
          onRetryVocab={retryMistakeVocab}
          onRetryListen={retryMistakeListen}
          onRetryDict={retryMistakeDict}
          onClearMistakes={() => setMistakes([])}
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
          onExportAiJobs={exportAiJobs}
          aiFileRef={aiFileRef}
          onAiFile={onAiFile}
          aiWebBatchSize={aiWebBatchSize}
          onAiWebBatchSizeChange={setAiWebBatchSize}
          onCopyWebPrompt={() => void copyAiWebPrompt()}
          onCopyWebMissing={() => void copyAiWebMissing()}
          onRefreshWeb={refreshAiWebRound}
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
          onOpenListening={openListening}
          listenCount={listenCount}
          onListenCountChange={setListenCount}
          onLanguagePrompt={() => void copyLanguagePrompt()}
          showLanguage={showLanguage}
          onShowLanguageChange={setShowLanguage}
          onOpenWriting={openWriting}
          onWrongPractice={() => {
            setQuizScope('lapses')
            setQuizResults([])
            setQuizSetupOpen(true)
          }}
          onBrowseAll={() => setBrowseAll(true)}
          onExportAnki={doExportAnki}
          onPrint={doPrint}
          printTitle={articleTitle || articleKey || '本篇生词'}
          onExportJson={exportJson}
          onCopyMissingPhonetic={(only) => void copyMissingPhonetic(only)}
          onToggleStats={() => setStatsOpen((v) => !v)}
          onExportWrong={doExportWrong}
          onExportAll={exportAll}
          onImportBackup={(f) => void onImportBackup(f)}
          statsOpen={statsOpen}
          stats={{
            totals,
            dayStats,
            studyTodaySeconds,
            studyTotalSeconds,
            studyTotalCards,
            studiedCount: studiedToday.ids.length,
            dailyGoal,
            last7,
            dueForecast: dueForecastRows,
            byArticle,
          }}
          onDailyGoalChange={setDailyGoal}
          articleList={articleList}
          articleNums={articleNums}
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
