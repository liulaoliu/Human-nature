import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { wordSpans } from '../core/wordSelect'
import {
  applyExamples,
  articleWordsOf,
  displayMeaning,
  hasOwnExamples,
  isDue,
  lemmaOf,
  removeItem,
  sortItems,
  type VocabSortBy,
} from '../core/vocab'
import {
  type AnalysisTask,
  type VocabLevel,
} from '../core/analyzer'
import { hasSentenceLanguage } from '../core/language'
import { collectOfflineExampleRows } from '../core/libraryAutoFill'
import {
  addPracticeRecord,
  practiceForArticle,
  type PracticeKind,
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
import { type AiJobsInput } from '../core/aiPackage'
import { activityStreak, addActivity, dayKeyLocal, dayTotal, type ActivityCat } from '../core/activity'
import { buildOutputBoard } from '../core/output'
import { type DrillKind } from './panels/IntensivePanel'
import Composer from './panels/Composer'
import ReaderToolbarHost from './ReaderToolbarHost'
import ReaderOverlaysHost from './ReaderOverlaysHost'
import ReaderShell from './ReaderShell'
import ReaderArticle from './ReaderArticle'
import ReaderSidebarHost from './ReaderSidebarHost'
import SessionHost from './SessionHost'
import { useSpeaking } from './hooks/useSpeaking'
import { useTtsEngines } from './hooks/useTtsEngines'
import { DEFAULT_TTS_VOICE, buildTtsAccents } from '../core/ttsVoices'
import { useAiPack } from './hooks/useAiPack'
import { useDictation } from './hooks/useDictation'
import { useQuizSession } from './hooks/useQuizSession'
import { useStudySession } from './hooks/useStudySession'
import { useLearningData } from './hooks/useLearningData'
import { useHotkeys } from './useHotkeys'
import { useArticleImport } from './hooks/useArticleImport'
import { useLibraryAutoFill } from './hooks/useLibraryAutoFill'
import { useVocabLibrary } from './hooks/useVocabLibrary'
import { useVocabEdits } from './hooks/useVocabEdits'
import { useVocabMode } from './hooks/useVocabMode'
import { useDocVocabSets } from './hooks/useDocVocabSets'
import { useBatchQueue } from './hooks/useBatchQueue'
import { useReaderDerived } from './hooks/useReaderDerived'
import { usePregenerate } from './hooks/usePregenerate'
import { useArticleBootstrap } from './hooks/useArticleBootstrap'
import { articleNumbering } from '../core/articleNums'
import { useAiTasks } from './hooks/useAiTasks'
import { useReaderDoc } from './hooks/useReaderDoc'
import { useApplyTaskResult } from './hooks/useApplyTaskResult'
import { usePasteApply } from './hooks/usePasteApply'
import { useMistakeActions } from './hooks/useMistakeActions'
import { useExport } from './hooks/useExport'
import { useSelection } from './hooks/useSelection'
import { useDictionary } from './hooks/useDictionary'
import { useDictTools } from './hooks/useDictTools'
import { loadTatoeba, tatoebaExamples } from '../adapters/tatoeba'
import { dictionary } from '../adapters/dictionary'
import { useQuickSession } from './hooks/useQuickSession'
import { useListening } from './hooks/useListening'
import { useWriting } from './hooks/useWriting'
import { buildIntensivePlan, type IntensiveStageKey } from '../core/intensive'
import { buildJournalDay, journalDays, journalSummary } from '../core/journal'
import { buildHeatmap } from '../core/activity'
import {
  persistentBool,
  persistentEnum,
  persistentNumber,
  persistentString,
  useLocalStorageState,
  STORAGE_ERROR_EVENT,
} from './hooks/useLocalStorageState'
import type { Paragraph, Sentence, SentenceLanguage, } from '../types/document'
import './reader.css'
interface Doc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

export default function ReaderApp() {
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
  /** 词库的可变引用：跑批里多条任务挨个应用时用它串起来，避免相互覆盖（见 useApplyTaskResult）。 */
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

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1900)
  }, [])

  // 本机存储写失败（配额满 / 隐私模式）：提示一次，别让用户以为已经保存
  useEffect(() => {
    let last = 0
    const onError = () => {
      const now = Date.now()
      if (now - last < 5000) return
      last = now
      flash('本机存储已满：这次的改动只在本页有效，刷新会丢；请先导出备份')
    }
    window.addEventListener(STORAGE_ERROR_EVENT, onError)
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, onError)
  }, [flash])

  /** 逻辑「今天」的日期键（04:00 结算），多处统计共用一份。 */
  const todayKey = dayKeyLocal(new Date())

  // 启动加载：已保存文章列表 + 内置文章目录（IO 收口在 useArticleBootstrap）
  const { book, bookError, saved, setSaved, savedLoaded, articles } = useArticleBootstrap(flash)

  // 词库：读回 / 迁移清洗 / 唯一写入口 / 上一版恢复 —— 全在 hooks/useVocabLibrary
  const { library, libraryRef, libraryLoaded, persist, restorePrev: restorePrevLibrary } = useVocabLibrary({ flash })
  const [articleTitle, setArticleTitle] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [edition, setEdition] = useState('全部')
  /** 有内容改动、需要（首次则建立记录）自动保存 */
  const [pendingSave, setPendingSave] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  /** 是否按住 Ctrl / ⌘（决定「整句」还是「按词吸附」） */
  const [ctrlHeld, setCtrlHeld] = useState(false)
  /** 是否按住 Alt（选词模式下：Alt+拖动选词组，否则只选一个词） */
  const [altHeld, setAltHeld] = useState(false)
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
  // 引擎探测：发现本机离线引擎（SAPI / Piper）后，并入音色下拉
  const ttsEngines = useTtsEngines()
  const ttsAccents = useMemo(() => buildTtsAccents(ttsEngines), [ttsEngines])
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
        flash('服务端语音连不上，已改用浏览器语音；可在音色里选「离线 · 本地语音」（需安装 Piper）')
      } else if (reason === 'local') {
        flash('本地离线语音失败，已改用浏览器语音；请检查 Piper 是否可用')
      } else {
        flash('浏览器拦了自动播放，已改用浏览器语音（点一下页面再试）')
      }
    },
  })

  // 整篇朗读预生成（查缓存 / 增量合成 / 取消）收口在 usePregenerate
  const { pregen, pregenerateAll, cancelPregenerate } = usePregenerate({
    sentences: doc?.sentences ?? null,
    voice: ttsVoice,
  })

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
  /**
   * 每天「学过的不同单词 id」历史（每日目标进度 + 学习日志）由 useLearningData 统一管理。
   */
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
  /** 当前文章的稳定标识：内置用 book key；手动/已保存用 savedId。生词据此归属到文章。 */
  const articleIdentity = articleKey ?? savedId ?? articleTitle
  // 「待选」清单：状态 + 按文章持久化 + 去重（IO 收口在 useBatchQueue）
  const {
    batch,
    setBatch,
    batchMapRef,
    addToBatch,
    mergeBatch,
    batchItemsFromWords,
    batchSentenceIds,
  } = useBatchQueue({ articleIdentity, sentences: doc?.sentences ?? null })

  // 学习记录（练习/错题/活动/背词日/会话/复述/略读/读完/目标）：声明与落盘全在 useLearningData
  const {
    studyDays,
    setStudyDays,
    studiedDays,
    setStudiedDays,
    activity,
    setActivity,
    practice,
    setPractice,
    mistakes,
    setMistakes,
    kindStats,
    setKindStats,
    retells,
    sessions,
    setSessions,
    skimmedArticles,
    readGoal,
    setReadGoal,
    goalMemo,
    setGoalMemo,
    readDone,
    todayReadDone,
    articleReadDay,
    readDays,
    markReadDone,
    undoReadDone,
    saveRetell,
    deleteRetell,
    toggleSkimmed,
    data: learningData,
    setters: learningSetters,
  } = useLearningData({ articleIdentity, articleTitle, articleKey, todayKey, flash })
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

  /** 正文里哪些词算生词（每句 lemma / 全文 lemma / 未掌握词 / 有生词的句子）—— 见 hooks/useDocVocabSets */
  const { docLemmas, libraryLemmas, vocabSidSet } = useDocVocabSets({
    sentences: doc?.sentences ?? null,
    items: library.items,
    batchSentenceIds,
  })

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
  /** 本篇生词编号（规则在 core/articleNums，已单测） */
  const { nums: articleNums, firstOccurrence: articleFirst } = useMemo(
    () => articleNumbering(doc?.sentences, articleWords),
    [doc, articleWords],
  )

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
  const articleRef = useRef<HTMLElement | null>(null)
  const sideRef = useRef<HTMLElement | null>(null)
  const confirmTimerRef = useRef<number | null>(null)
  /** 右键按下中（右键期间跳过 selectionchange 处理，保住 Ctrl 多选的精确选区） */
  const rightDownRef = useRef(false)

  // 跟踪 Ctrl / ⌘ 按住状态（选择逻辑靠它切换「整句 / 按词吸附」）
  useHotkeys(
    (e) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true)
      if (e.key === 'Alt') setAltHeld(true)
    },
    true,
    10,
  )
  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false)
      if (e.key === 'Alt') setAltHeld(false)
    }
    const blur = () => {
      setCtrlHeld(false)
      setAltHeld(false)
    }
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
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

  /**
   * 词库自动补全的**唯一写入口**（语言点收藏 + 离线例句 + 词典词形归并）。
   * 纯计划与幂等保证在 core/libraryAutoFill.ts；接线与「不写第二个 effect」的约定在同名 hook 里。
   */
  const dictReady = useDictionary()
  const { lookupTatoeba, tatoebaReady } = useLibraryAutoFill({
    sentences: doc?.sentences ?? null,
    saved,
    articleIdentity,
    libraryRef,
    libraryLoaded,
    persist,
    dict: dictReady ? dictionary() : null,
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
    queue: studyQueue,
    pool: studyPool,
    unflushedSeconds: studyUnflushed,
    start: startStudy,
    close: closeStudy,
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
    setScope: setQuizScope,
    setLoopWrong: setQuizLoopWrong,
    setupOpen: quizSetupOpen,
    setSetupOpen: setQuizSetupOpen,
    queue: quizQueue,
    setQueue: setQuizQueue,
    index: quizIndex,
    articleKinds: quizArticleKinds,
    startArticle: startArticleQuiz,
    startItems: startQuizItems,
    startDrill: startQuizDrill,
    startArticleDrill: startQuizArticleDrill,
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
    count: listenCount,
    setCount: setListenCount,
    start: openListening,
    startQuestions: startListenQuestions,
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
  /** 目标备忘面板 + 今日读文目标 + 自由备忘（状态在 useLearningData）。 */
  const [goalOpen, setGoalOpen] = useState(false)
  /** 生词本排序方式。 */
  const [vocabSort, setVocabSort] = useLocalStorageState<VocabSortBy>(
    'reader:vocabSort',
    'updatedAt',
    persistentEnum(['word', 'createdAt', 'updatedAt', 'due'] as const, 'updatedAt'),
  )
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

  /** 错题本重练 / 包围战（逻辑在 hooks/useMistakeActions）。 */
  const { retryMistakeVocab, retryMistakeListen, retryMistakeDict, startSiege } = useMistakeActions({
    mistakes,
    libraryItems: library.items,
    startQuizItems,
    startListenQuestions,
    startDictItems,
    setIntensiveOpen,
    setQuizLoopWrong,
    setQuizScope,
    flash,
  })

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
  const { queue: quickQueue, setQueue: setQuickQueue } = quickApi

  /** 词库增删动作（自动标词直入 / 速读加词 / 词组入库 / 移出）；写入仍只走 persist。 */
  const {
    commitBatchItems,
    addItems: addItemsToVocab,
    addPhrases: addPhrasesToVocab,
    removeWord: removeWordFromVocab,
    reviewWord: handleReview,
    editWord: handleEdit,
  } = useVocabEdits({
    libraryRef,
    persist,
    article: { identity: articleIdentity, title: articleTitle, key: articleKey },
    flash,
  })

  /** 仿写训练（逻辑在 hooks/useWriting）。 */
  const writingApi = useWriting({
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
  const {
    open: writingOpen,
    setOpen: setWritingOpen,
    model: writingModel,
    task: writingTask,
    setTask: setWritingTask,
    text: writingText,
    setFeedback: setWritingFeedback,
    history: writingHistory,
    setHistory: setWritingHistory,
    start: openWriting,
  } = writingApi

  // 听力理解题 / 仿写：Esc 退出
  useHotkeys(
    (e) => {
      if (e.key === 'Escape') {
        setListenOpen(false)
        setWritingOpen(false)
      }
    },
    listenOpen || writingOpen,
    20,
  )

  /** 选词模式（开关 / 计时 / 切走暂停 / 关闭记会话）；逻辑在 hooks/useVocabMode。 */
  const { vocabMode, vocabSeconds, toggleVocabMode, sessionPickedRef } = useVocabMode({ setSessions })

  // 派生统计簇（会话累计 / 背词 / 到期预测 / 按文章产出 / AI 候选 / 待选过滤）：
  // 纯派生无副作用，状态仍由各自 hook 持有 —— 逻辑与记忆化都在 useReaderDerived。
  const {
    totals,
    studyTotalSeconds,
    studyTotalCards,
    studyTodaySeconds,
    studyGrandSeconds,
    todayCards,
    todayWrites,
    dayStats,
    last7,
    dueForecastRows,
    savedGroups,
    byArticle,
    confusableTodo,
    confusableBatch,
    lemmaCandidates,
    posCandidates,
    visibleBatch,
  } = useReaderDerived({
    items: library.items,
    sessions,
    studyDays,
    studyUnflushed,
    todayKey,
    writingHistory,
    saved,
    confusableBatchSize,
    batch,
    libraryLemmas,
  })

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
  const { queue: dictQueue, index: dictIndex } = dictApi

  // 键盘 W 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词/听写/考试/快刷时不触发）
  useHotkeys(
    (e) => {
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
    },
    true,
    10,
  )

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
  const readerDocApi = useReaderDoc({
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

  const { loadSaved, renameArticle } = readerDocApi

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
  const aiTasksApi = useAiTasks({
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
    pasteMissing,
  })

  const { copyTranslateAll, copyAutoVocab, copyLanguagePrompt, copyMissingAgain } = aiTasksApi

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

  /** 导出 / 打印 / 备份；逻辑在 hooks/useExport。 */
  const exporter = useExport({
    articles,
    library,
    saved,
    learning: learningData,
    setters: learningSetters,
    writingHistory,
    visibleBatch,
    persist,
    flash,
    setSaved,
    setWritingHistory,
  })

  const { download, doExportAnki, exportWordList, doExportWrong, doPrint } = exporter

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

  /** 正文标记（Sentence.vocab）→ 统计 + 自动/一键重建（丢词时最准的数据源） */

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

  /** 文章测验可出题数（设置面板提示用）。 */
  const articleQuizCount = useMemo(
    () => buildArticleQuestions(doc?.sentences ?? [], { kinds: quizArticleKinds as ArticleQuizKind[] }).length,
    [doc, quizArticleKinds],
  )

  /** AI 工作包：导出待办 / 导入结果（agent）+ 网页版提示词 / 应用 / 重问缺项。 */
  const aiPack = useAiPack({
    jobsInput: aiJobsInput,
    applyTaskResult,
    download,
    flash,
    onReport: setPasteReport,
  })

  const {
    applyWeb: applyAiWeb,
    webPending: aiWebPending,
    localRunning: aiLocalRunning,
    localDone: aiLocalDone,
    localTotal: aiLocalTotal,
    localRound: aiLocalRound,
    localPhase: aiLocalPhase,
    localError: aiLocalError,
    runLocal: runAiLocal,
  } = aiPack

  /** 应用结果 / 工作包解析（逻辑在 hooks/usePasteApply）。 */
  const { applyAnyPaste } = usePasteApply({
    pasted,
    clearPasted: () => setPasted(''),
    lastTask,
    applyTaskResult,
    askedWordsRef,
    askedIdsRef,
    onReport: setPasteReport,
    onMissing: setPasteMissing,
    applyAiWeb,
    flash,
  })

  /** 离线词典（ECDICT）：就绪状态 + 三个"纯本地"动作。 */
  const dictTools = useDictTools({

    library,
    persist,
    doc,
    level: vocabLevel,
    mergeBatch,
    batchItemsFromWords,
    flash,
  })

  const allList = sortItems(library.items, vocabSort)
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

  /** 考试 / 快刷 / 听写 / 听力 进行时（含设置面板）：隐藏正文，别把原文当阅读看。 */
  const examActive = quizSetupOpen || !!quizQueue || !!quickQueue || !!dictQueue || listenOpen || speedReadOpen
  /** 是否处于「阅读」视图：否则（背单词/考试/听写/听力/仿写/全部生词）隐藏精读工具栏 */
  const readingView = !studyQueue && !examActive && !writingOpen && !browseAll

  return (
    <ReaderShell
      fontSize={fontSize}
      bold={bold}
      serif={serif}
      examActive={examActive}
      studying={!!studyQueue}
      sideTab={sideTab}
      sideRef={sideRef}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      toast={toast}
      toolbar={
        <ReaderToolbarHost
          visible={readingView}
          docApi={readerDocApi}
          edition={edition}
          onEditionChange={setEdition}
          book={book}
          saved={saved}
          savedGroups={savedGroups}
          readDays={readDays}
          currentValue={currentValue}
          doc={doc}
          selectedId={selectedId}
          speak={speak}
          editing={editing}
          savedId={savedId}
          onNewArticle={() => setComposing((v) => !v)}
          vocab={{
            mode: vocabMode,
            onToggle: toggleVocabMode,
            level: vocabLevel,
            onLevelChange: setVocabLevel,
            translateView,
            onTranslateViewChange: setTranslateView,
            autoSpeak,
            onAutoSpeakChange: setAutoSpeak,
            onTranslateAll: () => void copyTranslateAll(),
            onAutoVocab: () => void copyAutoVocab(),
          }}
          reading={{
            all: readingAll,
            onToggleAll: readingAll ? stopReadAll : startReadAll,
            onSpeedRead: openSpeedRead,
            onOpenIntensive: () => setIntensiveOpen(true),
            onOpenJournal: () => setJournalOpen(true),
            onOpenGoals: () => setGoalOpen(true),
          }}
          tts={{ state: ttsState, voice: ttsVoice, onVoiceChange: setTtsVoice, accents: ttsAccents }}
          pregen={{ ...pregen, onStart: () => void pregenerateAll(), onCancel: cancelPregenerate }}
          edit={{ draft, onCleanup: () => void copyCleanupPrompt(draft, '「完成」') }}
          stats={{
            vocabSeconds,
            sessionPicked: sessionPickedRef.current,
            todayPicked: dayStats.todayPicked,
            streak: dayStats.streak,
            totalPicked: totals.picked,
            totalSeconds: totals.seconds,
            studiedCount: studiedTodayIds.length,
            dailyGoal,
            libraryCount: library.items.length,
          }}
          display={{
            fontSize,
            onFontSizeChange: setFontSize,
            bold,
            onBoldChange: setBold,
            serif,
            onSerifChange: setSerif,
            eye,
            onEyeChange: setEye,
          }}
          confirmDelSave={confirmDelSave}
        />
      }
      sidebar={
        <ReaderSidebarHost
          sideTab={sideTab}
          onSideTabChange={setSideTab}
          learning={{ mistakes, activity, practice, onClearMistakes: () => setMistakes([]) }}
          overview={{
            readyRows,
            onRetryVocab: retryMistakeVocab,
            onSiege: startSiege,
            onRetryListen: retryMistakeListen,
            onRetryDict: retryMistakeDict,
          }}
          mastery={{ mastery: articleMastery, onStartArticle: startArticleQuiz }}
          derived={{
            totals,
            dayStats,
            studyTodaySeconds,
            studyTotalSeconds,
            studyTotalCards,
            studiedCount: studiedTodayIds.length,
            last7,
            dueForecast: dueForecastRows,
            byArticle,
            visibleBatch,
            confusableBatchCount: confusableBatch.length,
            confusableTodoCount: confusableTodo.length,
            lemmaCount: lemmaCandidates.length,
            posCount: posCandidates.length,
            articleWords,
            articleNums,
            articleAllPrinted,
            articlePrintedAt,
            languageCount: languageSentCount,
          }}
          study={studyApi}
          quiz={quizApi}
          quick={quickApi}
          dict={dictApi}
          speech={speak}
          library={library}
          restorePrev={() => void restorePrevLibrary()}
          listening={{ open: openListeningMode, start: openListening }}
          openSpeedRead={openSpeedRead}
          openWriting={openWriting}
          ai={aiPack}
          tasks={aiTasksApi}
          exporter={exporter}
          dictTools={dictTools}
          dictReady={dictReady}
          tatoeba={{ ready: tatoebaReady, enrichExamples: () => void enrichExamplesFromTatoeba() }}
          selection={{ addSelectionToBatch, mark, jumpToSource }}
          pick={{
            lastTask,
            target,
            useExact,
            vocabMode,
            canMark: !!exact,
            batchCount: batch.length,
            pasted,
            onPastedChange: (v) => {
              setPasted(v)
              if (pasteReport.length) setPasteReport([])
              if (pasteMissing) setPasteMissing(null)
            },
            pasteReport,
            pasteMissingCount: pasteMissing?.words.length ?? 0,
            onApplyPaste: applyAnyPaste,
            onCopyMissingAgain: () => void copyMissingAgain(),
            onOpenLang: () => openLangFor(sentence),
            onRemoveWord: (b) => addToBatch([b.word], b.sentence, b.sentenceId),
            onClearBatch: () => setBatch([]),
            scope: aiPackScope,
            onScopeChange: setAiPackScope,
            autoVocabDirect,
            onAutoVocabDirectChange: setAutoVocabDirect,
            confusableBatchSize,
            onConfusableBatchSizeChange: setConfusableBatchSize,
          }}
          vocab={{
            view: vocabView,
            onViewChange: setVocabView,
            sortBy: vocabSort,
            onSortChange: setVocabSort,
            hasDoc: !!doc,
            listenCount,
            onListenCountChange: setListenCount,
            onLanguagePrompt: () => void copyLanguagePrompt(),
            showLanguage,
            onShowLanguageChange: setShowLanguage,
            onOpenPlan: () => setPlanOpen(true),
            onBrowseAll: () => setBrowseAll(true),
            printTitle: articleTitle || articleKey || '本篇生词',
            onOpenExport: () => setExportOpen(true),
            onToggleStats: () => setStatsOpen((v) => !v),
            statsOpen,
            dailyGoal,
            onDailyGoalChange: setDailyGoal,
            focusLemma,
            onFocusLemmaChange: setFocusLemma,
            confirmDel,
            onConfirmDelChange: setConfirmDel,
            onDelete: askDelete,
            onEdit: handleEdit,
            onReview: handleReview,
          }}
        />
      }
    >
      {bookError && !book && (
          <p className="muted">没取到 articles.json（要 http://localhost 打开且文件存在）。可直接把正文粘在下面。</p>
        )}

        <SessionHost
          items={library.items}
          speak={speak}
          resetSpeech={resetSpeech}
          ttsState={ttsState}
          playDictItem={playDictItem}
          study={{ api: studyApi, grandSeconds: studyGrandSeconds, newLimit, newToday, onNewLimitChange: setNewLimit }}
          quiz={quizApi}
          quizArticleAvailable={articleQuizCount}
          quick={quickApi}
          dict={dictApi}
          listening={{
            api: listenApi,
            transcript: doc ? doc.sentences.map((s) => s.text).join(' ') : null,
            readingAll,
            readMode: listenReadMode,
            onToggleRead: readingAll ? stopReadAll : startReadAll,
            onClose: () => {
              setListenOpen(false)
              setListenReadMode(false)
            },
          }}
          writing={writingApi}
        />

        <ReaderOverlaysHost
          speed={{
            open: speedReadOpen && !!doc,
            sentences: doc?.sentences ?? [],
            docKey: articleIdentity,
            onClose: () => setSpeedReadOpen(false),
            onSpeak: speak,
            ttsState,
            onAddItems: addItemsToVocab,
            isKnown: (w) => knownLemmas.has(lemmaOf(w)),
            wordMeaning: (w) => {
              const it = library.items.find((x) => x.lemma === lemmaOf(w) || x.word.toLowerCase() === w.toLowerCase())
              return it ? displayMeaning(it) || it.meaning || null : null
            },
            onFinishRead: markReadDone,
            onAddPhrases: addPhrasesToVocab,
            onHint: flash,
            wordsInSentence,
            onRemoveWord: removeWordFromVocab,
            vocabMode,
            onOpenLang: openLangFor,
            langEditorOpen: langOpen,
          }}
          lang={{ open: langOpen, sentence: langTarget, onSave: saveLanguage, onClose: () => setLangOpen(false) }}
          plan={{
            open: planOpen,
            onClose: () => setPlanOpen(false),
            hasDoc: !!doc,
            articleTitle,
            todoPending: aiWebPending,
            todayCards,
            todayWrites,
            todayKey,
            onNewArticle: () => {
              setPlanOpen(false)
              setComposing(true)
            },
            onStartStudy: () => {
              setPlanOpen(false)
              startStudy()
            },
            onOpenSpeedRead: () => {
              setPlanOpen(false)
              openSpeedRead()
            },
          }}
          intensive={{
            open: intensiveOpen,
            onClose: () => setIntensiveOpen(false),
            articleTitle,
            hasDoc: !!doc,
            plan: intensivePlan,
            skimmed: intensiveSkimmed,
            onToggleSkimmed: toggleSkimmed,
            onRunBatch: () => void runAiLocal(),
            batchRunning: aiLocalRunning,
            batchRound: aiLocalRound,
            batchPhase: aiLocalPhase,
            batchDone: aiLocalDone,
            batchTotal: aiLocalTotal,
            batchError: aiLocalError,
            board: outputBoard,
            retells: myRetells,
            onSaveRetell: saveRetell,
            onDeleteRetell: deleteRetell,
            onStage: openIntensiveStage,
            onDrill: startIntensiveDrill,
            onSiege: startSiege,
          }}
          goal={{
            open: goalOpen,
            onClose: () => setGoalOpen(false),
            todayKey,
            done: todayReadDone,
            allDone: readDone,
            goal: readGoal,
            onGoalChange: setReadGoal,
            memo: goalMemo,
            onMemoChange: setGoalMemo,
            articleTitle,
            articleDone: articleReadDay !== null,
            articleReadDay,
            onMarkDone: markReadDone,
            onUndo: undoReadDone,
          }}
          exporter={{
            open: exportOpen,
            onClose: () => setExportOpen(false),
            libraryItems: library.items,
            articleTitle,
            articleWords,
            articles: exportArticles,
            todayKey,
            onPrint: doPrint,
            onExportAnki: doExportAnki,
            onExportWordList: exportWordList,
          }}
          journal={{
            open: journalOpen,
            onClose: () => setJournalOpen(false),
            days: journalAllDays,
            day: journalDay,
            onDayChange: setJournalDay,
            data: journalData,
            summary: journalSummaryRows,
            heat: journalHeat,
            onSpeak: speak,
          }}
          allVocab={{
            open: browseAll,
            items: library.items,
            list: allList,
            view: vocabView,
            onViewChange: setVocabView,
            focusLemma,
            confirmDel,
            onSpeak: speak,
            onDelete: askDelete,
            onReview: handleReview,
            onEdit: handleEdit,
            onClose: () => setBrowseAll(false),
            onExportAnki: doExportAnki,
            onPrint: doPrint,
            onExportWrong: doExportWrong,
          }}
        />

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
          <ReaderArticle
            doc={doc}
            articleTitle={articleTitle}
            articleKey={articleKey}
            onRename={() => void renameArticle()}
            editing={editing}
            draft={draft}
            onDraftChange={setDraft}
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
            onSpeakFromWord={speakFromWord}
            onAddPhrase={addPhrasesToVocab}
          />
        )}
    </ReaderShell>
  )
}
