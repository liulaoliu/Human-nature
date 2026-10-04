import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { styleOf, type ArticleBook } from '../core/matchArticle'
import { cleanText } from '../core/cleaner'
import { carryAnalysis, segment } from '../core/segmenter'
import { snapSelection, wordSpans } from '../core/wordSelect'
import {
  applyConfusables,
  applyLemmaMap,
  applyPosAnalysis,
  applyWordAnalysis,
  buildLearnQueue,
  buildReviewQueue,
  createLibrary,
  dedupeLibrary,
  editItem,
  groupItems,
  isDue,
  lemmaOf,
  markWord,
  normalizeWord,
  relemmaLibrary,
  removeItem,
  review,
  reviewItem,
  sortItems,
  type ReviewGrade,
  type StudyMode,
} from '../core/vocab'
import {
  applyToSentence,
  buildAutoVocabPrompt,
  buildBatchLookupPrompt,
  buildCleanupPrompt,
  buildConfusablePrompt,
  buildLemmaPrompt,
  buildPosPrompt,
  buildPrompt,
  buildTranslateAllPrompt,
  parseAnalysis,
  parseConfusables,
  parseLemmaTable,
  parsePosTable,
  parseWordList,
  type AnalysisTask,
  type VocabLevel,
} from '../core/analyzer'
import { exportLibraryJSON, renderPrintHTML, toAnkiCSV, toWordsCSV, toWrongWordsCSV } from '../core/exports'
import {
  buildQuizQuestions,
  formatAnswerInput,
  isCorrect,
  isQuizKind,
  makeQuestion,
  maskAnswer,
  QUIZ_KIND_LABEL,
  shuffleQuiz,
  type QuizKind,
  type QuizQuestion,
} from '../core/quiz'
import {
  diffWords,
  dictationWrongWords,
  isClozeBlankCorrect,
  makeCloze,
  pickBlankTargets,
  splitForDictation,
  type ClozeQuestion,
  type DiffToken,
} from '../core/dictation'
import {
  buildListeningQuizPrompt,
  gradeListening,
  isListeningCorrect,
  parseListeningQuiz,
  type ListeningQuestion,
  type ListeningQuiz,
  type ListeningResult,
} from '../core/listening'
import { applyLanguage, buildLanguagePrompt, parseLanguage } from '../core/language'
import {
  accuracy,
  addPracticeRecord,
  PRACTICE_LABEL,
  recentPractice,
  sumByKind,
  sumPractice,
  type PracticeKind,
  type PracticeRecord,
} from '../core/practice'
import {
  dictMistake,
  listenMistake,
  MISTAKE_LABEL,
  mistakeCounts,
  removeMistake,
  upsertMistake,
  vocabMistake,
  type MistakeEntry,
} from '../core/mistakes'
import { buildReadiness } from '../core/readiness'
import {
  ACTIVITY_CATS,
  ACTIVITY_LABEL,
  activityStreak,
  addActivity,
  buildHeatmap,
  dayKeyLocal,
  dayTotal,
  sumCats,
  type ActivityCat,
  type DayActivity,
} from '../core/activity'
import {
  addWritingRecord,
  buildImitationTaskPrompt,
  buildWritingFeedbackPrompt,
  parseImitationTask,
  parseWritingFeedback,
  type ImitationTask,
  type WritingFeedback,
  type WritingRecord,
} from '../core/writing'
import { createVocabRepo } from '../adapters/vocabRepo'
import { createArticleRepo, type ArticleRepoPort, type SavedArticle } from '../adapters/articleRepo'
import { extractEpub, extractPdfText } from './importers'
import ArticlePicker from './ArticlePicker'
import VocabList, { type VocabEditPatch } from './VocabList'
import FishLayer from '../ui/FishLayer'
import type { VocabRepoPort } from '../core/ports'
import type { Paragraph, Sentence, VocabLibrary, VocabItem } from '../types/document'
import mascotAI from '../../assets/imgs/GinShinImapct.png'
import './reader.css'

interface Doc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

/** 老记录没存 text 时，从段落/句子还原正文。 */
function reconstructText(a: SavedArticle): string {
  const byId = new Map(a.sentences.map((s) => [s.id, s]))
  return a.paragraphs
    .map((p) => p.sentenceIds.map((id) => byId.get(id)?.text ?? '').join(' '))
    .join('\n\n')
}

/** 顺着节点往上找它所在的句子 span（用 class="sent" 认）。 */
function sentSpanOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node instanceof Element ? node : node?.parentNode ?? null
  while (el && !(el instanceof HTMLElement && el.classList.contains('sent'))) el = el.parentNode
  return el instanceof HTMLElement ? el : null
}

/** 按期次给内置文章分组。文件名写法区分两代（见 matchArticle.styleOf）。 */
const EDITION_LABEL: Record<ReturnType<typeof styleOf>, string> = {
  spaced: '2016-09-10',
  dashed: '2021-06-12',
  other: '其它',
}
function editionOf(key: string): string {
  return EDITION_LABEL[styleOf(key)]
}

/** 秒 → `m:ss` 或 `h:mm`（用于选词模式计时与统计） */
function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}:${String(sec % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** 复习间隔（天）→「明天 / N 天后 / N 个月后」。 */
function fmtInterval(days: number): string {
  if (days <= 0) return '稍后'
  if (days === 1) return '明天'
  if (days < 30) return `${days} 天后`
  return `${Math.round(days / 30)} 个月后`
}

/** 到期时间（ISO）→「现在 / 明天 / N 天后」。 */
function fmtDue(iso: string | null): string {
  if (!iso) return ''
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days <= 0) return '现在'
  if (days === 1) return '明天'
  return `${days} 天后`
}

/** 请求的词里，AI 没返回的（按 lemma 比较）。 */
function missingWords(requested: string[], returned: string[]): string[] {
  const got = new Set(returned.map((w) => lemmaOf(w)))
  return requested.filter((w) => !got.has(lemmaOf(w)))
}

/** 本机时区的日期键 YYYY-MM-DD */
function localDayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 把一句话渲染成"词 span + 标点文本"，落在 active 词区间内的词包上 `.hl`（圆角高亮）。
 * 用 wordSpans 切，保证和 snapSelection 的词序号一致。
 */
function sentenceNodes(
  text: string,
  active: Set<number> | null,
  lemmas: Set<string>,
  onWord: (word: string) => void,
  sid?: string,
  nums?: Map<string, number> | null,
  firstNums?: Set<string> | null,
): ReactNode[] {
  const spans = wordSpans(text)
  const out: ReactNode[] = []
  let pos = 0
  spans.forEach((w, i) => {
    if (w.start > pos) out.push(text.slice(pos, w.start))
    const on = active !== null && active.has(i)
    if (on) {
      out.push(<span key={`w${i}`} className="hl">{w.text}</span>)
    } else {
      const key = w.text.toLowerCase()
      const isVocab = lemmas.has(key) || lemmas.has(lemmaOf(key))
      const num = nums ? (nums.get(lemmaOf(key)) ?? nums.get(key)) : undefined
      const showNum = num != null && !!firstNums?.has(`${sid}:${i}`)
      out.push(
        isVocab ? (
          <span key={`w${i}`} className="vw" onClick={() => onWord(w.text)} title="在生词本里查看">
            {w.text}
            {showNum && <sup className="wnum">{num}</sup>}
          </span>
        ) : (
          w.text
        ),
      )
    }
    pos = w.end
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

/** container/offset 相对 root 起点、按字符算的偏移量。 */
function offsetIn(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null
  const r = document.createRange()
  r.selectNodeContents(root)
  r.setEnd(container, offset)
  return r.toString().length
}

const TASKS: { task: AnalysisTask; label: string }[] = [
  { task: 'translate', label: '翻译' },
  { task: 'lookup', label: '查词' },
  { task: 'grammar', label: '语法' },
  { task: 'collocations', label: '搭配' },
  { task: 'extract_vocab', label: '提取生词' },
  { task: 'summarize', label: '概述' },
]

/** 「选词模式」里攒的待选生词。 */
interface BatchItem {
  word: string
  sentence: string
  sentenceId: string | null
}

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

/** 仿写草稿（范句 / 作答 / 任务）持久化：刷新不丢。 */
function loadWritingDraft(): {
  model: string
  text: string
  task: ImitationTask | null
} {
  try {
    const raw = localStorage.getItem('reader:writingDraft')
    const v = raw ? (JSON.parse(raw) as { model?: string; text?: string; task?: ImitationTask | null }) : null
    if (v && typeof v === 'object') return { model: v.model ?? '', text: v.text ?? '', task: v.task ?? null }
  } catch {
    // 忽略
  }
  return { model: '', text: '', task: null }
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
  const [fontSize, setFontSize] = useState(() => {
    try {
      return localStorage.getItem('reader:size') ?? 'md'
    } catch {
      return 'md'
    }
  })
  /** 右侧面板当前 Tab：总览 / 选词分析 / 生词本 / 统计 */
  const [sideTab, setSideTab] = useState<'overview' | 'pick' | 'vocab' | 'stats'>(() => {
    try {
      const v = localStorage.getItem('reader:sideTab')
      return v === 'vocab' || v === 'pick' || v === 'stats' ? v : 'overview'
    } catch {
      return 'overview'
    }
  })
  const [bold, setBold] = useState(() => {
    try {
      return localStorage.getItem('reader:bold') === '1'
    } catch {
      return false
    }
  })
  const [serif, setSerif] = useState(() => {
    try {
      return localStorage.getItem('reader:serif') === '1'
    } catch {
      return false
    }
  })
  /** 护眼模式（深绿暗色） */
  const [eye, setEye] = useState(() => {
    try {
      return localStorage.getItem('reader:theme') === 'green'
    } catch {
      return false
    }
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
  const [translateView, setTranslateView] = useState<'off' | 'below' | 'only'>(() => {
    try {
      const v = localStorage.getItem('reader:translateView')
      return v === 'below' || v === 'only' ? v : 'off'
    } catch {
      return 'off'
    }
  })
  const [pdfRange, setPdfRange] = useState('')
  const [importing, setImporting] = useState('')
  /** 选中句子后自动 TTS 朗读 */
  const [autoSpeak, setAutoSpeak] = useState(() => {
    try {
      return localStorage.getItem('reader:autoSpeak') === '1'
    } catch {
      return false
    }
  })
  /** 自动标词的词汇标准 */
  const [vocabLevel, setVocabLevel] = useState<VocabLevel>(() => {
    try {
      const v = localStorage.getItem('reader:vocabLevel')
      return v === 'cet4' || v === 'cet6' || v === 'kaoyan' || v === 'ielts' || v === 'ielts65'
        ? v
        : 'cet6'
    } catch {
      return 'cet6'
    }
  })
  /** a/d 临时提示的句子（有生词，底色与"选中句"略不同） */
  const [peekSid, setPeekSid] = useState<string | null>(null)
  /** 生词本视图：卡片 / 密排表格 */
  const [vocabView, setVocabView] = useState<'card' | 'table'>(() => {
    try {
      return localStorage.getItem('reader:vocabView') === 'table' ? 'table' : 'card'
    } catch {
      return 'card'
    }
  })
  /** 生词本里被高亮/滚到的词条（点正文生词时用） */
  const [focusLemma, setFocusLemma] = useState<string | null>(null)
  /** 待确认删除的词条 id（两步防误触） */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  /** 「删除保存」文章的两步确认 */
  const [confirmDelSave, setConfirmDelSave] = useState(false)
  /** 背单词模式：本轮队列 / 当前序号 / 是否已翻面 */
  const [studyQueue, setStudyQueue] = useState<VocabItem[] | null>(null)
  const [studyIndex, setStudyIndex] = useState(0)
  const [studyRevealed, setStudyRevealed] = useState(false)
  /** 当前卡停留秒数（催你快点背） */
  const [cardSeconds, setCardSeconds] = useState(0)
  /** 背单词时长统计：本轮实时秒数 + 按天累计（落盘，供统计用） */
  const [studyLive, setStudyLive] = useState(0)
  const studyLiveRef = useRef(0)
  const studyFlushedRef = useRef(0)
  const [studyDays, setStudyDays] = useState<{ day: string; seconds: number; cards: number }[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:studyStats') ?? '[]')
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })
  /** 背单词范围 / 拼写模式 / 拼写输入 / 是否已判卷 */
  const [studyScope, setStudyScope] = useState<'all' | 'article' | 'unmastered' | 'lapses'>(() => {
    try {
      const v = localStorage.getItem('reader:studyScope')
      return v === 'all' || v === 'article' || v === 'lapses' ? v : 'unmastered'
    } catch {
      return 'unmastered'
    }
  })
  const [studySpelling, setStudySpelling] = useState(() => {
    try {
      return localStorage.getItem('reader:studySpelling') === '1'
    } catch {
      return false
    }
  })
  const [studyInput, setStudyInput] = useState('')
  const [studyChecked, setStudyChecked] = useState(false)
  /** 背单词模式：新学习 / 复习 */
  const [studyMode, setStudyMode] = useState<StudyMode>(() => {
    try {
      return localStorage.getItem('reader:studyMode') === 'review' ? 'review' : 'learn'
    } catch {
      return 'learn'
    }
  })
  /** 卡内编辑（改词形/音标/释义/用法）与两步删除 */
  const [studyEditOpen, setStudyEditOpen] = useState(false)
  const [studyDraft, setStudyDraft] = useState<{
    word: string
    phonetic: string
    partOfSpeech: string
    meaning: string
    usage: string
  } | null>(null)
  const [studyDelArmed, setStudyDelArmed] = useState(false)
  /** 本轮评分计数（认识 / 模糊 / 忘记），用于本轮小结 */
  const [studyCounts, setStudyCounts] = useState({ know: 0, fuzzy: 0, forgot: 0 })
  /** 评分后短暂提示「下次复习：X」 */
  const [gradeInfo, setGradeInfo] = useState('')
  /** 每个词本轮被"忘记/模糊"重排的次数（防死循环） */
  const studyRequeueRef = useRef<Map<string, number>>(new Map())
  /** 本轮点过「忘记了」的词 id，用于收尾重练 */
  const studyForgotRef = useRef<string[]>([])
  /** 本轮已计入每日新词配额的 id（重排后不重复计数） */
  const studyBumpedRef = useRef<Set<string>>(new Set())

  /** 考试（检验掌握）：设置 + 一轮题目 + 作答状态 */
  const [quizSetupOpen, setQuizSetupOpen] = useState(false)
  const [quizKinds, setQuizKinds] = useState<QuizKind[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:quizKinds') ?? 'null')
      if (Array.isArray(raw) && raw.length) {
        const valid = raw.filter(isQuizKind)
        if (valid.length) return valid
      }
    } catch {
      // 忽略
    }
    return ['spell', 'cloze', 'usage']
  })
  const [quizScope, setQuizScope] = useState<'all' | 'article' | 'unmastered' | 'due' | 'lapses'>(() => {
    try {
      const v = localStorage.getItem('reader:quizScope')
      return v === 'all' || v === 'article' || v === 'due' || v === 'lapses' ? v : 'unmastered'
    } catch {
      return 'unmastered'
    }
  })
  const [quizLimit, setQuizLimit] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:quizLimit') ?? '20')
      return Number.isFinite(n) && n >= 0 ? n : 20
    } catch {
      return 20
    }
  })
  const [quizQueue, setQuizQueue] = useState<QuizQuestion[] | null>(null)
  const [quizIndex, setQuizIndex] = useState(0)
  const [quizInput, setQuizInput] = useState('')
  const [quizChecked, setQuizChecked] = useState(false)
  const [quizResult, setQuizResult] = useState<boolean | null>(null)
  const [quizResults, setQuizResults] = useState<{ id: string; itemId: string; correct: boolean }[]>([])
  const [quizSeconds, setQuizSeconds] = useState(0)
  const quizInputRef = useRef<HTMLInputElement>(null)
  /** 答完自动下一题（默认关，保持手动回车） */
  const [quizAuto, setQuizAuto] = useState(() => {
    try {
      return localStorage.getItem('reader:quizAuto') === '1'
    } catch {
      return false
    }
  })
  /** 每个单词只出一题、题型随机（避免同一词连出几题） */
  const [quizUnique, setQuizUnique] = useState(() => {
    try {
      return localStorage.getItem('reader:quizUnique') !== '0'
    } catch {
      return true
    }
  })
  /** 答完朗读正确答案（默认开） */
  const [quizSpeak, setQuizSpeak] = useState(() => {
    try {
      return localStorage.getItem('reader:quizSpeak') !== '0'
    } catch {
      return true
    }
  })
  /** 放 speak 的引用：checkQuiz 定义在 speak 之前，用 ref 避免顺序问题 */
  const speakRef = useRef<(text: string) => void>(() => {})
  const quizAdvanceRef = useRef<number | null>(null)
  const quizRecordedRef = useRef(false)
  /** 本轮实际是否自动切题（听写模式强制开） */
  const [quizAutoRun, setQuizAutoRun] = useState(false)
  /** 今天学过的不同单词 id（每日目标进度） */
  const [studiedToday, setStudiedToday] = useState<{ day: string; ids: string[] }>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:studiedToday') ?? 'null') as {
        day: string
        ids: string[]
      } | null
      if (raw && Array.isArray(raw.ids)) {
        return raw.day === localDayKey() ? raw : { day: localDayKey(), ids: [] }
      }
    } catch {
      // 忽略
    }
    return { day: localDayKey(), ids: [] }
  })
  /** 每日目标（个不同单词，0=不设目标） */
  const [dailyGoal, setDailyGoal] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:dailyGoal') ?? '20')
      return Number.isFinite(n) && n >= 0 ? n : 20
    } catch {
      return 20
    }
  })
  /** 快刷模式（只看单词+音标，一键过卡） */
  const [quickQueue, setQuickQueue] = useState<VocabItem[] | null>(null)
  const [quickIndex, setQuickIndex] = useState(0)
  const [quickRevealed, setQuickRevealed] = useState(false)
  /** 逐句听写：按文章顺序播句子（长句自动切短），听写整句或听音填空 */
  const [dictQueue, setDictQueue] = useState<{ id: string; text: string }[] | null>(null)
  const [dictIndex, setDictIndex] = useState(0)
  const [dictInput, setDictInput] = useState('')
  const [dictChecked, setDictChecked] = useState(false)
  const [dictDiff, setDictDiff] = useState<DiffToken[] | null>(null)
  /** 填空模式的作答（每空一个输入） */
  const [dictBlanks, setDictBlanks] = useState<string[]>([])
  const dictInputRef = useRef<HTMLTextAreaElement>(null)
  const dictFirstBlankRef = useRef<HTMLInputElement>(null)
  /** 当前填空（供 checkDict 判分用，避免声明顺序问题）与「答对自动下一句」的定时器 */
  const dictClozeRef = useRef<ClozeQuestion | null>(null)
  const dictAdvanceRef = useRef<number | null>(null)
  /** 听写本轮结果（每题是否全对）与错题（用于重练） */
  const [dictResults, setDictResults] = useState<boolean[]>([])
  const [dictWrongItems, setDictWrongItems] = useState<{ id: string; text: string }[]>([])
  const dictRecordedRef = useRef(false)
  /** 听写模式：整句 / 填空 */
  const [dictMode, setDictMode] = useState<'full' | 'cloze'>(() => {
    try {
      return localStorage.getItem('reader:dictMode') === 'cloze' ? 'cloze' : 'full'
    } catch {
      return 'full'
    }
  })
  /** 每句最多多少词（长句按此切短，用户可调） */
  const [dictWords, setDictWords] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:dictWords') ?? '12')
      return Number.isFinite(n) && n >= 1 && n <= 30 ? n : 12
    } catch {
      return 12
    }
  })
  /** 填空模式下每题的挖空数量 */
  const [dictBlankCount, setDictBlankCount] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:dictBlankCount') ?? '2')
      return Number.isFinite(n) && n >= 1 && n <= 8 ? n : 2
    } catch {
      return 2
    }
  })
  const libraryLemmasRef = useRef<Set<string>>(new Set())
  /** 听力理解题：AI 出的题（严格 JSON）+ 作答 + 判分 */
  const [listenQuiz, setListenQuiz] = useState<ListeningQuiz | null>(null)
  const [listenOpen, setListenOpen] = useState(false)
  const [listenWrongIds, setListenWrongIds] = useState<string[] | null>(null)
  const [listenAnswers, setListenAnswers] = useState<Record<string, string>>({})
  const [listenSubmitted, setListenSubmitted] = useState(false)
  const [listenResult, setListenResult] = useState<ListeningResult | null>(null)
  const [listenCount, setListenCount] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:listenCount') ?? '8')
      return Number.isFinite(n) && n > 0 ? n : 8
    } catch {
      return 8
    }
  })
  /** 是否在正文里显示语言点 */
  const [showLanguage, setShowLanguage] = useState(() => {
    try {
      return localStorage.getItem('reader:showLanguage') === '1'
    } catch {
      return false
    }
  })
  /** 仿写训练：范句 / 任务 / 作答 / 批改 */
  const [writingOpen, setWritingOpen] = useState(false)
  const [writingModel, setWritingModel] = useState(() => loadWritingDraft().model)
  const [writingTask, setWritingTask] = useState<ImitationTask | null>(() => loadWritingDraft().task)
  const [writingText, setWritingText] = useState(() => loadWritingDraft().text)
  const [writingFeedback, setWritingFeedback] = useState<WritingFeedback | null>(null)
  /** 仿写练习历史（存本机） */
  const [writingHistory, setWritingHistory] = useState<WritingRecord[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:writingHistory') ?? '[]')
      return Array.isArray(raw) ? (raw as WritingRecord[]) : []
    } catch {
      return []
    }
  })
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 学习活动统计（按天，落 localStorage） */
  const [activity, setActivity] = useState<DayActivity[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:activity') ?? '[]')
      return Array.isArray(raw) ? (raw as DayActivity[]) : []
    } catch {
      return []
    }
  })
  /** 练习成绩记录（考试 / 听写 / 听力理解） */
  const [practice, setPractice] = useState<PracticeRecord[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:practice') ?? '[]')
      return Array.isArray(raw) ? (raw as PracticeRecord[]) : []
    } catch {
      return []
    }
  })
  /** 统一错题本（考试错词 / 听力错题 / 听写漏词） */
  const [mistakes, setMistakes] = useState<MistakeEntry[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:mistakes') ?? '[]')
      return Array.isArray(raw) ? (raw as MistakeEntry[]) : []
    } catch {
      return []
    }
  })
  /** 每次生成混淆项的批量大小（0=全部） */
  const [confusableBatchSize, setConfusableBatchSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:confusableBatch') ?? '60')
      return Number.isFinite(n) && n >= 0 ? n : 60
    } catch {
      return 60
    }
  })
  /** 每天引入新词的上限（0=不限）与今天已引入 */
  const [newLimit, setNewLimit] = useState(() => {
    try {
      const n = Number(localStorage.getItem('reader:newLimit') ?? '20')
      return Number.isFinite(n) && n >= 0 ? n : 20
    } catch {
      return 20
    }
  })
  const [newToday, setNewToday] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('reader:newToday') ?? 'null') as {
        day: string
        count: number
      } | null
      return raw && raw.day === localDayKey() ? raw.count : 0
    } catch {
      return 0
    }
  })
  /** 选词模式：最近选中的词 + 气泡位置 */
  const [lastPicked, setLastPicked] = useState<{ word: string; sid: string } | null>(null)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null)
  /** 选词模式计时（秒）与历史统计 */
  const [vocabSeconds, setVocabSeconds] = useState(0)
  const [sessions, setSessions] = useState<{ at: string; seconds: number; picked: number }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('reader:vocabStats') ?? '[]')
    } catch {
      return []
    }
  })
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
  const saveDelTimerRef = useRef<number | null>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  /** 是否正在「朗读全文」（TTS 逐句） */
  const readAllRef = useRef(false)
  const [readingAll, setReadingAll] = useState(false)
  /** 右键按下中（右键期间跳过 selectionchange 处理，保住 Ctrl 多选的精确选区） */
  const rightDownRef = useRef(false)
  const lastSpokenRef = useRef<string | null>(null)

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

  useEffect(() => {
    try {
      localStorage.setItem('reader:size', fontSize)
    } catch {
      // 忽略
    }
  }, [fontSize])
  useEffect(() => {
    try {
      localStorage.setItem('reader:sideTab', sideTab)
    } catch {
      // 忽略
    }
  }, [sideTab])
  useEffect(() => {
    try {
      localStorage.setItem('reader:bold', bold ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [bold])
  useEffect(() => {
    try {
      localStorage.setItem('reader:serif', serif ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [serif])
  useEffect(() => {
    const theme = eye ? 'green' : 'dark'
    try {
      localStorage.setItem('reader:theme', theme)
    } catch {
      // 忽略
    }
    document.documentElement.dataset.theme = theme
  }, [eye])
  useEffect(() => {
    try {
      localStorage.setItem('reader:vocabView', vocabView)
    } catch {
      // 忽略
    }
  }, [vocabView])
  useEffect(() => {
    try {
      localStorage.setItem('reader:studyScope', studyScope)
    } catch {
      // 忽略
    }
  }, [studyScope])
  useEffect(() => {
    try {
      localStorage.setItem('reader:studySpelling', studySpelling ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [studySpelling])
  useEffect(() => {
    try {
      localStorage.setItem('reader:studyMode', studyMode)
    } catch {
      // 忽略
    }
  }, [studyMode])
  useEffect(() => {
    try {
      localStorage.setItem('reader:quizKinds', JSON.stringify(quizKinds))
      localStorage.setItem('reader:quizScope', quizScope)
      localStorage.setItem('reader:quizLimit', String(quizLimit))
      localStorage.setItem('reader:quizAuto', quizAuto ? '1' : '0')
      localStorage.setItem('reader:quizUnique', quizUnique ? '1' : '0')
      localStorage.setItem('reader:quizSpeak', quizSpeak ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [quizKinds, quizScope, quizLimit, quizAuto, quizUnique, quizSpeak])
  useEffect(() => {
    try {
      localStorage.setItem('reader:studyStats', JSON.stringify(studyDays))
    } catch {
      // 忽略
    }
  }, [studyDays])
  useEffect(() => {
    try {
      localStorage.setItem('reader:studiedToday', JSON.stringify(studiedToday))
    } catch {
      // 忽略
    }
  }, [studiedToday])
  useEffect(() => {
    try {
      localStorage.setItem('reader:dailyGoal', String(dailyGoal))
    } catch {
      // 忽略
    }
  }, [dailyGoal])
  useEffect(() => {
    try {
      localStorage.setItem('reader:confusableBatch', String(confusableBatchSize))
    } catch {
      // 忽略
    }
  }, [confusableBatchSize])
  useEffect(() => {
    try {
      localStorage.setItem('reader:listenCount', String(listenCount))
    } catch {
      // 忽略
    }
  }, [listenCount])
  useEffect(() => {
    try {
      localStorage.setItem('reader:showLanguage', showLanguage ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [showLanguage])
  useEffect(() => {
    try {
      localStorage.setItem('reader:writingHistory', JSON.stringify(writingHistory))
    } catch {
      // 忽略
    }
  }, [writingHistory])
  useEffect(() => {
    try {
      localStorage.setItem('reader:activity', JSON.stringify(activity))
    } catch {
      // 忽略
    }
  }, [activity])
  useEffect(() => {
    try {
      localStorage.setItem('reader:practice', JSON.stringify(practice))
    } catch {
      // 忽略
    }
  }, [practice])
  useEffect(() => {
    try {
      localStorage.setItem('reader:mistakes', JSON.stringify(mistakes))
    } catch {
      // 忽略
    }
  }, [mistakes])
  useEffect(() => {
    try {
      localStorage.setItem(
        'reader:writingDraft',
        JSON.stringify({ model: writingModel, text: writingText, task: writingTask }),
      )
    } catch {
      // 忽略
    }
  }, [writingModel, writingText, writingTask])
  useEffect(() => {
    try {
      localStorage.setItem('reader:dictMode', dictMode)
    } catch {
      // 忽略
    }
  }, [dictMode])
  useEffect(() => {
    try {
      localStorage.setItem('reader:dictWords', String(dictWords))
    } catch {
      // 忽略
    }
  }, [dictWords])
  useEffect(() => {
    try {
      localStorage.setItem('reader:dictBlankCount', String(dictBlankCount))
    } catch {
      // 忽略
    }
  }, [dictBlankCount])
  // 换文章时载入该篇已生成的听力理解题
  useEffect(() => {
    try {
      const raw = localStorage.getItem('reader:listening:' + articleIdentity)
      setListenQuiz(raw ? (JSON.parse(raw) as ListeningQuiz) : null)
    } catch {
      setListenQuiz(null)
    }
    setListenOpen(false)
    setListenAnswers({})
    setListenSubmitted(false)
    setListenResult(null)
  }, [articleIdentity])
  useEffect(() => {
    try {
      localStorage.setItem('reader:newLimit', String(newLimit))
    } catch {
      // 忽略
    }
  }, [newLimit])
  useEffect(() => {
    try {
      localStorage.setItem('reader:translateView', translateView)
    } catch {
      // 忽略
    }
  }, [translateView])
  useEffect(() => {
    try {
      localStorage.setItem('reader:autoSpeak', autoSpeak ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [autoSpeak])
  useEffect(() => {
    try {
      localStorage.setItem('reader:vocabLevel', vocabLevel)
    } catch {
      // 忽略
    }
  }, [vocabLevel])
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

  /** 背单词候选池（按范围过滤：全部 / 本篇 / 未掌握）。 */
  const studyPool = useMemo(() => {
    if (studyScope === 'all') return library.items
    if (studyScope === 'lapses') return library.items.filter((it) => (it.reviewState.lapses ?? 0) > 0)
    if (studyScope === 'unmastered') return library.items.filter((it) => it.status !== 'mastered')
    return library.items.filter(
      (it) =>
        it.source?.fileName === articleIdentity ||
        (doc != null && doc.sentences.some((s) => wordSpans(s.text).some((w) => lemmaOf(w.text) === it.lemma))),
    )
  }, [library.items, studyScope, articleIdentity, doc])

  /** 考试的候选池（范围与背单词类似，但多一个「到期」「错词」）。 */
  const quizPool = useMemo(() => {
    if (quizScope === 'all') return library.items
    if (quizScope === 'due') return library.items.filter((it) => isDue(it))
    if (quizScope === 'lapses') return library.items.filter((it) => (it.reviewState.lapses ?? 0) > 0)
    if (quizScope === 'unmastered') return library.items.filter((it) => it.status !== 'mastered')
    return library.items.filter(
      (it) =>
        it.source?.fileName === articleIdentity ||
        (doc != null && doc.sentences.some((s) => wordSpans(s.text).some((w) => lemmaOf(w.text) === it.lemma))),
    )
  }, [library.items, quizScope, articleIdentity, doc])

  /** 各范围下能出的题数（用于设置面板提示）。 */
  const quizPoolSizes = useMemo(() => {
    const count = (items: VocabItem[]) => buildQuizQuestions(items, quizKinds).length
    return {
      all: count(library.items),
      due: count(library.items.filter((it) => isDue(it))),
      unmastered: count(library.items.filter((it) => it.status !== 'mastered')),
    }
  }, [library.items, quizKinds])

  /** 待复习（已学过且到期）数量——用于「复习」模式的角标。 */
  const dueCount = useMemo(
    () => studyPool.filter((it) => it.reviewState.repetitions > 0 && isDue(it)).length,
    [studyPool],
  )
  /** 未学过的新词数量——用于「新学习」模式的角标。 */
  const newCount = useMemo(
    () => studyPool.filter((it) => it.reviewState.repetitions === 0).length,
    [studyPool],
  )

  /**
   * 当前卡：优先从词库取最新（评分/编辑后立刻反映），
   * 队列里的快照只作兜底（比如词条刚从词库删掉）。
   */
  const studyCard =
    studyQueue && studyIndex < studyQueue.length
      ? (library.items.find((it) => it.id === studyQueue[studyIndex].id) ?? studyQueue[studyIndex])
      : null

  /** 开始背单词：按模式组队（新学习 = 没学过的；复习 = 已学过且到期的）。 */
  const startStudy = useCallback(
    (modeOverride?: StudyMode) => {
      const mode = modeOverride ?? studyMode
      const q =
        mode === 'review'
          ? buildReviewQueue(studyPool, new Date())
          : buildLearnQueue(studyPool, new Date(), { newLimit, newToday })
      if (!q.length) {
        flash(mode === 'review' ? '没有到期的复习词，去「新学习」吧' : '没有待学的新词，去「复习」吧')
        return
      }
      studyRequeueRef.current = new Map()
      studyForgotRef.current = []
      studyBumpedRef.current = new Set()
      setQuizSetupOpen(false)
      setQuizQueue(null)
      setStudyCounts({ know: 0, fuzzy: 0, forgot: 0 })
      setStudyQueue(q)
      setStudyIndex(0)
      setStudyRevealed(false)
      setStudyInput('')
      setStudyChecked(false)
      setStudyEditOpen(false)
      setStudyDraft(null)
      setStudyDelArmed(false)
    },
    [studyPool, studyMode, newLimit, newToday, flash],
  )

  /** 切换模式并立刻按新模式开一轮。 */
  const switchMode = useCallback(
    (m: StudyMode) => {
      setStudyMode(m)
      startStudy(m)
    },
    [startStudy],
  )

  /** 记录今天新引入了一个词（用于每日配额）。 */
  const bumpNewToday = useCallback(() => {
    setNewToday((prev) => {
      const next = prev + 1
      try {
        localStorage.setItem('reader:newToday', JSON.stringify({ day: localDayKey(), count: next }))
      } catch {
        // 忽略
      }
      return next
    })
  }, [])

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

  /** 听力理解题：当前要作答的题（「重做错题」时只含错题） */
  const listenQuestions = useMemo(() => {
    if (!listenQuiz) return []
    if (!listenWrongIds) return listenQuiz.questions
    const set = new Set(listenWrongIds)
    return listenQuiz.questions.filter((q) => set.has(q.id))
  }, [listenQuiz, listenWrongIds])

  const gradeStudy = useCallback(
    (grade: ReviewGrade) => {
      if (!studyQueue) return
      const queued = studyQueue[studyIndex]
      if (!queued) return
      const cur = library.items.find((it) => it.id === queued.id) ?? queued
      const nextLibrary = reviewItem(library, cur.id, grade)
      persist(nextLibrary)
      if (cur.reviewState.repetitions === 0 && !studyBumpedRef.current.has(cur.id)) {
        studyBumpedRef.current.add(cur.id)
        bumpNewToday()
      }
      const nextState = nextLibrary.items.find((it) => it.id === cur.id)?.reviewState
      if (nextState) {
        const label: Record<ReviewGrade, string> = { again: '忘记了', hard: '模糊', good: '认识', easy: '认识' }
        setGradeInfo(`${label[grade]} · 下次复习：${fmtInterval(nextState.interval)}`)
        window.setTimeout(() => setGradeInfo(''), 1600)
      }
      studyFlush(0, 1)
      markStudied(cur.id)
      recordActivity('vocab', 1)
      setStudyCounts((c) =>
        grade === 'again'
          ? { ...c, forgot: c.forgot + 1 }
          : grade === 'hard'
            ? { ...c, fuzzy: c.fuzzy + 1 }
            : { ...c, know: c.know + 1 },
      )
      if (grade === 'again' && !studyForgotRef.current.includes(cur.id)) {
        studyForgotRef.current.push(cur.id)
      }
      // 帮记忆：忘记 / 模糊的词本轮末尾再出现一次（各有上限，避免死循环）
      if (grade === 'again' || grade === 'hard') {
        const used = studyRequeueRef.current.get(cur.id) ?? 0
        const cap = grade === 'again' ? 2 : 1
        if (used < cap) {
          studyRequeueRef.current.set(cur.id, used + 1)
          setStudyQueue((q) => (q ? [...q, cur] : q))
        }
      }
      setStudyRevealed(false)
      setStudyInput('')
      setStudyChecked(false)
      setStudyEditOpen(false)
      setStudyDelArmed(false)
      setStudyIndex((i) => i + 1)
    },
    [studyQueue, studyIndex, library, persist, bumpNewToday, studyFlush, markStudied, recordActivity],
  )

  const closeStudy = useCallback(() => setStudyQueue(null), [])

  /** 打开卡内编辑，带出当前值。 */
  const openStudyEdit = useCallback(() => {
    if (!studyCard) return
    setStudyDraft({
      word: studyCard.word,
      phonetic: studyCard.phonetic ?? '',
      partOfSpeech: studyCard.partOfSpeech ?? '',
      meaning: studyCard.meaning ?? '',
      usage: studyCard.usage.join('；'),
    })
    setStudyEditOpen(true)
    setStudyDelArmed(false)
  }, [studyCard])

  /** 保存卡内编辑（持久化；状态置 edited，之后查词不会再覆盖）。 */
  const saveStudyEdit = useCallback(() => {
    if (!studyCard || !studyDraft) return
    const usage = studyDraft.usage
      .split(/[;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    persist(
      editItem(library, studyCard.id, {
        word: studyDraft.word.trim() || studyCard.word,
        phonetic: studyDraft.phonetic.trim() || null,
        partOfSpeech: studyDraft.partOfSpeech.trim() || null,
        meaning: studyDraft.meaning.trim() || null,
        usage,
      }),
    )
    setStudyEditOpen(false)
    setStudyDraft(null)
    flash('已保存修改')
  }, [studyCard, studyDraft, library, persist, flash])

  /** 卡内删除（两步确认），并从本轮队列里移除。 */
  const studyDelete = useCallback(() => {
    if (!studyCard) return
    if (!studyDelArmed) {
      setStudyDelArmed(true)
      window.setTimeout(() => setStudyDelArmed(false), 3000)
      return
    }
    persist(removeItem(library, studyCard.id))
    const removedBefore = studyQueue
      ? studyQueue.slice(0, studyIndex).filter((it) => it.id === studyCard.id).length
      : 0
    setStudyQueue((q) => (q ? q.filter((it) => it.id !== studyCard.id) : q))
    setStudyIndex((i) => Math.max(0, i - removedBefore))
    setStudyDelArmed(false)
    setStudyEditOpen(false)
    setStudyRevealed(false)
    setStudyInput('')
    setStudyChecked(false)
    flash('已删除')
  }, [studyCard, studyDelArmed, library, persist, studyQueue, studyIndex, flash])

  /** 收尾重练本轮点过「忘记了」的词。 */
  const retryForgot = useCallback(() => {
    const ids = new Set(studyForgotRef.current)
    const items = library.items.filter((it) => ids.has(it.id))
    if (!items.length) return
    studyRequeueRef.current = new Map()
    studyForgotRef.current = []
    studyBumpedRef.current = new Set()
    setStudyCounts({ know: 0, fuzzy: 0, forgot: 0 })
    setStudyQueue(items)
    setStudyIndex(0)
    setStudyRevealed(false)
    setStudyInput('')
    setStudyChecked(false)
    setStudyEditOpen(false)
    setStudyDelArmed(false)
  }, [library.items])

  /** 出题：默认每个单词只考一次、题型随机；可关掉以允许同一词多题型。 */
  const buildQuizSet = useCallback(
    (items: VocabItem[]): QuizQuestion[] => {
      if (!quizUnique) return buildQuizQuestions(items, quizKinds)
      return shuffleQuiz(items)
        .map((it) => {
          for (const k of shuffleQuiz(quizKinds)) {
            const q = makeQuestion(it, k, items)
            if (q) return q
          }
          return null
        })
        .filter((q): q is QuizQuestion => q !== null)
    },
    [quizUnique, quizKinds],
  )

  /** 用当前设置出一份考卷（洗牌 + 限量）。 */
  const startQuiz = useCallback(() => {
    const qs = buildQuizSet(quizPool)
    if (!qs.length) {
      flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
      return
    }
    if (quizAdvanceRef.current) {
      window.clearTimeout(quizAdvanceRef.current)
      quizAdvanceRef.current = null
    }
    const picked = shuffleQuiz(qs).slice(0, quizLimit > 0 ? quizLimit : qs.length)
    setStudyQueue(null)
    setQuizQueue(picked)
    setQuizIndex(0)
    setQuizInput('')
    setQuizChecked(false)
    setQuizResult(null)
    setQuizResults([])
    quizRecordedRef.current = false
    setQuizAutoRun(quizAuto)
    setQuizSetupOpen(false)
  }, [buildQuizSet, quizPool, quizLimit, quizAuto, flash])

  /**
   * 逐句听写。
   *   - 整句模式：长句按「每句词数」切短（听写整句）。
   *   - 填空模式：**不硬切句子**，用整句；一句凑不够空就并下一句，直到够空（最多 3 句 / 60 词）。
   */
  const startDictation = useCallback(
    (opts?: { mode?: 'full' | 'cloze'; words?: number; blanks?: number }) => {
      if (dictAdvanceRef.current) {
        window.clearTimeout(dictAdvanceRef.current)
        dictAdvanceRef.current = null
      }
      if (!doc) {
        flash('先打开一篇文章')
        return
      }
      const mode = opts?.mode ?? dictMode
      const maxWords = opts?.words ?? dictWords
      const blankCount = opts?.blanks ?? dictBlankCount
      if (opts?.words != null) setDictWords(opts.words)
      if (opts?.blanks != null) setDictBlankCount(opts.blanks)

      const pool = libraryLemmasRef.current
      const items: { id: string; text: string }[] = []

      if (mode === 'cloze') {
        // 填空：用整句；不够空就并下一句
        let i = 0
        const sents = doc.sentences
        while (i < sents.length) {
          let text = sents[i].text.trim()
          let j = i + 1
          while (
            j < sents.length &&
            pickBlankTargets(text, pool, blankCount).length < blankCount &&
            j - i < 3 &&
            text.split(/\s+/).length < 60
          ) {
            text = `${text} ${sents[j].text.trim()}`.trim()
            j += 1
          }
          if (pickBlankTargets(text, pool, blankCount).length > 0) {
            items.push({ id: `${sents[i].id}-c`, text })
          }
          i = j
        }
      } else {
        doc.sentences.forEach((s) => {
          splitForDictation(s.text, maxWords).forEach((chunk, ci) => {
            const t = chunk.trim()
            if (t) items.push({ id: `${s.id}-${ci}`, text: t })
          })
        })
      }

      if (!items.length) {
        flash(mode === 'cloze' ? '这篇没有可用于填空的句子' : '这篇没有可听写的句子')
        return
      }
      setDictMode(mode)
      setStudyQueue(null)
      setQuizSetupOpen(false)
      setQuizQueue(null)
      setQuickQueue(null)
      setDictQueue(items)
      setDictIndex(0)
      setDictInput('')
      setDictChecked(false)
      setDictDiff(null)
      setDictBlanks([])
      setDictResults([])
      setDictWrongItems([])
      dictRecordedRef.current = false
    },
    [doc, dictMode, dictWords, dictBlankCount, flash],
  )

  const clearDictAdvance = useCallback(() => {
    if (dictAdvanceRef.current) {
      window.clearTimeout(dictAdvanceRef.current)
      dictAdvanceRef.current = null
    }
  }, [])

  const nextDict = useCallback(() => {
    clearDictAdvance()
    setDictInput('')
    setDictChecked(false)
    setDictDiff(null)
    setDictBlanks([])
    setDictIndex((i) => i + 1)
  }, [clearDictAdvance])

  /** 听写「重练错题」：只重练本轮错的那些段。 */
  const retryDictWrong = useCallback(() => {
    if (!dictWrongItems.length) return
    clearDictAdvance()
    setDictQueue(dictWrongItems)
    setDictIndex(0)
    setDictInput('')
    setDictChecked(false)
    setDictDiff(null)
    setDictBlanks([])
    setDictResults([])
    setDictWrongItems([])
    dictRecordedRef.current = false
  }, [dictWrongItems, clearDictAdvance])

  const checkDict = useCallback(() => {
    if (!dictQueue) return
    const item = dictQueue[dictIndex]
    if (!item) return
    let ok = false
    if (dictMode === 'cloze' && dictClozeRef.current) {
      ok = dictClozeRef.current.blanks.every((b, i) => isClozeBlankCorrect(b, dictBlanks[i] ?? ''))
    } else {
      const diff = diffWords(item.text, dictInput)
      ok = diff.correct
      setDictDiff(diff.tokens)
    }
    setDictChecked(true)
    recordActivity('listen', 1)
    setDictResults((r) => [...r, ok])
    if (!ok) {
      setDictWrongItems((w) => (w.some((x) => x.id === item.id) ? w : [...w, { id: item.id, text: item.text }]))
    }
    // 错题本：听写漏词（对→清掉，错→记上）
    const dictId = dictMistake(item.text, '').id
    if (ok) dropMistake(dictId)
    else addMistake(dictMistake(item.text, new Date().toISOString()))
    // 全对 → 自动下一句；有错 → 停下（显示原文，等你手动下一句）
    if (ok) {
      clearDictAdvance()
      dictAdvanceRef.current = window.setTimeout(() => {
        dictAdvanceRef.current = null
        nextDict()
      }, 700)
    }
  }, [
    dictQueue,
    dictIndex,
    dictInput,
    dictMode,
    dictBlanks,
    recordActivity,
    nextDict,
    clearDictAdvance,
    addMistake,
    dropMistake,
  ])

  const nextQuiz = useCallback(() => {
    if (quizAdvanceRef.current) {
      window.clearTimeout(quizAdvanceRef.current)
      quizAdvanceRef.current = null
    }
    setQuizInput('')
    setQuizChecked(false)
    setQuizResult(null)
    setQuizIndex((i) => i + 1)
  }, [])

  /** 提交本题并判分；对 → SRS good，错 → SRS again（记 lapse）。 */
  const checkQuiz = useCallback(
    (answerOverride?: string) => {
      if (!quizQueue) return
      const q = quizQueue[quizIndex]
      if (!q || quizChecked) return
      const ans = answerOverride ?? quizInput
      const ok = isCorrect(q, ans)
      setQuizChecked(true)
      setQuizResult(ok)
      setQuizResults((r) => [...r, { id: q.id, itemId: q.itemId, correct: ok }])
      if (ok) dropMistake(`vocab:${q.itemId}`)
      else addMistake(vocabMistake(q.itemId, q.word, new Date().toISOString()))
      persist(reviewItem(library, q.itemId, ok ? 'good' : 'again'))
      markStudied(q.itemId)
      recordActivity(q.kind === 'listen' || q.kind === 'ear' ? 'listen' : 'vocab', 1)
      // 答完朗读一下（看词选义读英文单词；其余读答案词形）
      if (quizSpeak) speakRef.current(q.kind === 'meaning' ? q.word : q.answer)
      // 开了「自动下一题」：答对快切、答错稍停（看答案）后自动切
      if (quizAutoRun) {
        if (quizAdvanceRef.current) window.clearTimeout(quizAdvanceRef.current)
        quizAdvanceRef.current = window.setTimeout(() => {
          quizAdvanceRef.current = null
          nextQuiz()
        }, ok ? 650 : 1400)
      }
    },
    [quizQueue, quizIndex, quizChecked, quizInput, library, persist, quizAutoRun, nextQuiz, markStudied, quizSpeak, recordActivity, addMistake, dropMistake],
  )

  /** 关闭考试并清掉待触发的自动切题。 */
  const closeQuiz = useCallback(() => {
    if (quizAdvanceRef.current) {
      window.clearTimeout(quizAdvanceRef.current)
      quizAdvanceRef.current = null
    }
    setQuizQueue(null)
  }, [])

  const retryQuizWrong = useCallback(() => {
    const wrongIds = new Set(quizResults.filter((r) => !r.correct).map((r) => r.itemId))
    const items = library.items.filter((it) => wrongIds.has(it.id))
    const qs = buildQuizSet(items)
    if (!qs.length) {
      flash('没有可重做的错题')
      return
    }
    setQuizQueue(shuffleQuiz(qs))
    setQuizIndex(0)
    setQuizInput('')
    setQuizChecked(false)
    setQuizResult(null)
    setQuizResults([])
    quizRecordedRef.current = false
  }, [quizResults, library.items, buildQuizSet, flash])

  /** 从指定词条开一轮考试（错题本「重练词汇」用）。 */
  const startQuizItems = useCallback(
    (ids: string[]) => {
      const items = library.items.filter((it) => ids.includes(it.id))
      const qs = buildQuizSet(items)
      if (!qs.length) {
        flash('这些词暂时出不了题（缺释义 / 例句）')
        return
      }
      if (quizAdvanceRef.current) {
        window.clearTimeout(quizAdvanceRef.current)
        quizAdvanceRef.current = null
      }
      setStudyQueue(null)
      setQuizQueue(shuffleQuiz(qs))
      setQuizIndex(0)
      setQuizInput('')
      setQuizChecked(false)
      setQuizResult(null)
      setQuizResults([])
      quizRecordedRef.current = false
      setQuizAutoRun(quizAuto)
      setQuizSetupOpen(false)
    },
    [library.items, buildQuizSet, quizAuto, flash],
  )

  /** 用指定题目开一轮听力理解（错题本「重练听力」用）。 */
  const startListenQuestions = useCallback((questions: ListeningQuestion[]) => {
    if (!questions.length) return
    setStudyQueue(null)
    setQuizSetupOpen(false)
    setQuizQueue(null)
    setQuickQueue(null)
    setDictQueue(null)
    setListenQuiz({ questions })
    setListenWrongIds(null)
    setListenAnswers({})
    setListenSubmitted(false)
    setListenResult(null)
    setListenOpen(true)
  }, [])

  /** 用指定片段开一轮听写（错题本「重练听写」用）。 */
  const startDictItems = useCallback((items: { id: string; text: string }[]) => {
    if (!items.length) return
    if (dictAdvanceRef.current) {
      window.clearTimeout(dictAdvanceRef.current)
      dictAdvanceRef.current = null
    }
    setDictMode('full')
    setStudyQueue(null)
    setQuizSetupOpen(false)
    setQuizQueue(null)
    setQuickQueue(null)
    setDictQueue(items)
    setDictIndex(0)
    setDictInput('')
    setDictChecked(false)
    setDictDiff(null)
    setDictBlanks([])
    setDictResults([])
    setDictWrongItems([])
    dictRecordedRef.current = false
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
  const startQuick = useCallback(() => {
    const items = sortItems(studyPool, 'due')
    if (!items.length) {
      flash('这个范围里没有词')
      return
    }
    setStudyQueue(null)
    setQuizSetupOpen(false)
    setQuizQueue(null)
    setQuickQueue(items)
    setQuickIndex(0)
    setQuickRevealed(false)
  }, [studyPool, flash])

  const gradeQuick = useCallback(
    (ok: boolean) => {
      if (!quickQueue) return
      const queued = quickQueue[quickIndex]
      const cur = queued ? (library.items.find((it) => it.id === queued.id) ?? queued) : null
      if (cur) {
        persist(reviewItem(library, cur.id, ok ? 'good' : 'again'))
        markStudied(cur.id)
        recordActivity('vocab', 1)
      }
      setQuickRevealed(false)
      setQuickIndex((i) => i + 1)
    },
    [quickQueue, quickIndex, library, persist, markStudied, recordActivity],
  )

  // 快刷快捷键：1/← 不认识，2/→ 认识，空格看释义，Esc 退出
  useEffect(() => {
    if (!quickQueue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickQueue(null)
        return
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setQuickRevealed(true)
        return
      }
      if (quickIndex >= quickQueue.length) return
      if (e.key === 'ArrowLeft' || e.key === '1') {
        e.preventDefault()
        gradeQuick(false)
      } else if (e.key === 'ArrowRight' || e.key === '2') {
        e.preventDefault()
        gradeQuick(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quickQueue, quickIndex, gradeQuick])

  // 听写快捷键：回车 检查 / 下一句，Tab 重听，Esc 退出
  useEffect(() => {
    if (!dictQueue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearDictAdvance()
        setDictQueue(null)
        return
      }
      if (e.key === 'Tab') {
        const t = e.target as HTMLElement | null
        // 填空模式里有多个输入框，Tab 要用来切换输入框，别抢
        if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) {
          e.preventDefault()
          const s = dictQueue[dictIndex]
          if (s) speakRef.current(s.text)
        }
        return
      }
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (dictIndex >= dictQueue.length) return
      if (!dictChecked) checkDict()
      else nextDict()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dictQueue, dictIndex, dictChecked, checkDict, nextDict, clearDictAdvance])

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

  // 背单词快捷键：空格/回车 翻面/判卷/认识，1/2/3 = 认识/模糊/忘记了，Esc 退出
  useEffect(() => {
    if (!studyQueue || studyEditOpen) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const canGrade = studySpelling ? studyChecked : studyRevealed
      const gradeKeys: Record<string, ReviewGrade> = { '1': 'good', '2': 'hard', '3': 'again' }
      // 拼写模式下输入框还 focus 着；判卷后仍要能用 1/2/3 评分
      if (inField) {
        if (canGrade && gradeKeys[e.key]) {
          e.preventDefault()
          gradeStudy(gradeKeys[e.key])
        }
        return
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (studyIndex >= studyQueue.length) return
        if (!canGrade) {
          if (studySpelling) setStudyChecked(true)
          else setStudyRevealed(true)
          return
        }
        gradeStudy('good')
      } else if (gradeKeys[e.key]) {
        if (canGrade) gradeStudy(gradeKeys[e.key])
      } else if (e.key === 'Escape') closeStudy()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studyQueue, studyEditOpen, studyIndex, studyRevealed, studySpelling, studyChecked, gradeStudy, closeStudy])

  // 单卡计时：换卡归零，每秒 +1（催你快点，别墨迹）
  useEffect(() => {
    if (!studyQueue) return
    setCardSeconds(0)
    const id = window.setInterval(() => setCardSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [studyQueue, studyIndex])

  // 本轮背单词总时长：进场清零，每秒 +1；每 15s 落盘一次，退出时补落盘
  useEffect(() => {
    if (!studyQueue) return
    studyLiveRef.current = 0
    studyFlushedRef.current = 0
    setStudyLive(0)
    const id = window.setInterval(() => {
      studyLiveRef.current += 1
      setStudyLive(studyLiveRef.current)
      const unflushed = studyLiveRef.current - studyFlushedRef.current
      if (unflushed >= 15) {
        studyFlush(unflushed, 0)
        studyFlushedRef.current = studyLiveRef.current
      }
    }, 1000)
    return () => {
      window.clearInterval(id)
      const unflushed = studyLiveRef.current - studyFlushedRef.current
      if (unflushed > 0) {
        studyFlush(unflushed, 0)
        studyFlushedRef.current = studyLiveRef.current
      }
    }
  }, [studyQueue, studyFlush])

  // 考试计时：开考清零，每秒 +1
  useEffect(() => {
    if (!quizQueue) return
    setQuizSeconds(0)
    const id = window.setInterval(() => setQuizSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [quizQueue])

  // 换题后把焦点送回输入框，方便直接打字（词形辨析是点选项，不聚焦）
  useEffect(() => {
    const q = quizQueue && quizIndex < quizQueue.length ? quizQueue[quizIndex] : null
    if (q && q.kind !== 'choice' && q.kind !== 'meaning' && !quizChecked) quizInputRef.current?.focus()
  }, [quizQueue, quizIndex, quizChecked])

  // 考试快捷键：回车 提交 / 下一题；词形辨析可用 1/2/3 选选项；Esc 退出
  useEffect(() => {
    if (!quizQueue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeQuiz()
        return
      }
      const q = quizQueue[quizIndex]
      if (e.key === 'Enter') {
        e.preventDefault()
        if (quizIndex >= quizQueue.length) return
        if (!quizChecked) checkQuiz()
        else nextQuiz()
        return
      }
      if ((q?.kind === 'choice' || q?.kind === 'meaning') && !quizChecked && q.options) {
        const n = Number(e.key)
        if (n >= 1 && n <= q.options.length) {
          e.preventDefault()
          const opt = q.options[n - 1]
          setQuizInput(opt)
          checkQuiz(opt)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quizQueue, quizIndex, quizChecked, checkQuiz, nextQuiz, closeQuiz])

  // 组件卸载时清掉待触发的自动切题
  useEffect(() => {
    return () => {
      if (quizAdvanceRef.current) window.clearTimeout(quizAdvanceRef.current)
    }
  }, [])

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
  const copyListeningPrompt = useCallback(async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const text = doc.sentences.map((s) => s.text).join(' ')
    setLastTask('listening')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(buildListeningQuizPrompt(text, { count: listenCount }))
      flash('已复制听力理解题提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [doc, listenCount, flash])

  /** 打开听力理解题：没有题目就先复制出题提示词。 */
  const openListening = useCallback(() => {
    if (listenQuiz && listenQuiz.questions.length) {
      setStudyQueue(null)
      setQuizSetupOpen(false)
      setQuizQueue(null)
      setQuickQueue(null)
      setDictQueue(null)
      setListenAnswers({})
      setListenSubmitted(false)
      setListenResult(null)
      setListenWrongIds(null)
      setListenOpen(true)
    } else {
      void copyListeningPrompt()
    }
  }, [listenQuiz, copyListeningPrompt])

  const submitListening = useCallback(() => {
    if (!listenQuestions.length) return
    const res = gradeListening(listenQuestions, listenAnswers)
    setListenResult(res)
    setListenSubmitted(true)
    recordActivity('listen', listenQuestions.length)
    recordPractice('listening', res.total, res.correct)
    // 错题本：听力错题（对→清掉，错→记上）
    for (const q of listenQuestions) {
      const id = listenMistake(articleIdentity, q, '').id
      if (isListeningCorrect(q, listenAnswers[q.id] ?? '')) dropMistake(id)
      else addMistake(listenMistake(articleIdentity, q, new Date().toISOString()))
    }
  }, [
    listenQuestions,
    listenAnswers,
    recordActivity,
    recordPractice,
    articleIdentity,
    addMistake,
    dropMistake,
  ])

  /** 听力理解题：只重做错题。 */
  const retryListenWrong = useCallback(() => {
    if (!listenResult) return
    const ids = listenResult.per.filter((p) => !p.correct).map((p) => p.id)
    if (!ids.length) return
    setListenWrongIds(ids)
    setListenAnswers({})
    setListenSubmitted(false)
    setListenResult(null)
  }, [listenResult])

  /** 听力理解题：恢复全部题。 */
  const showAllListen = useCallback(() => {
    setListenWrongIds(null)
    setListenAnswers({})
    setListenSubmitted(false)
    setListenResult(null)
  }, [])

  /** 复制逐句语言点分析提示词。 */
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

  /** 打开仿写训练（范句默认用当前选中句）。 */
  const openWriting = useCallback(() => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const start = doc.sentences.find((s) => s.id === selectedId) ?? doc.sentences[0]
    setStudyQueue(null)
    setQuizSetupOpen(false)
    setQuizQueue(null)
    setQuickQueue(null)
    setDictQueue(null)
    setListenOpen(false)
    setWritingOpen(true)
    setWritingModel(start.text)
    setWritingTask(null)
    setWritingText('')
    setWritingFeedback(null)
  }, [doc, selectedId, flash])

  const copyImitationTask = useCallback(async () => {
    const model = writingModel.trim()
    if (!model) {
      flash('先选一句范句')
      return
    }
    const s = doc?.sentences.find((x) => x.text === model)
    setLastTask('imitation')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildImitationTaskPrompt({ model, structure: s?.language?.structure, mustUse: s?.language?.phrases }),
      )
      flash('已复制仿写任务提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [writingModel, doc, flash])

  const copyFeedback = useCallback(async () => {
    if (!writingTask) {
      flash('先生成仿写任务')
      return
    }
    if (!writingText.trim()) {
      flash('先写点东西再批改')
      return
    }
    setLastTask('feedback')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(buildWritingFeedbackPrompt(writingTask, writingText))
      flash('已复制批改提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [writingTask, writingText, flash])

  /** 载入一条历史记录回看。 */
  const loadWritingRecord = useCallback((rec: WritingRecord) => {
    setWritingModel(rec.model)
    setWritingText(rec.text)
    setWritingFeedback(rec.feedback)
    setWritingTask(rec.task ?? null)
    setHistoryOpen(false)
  }, [])

  /** 记一次选词模式会话（存本机 localStorage，最多留 500 条）。 */
  const recordSession = useCallback((seconds: number, picked: number) => {
    if (seconds < 1 && picked === 0) return
    setSessions((prev) => {
      const next = [...prev, { at: new Date().toISOString(), seconds, picked }].slice(-500)
      try {
        localStorage.setItem('reader:vocabStats', JSON.stringify(next))
      } catch {
        // 忽略
      }
      return next
    })
  }, [])

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

  const totals = useMemo(
    () =>
      sessions.reduce(
        (a, s) => ({ seconds: a.seconds + s.seconds, picked: a.picked + s.picked }),
        { seconds: 0, picked: 0 },
      ),
    [sessions],
  )

  /** 背单词时长统计：累计 / 今日 / 评分次数；显示时加上本轮尚未落盘的部分。 */
  const studyTotalSeconds = useMemo(() => studyDays.reduce((a, d) => a + d.seconds, 0), [studyDays])
  const studyTotalCards = useMemo(() => studyDays.reduce((a, d) => a + d.cards, 0), [studyDays])
  const studyTodaySeconds = useMemo(() => {
    const d = studyDays.find((x) => x.day === localDayKey())
    return d?.seconds ?? 0
  }, [studyDays])
  const studyGrandSeconds = studyTotalSeconds + Math.max(0, studyLive - studyFlushedRef.current)

  /** 按天统计：今天选了多少 + 连续打卡天数。 */
  const dayStats = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const byDay = new Map<string, number>()
    for (const s of sessions) {
      const k = key(new Date(s.at))
      byDay.set(k, (byDay.get(k) ?? 0) + s.picked)
    }
    const now = new Date()
    const todayKey = key(now)
    const cursor = new Date(now)
    if (!byDay.has(todayKey)) cursor.setDate(cursor.getDate() - 1)
    let streak = 0
    while (byDay.has(key(cursor))) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return { todayPicked: byDay.get(todayKey) ?? 0, streak }
  }, [sessions])

  /** 最近 7 天每天选了多少词（统计面板用）。 */
  const last7 = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const byDay = new Map<string, number>()
    for (const s of sessions) {
      const k = key(new Date(s.at))
      byDay.set(k, (byDay.get(k) ?? 0) + s.picked)
    }
    const out: { key: string; label: string; picked: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const k = key(d)
      out.push({ key: k, label: String(d.getDate()), picked: byDay.get(k) ?? 0 })
    }
    return out
  }, [sessions])

  /** 未来 30 天每天的到期词数（到期日历热力图用）。 */
  const dueForecast = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const byDay = new Map<string, number>()
    for (const it of library.items) {
      if (!it.reviewState.due) continue
      const k = key(new Date(it.reviewState.due))
      byDay.set(k, (byDay.get(k) ?? 0) + 1)
    }
    const out: { key: string; label: string; count: number }[] = []
    for (let i = 0; i < 30; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      const k = key(d)
      out.push({ key: k, label: i === 0 ? '今天' : String(d.getDate()), count: byDay.get(k) ?? 0 })
    }
    return out
  }, [library.items])

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
  const byArticle = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of library.items) {
      const k = it.source?.articleId || '未标来源'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [library.items])

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

  // 供更早的回调（如 startDictation）读取，避开声明顺序
  useEffect(() => {
    libraryLemmasRef.current = libraryLemmas
  }, [libraryLemmas])

  /** 听写·填空模式：当前短块的挖空题（每块稳定，不随重渲染乱跳）。 */
  const dictCloze = useMemo(() => {
    if (dictMode !== 'cloze' || !dictQueue || dictIndex >= dictQueue.length) return null
    const text = dictQueue[dictIndex].text
    return makeCloze(text, pickBlankTargets(text, libraryLemmas, dictBlankCount))
  }, [dictMode, dictQueue, dictIndex, libraryLemmas, dictBlankCount])

  // 换题后把焦点送回输入框（autoFocus 只首次生效，换题必须手动聚焦）
  useEffect(() => {
    if (!dictQueue || dictIndex >= dictQueue.length || dictChecked) return
    if (dictMode === 'cloze' && dictCloze) dictFirstBlankRef.current?.focus()
    else dictInputRef.current?.focus()
  }, [dictQueue, dictIndex, dictChecked, dictMode, dictCloze])

  // 把当前填空存进 ref，供 checkDict 判分（checkDict 定义更早，不能直接引用 dictCloze）
  useEffect(() => {
    dictClozeRef.current = dictCloze
  }, [dictCloze])

  // 填空模式下万一遇到「没空可填」的题，自动跳过（理论上 startDictation 已过滤）
  useEffect(() => {
    if (!dictQueue || dictIndex >= dictQueue.length) return
    if (dictMode === 'cloze' && (!dictCloze || dictCloze.blanks.length === 0)) nextDict()
  }, [dictQueue, dictIndex, dictMode, dictCloze, nextDict])

  // 听写完成 → 记一次成绩
  useEffect(() => {
    if (!dictQueue) return
    if (dictIndex >= dictQueue.length && dictResults.length > 0 && !dictRecordedRef.current) {
      dictRecordedRef.current = true
      recordPractice('dictation', dictResults.length, dictResults.filter(Boolean).length)
    }
  }, [dictQueue, dictIndex, dictResults, recordPractice])

  // 考试完成 → 记一次成绩
  useEffect(() => {
    if (!quizQueue) {
      quizRecordedRef.current = false
      return
    }
    if (quizIndex >= quizQueue.length && quizResults.length > 0 && !quizRecordedRef.current) {
      quizRecordedRef.current = true
      recordPractice('quiz', quizResults.length, quizResults.filter((r) => r.correct).length)
    }
  }, [quizQueue, quizIndex, quizResults, recordPractice])

  // 卸载时清掉「自动下一句」的定时器
  useEffect(() => {
    return () => {
      if (dictAdvanceRef.current) window.clearTimeout(dictAdvanceRef.current)
    }
  }, [])

  /** 把本句漏写 / 填错的词加入待选，之后统一查词。 */
  const dictWrongNow = useCallback(() => {
    if (!dictQueue) return
    const item = dictQueue[dictIndex]
    if (!item) return
    let words: string[] = []
    if (dictMode === 'cloze' && dictCloze) {
      words = dictCloze.blanks
        .filter((b, i) => !isClozeBlankCorrect(b, dictBlanks[i] ?? ''))
        .map((b) => b.answer)
    } else {
      words = dictationWrongWords(diffWords(item.text, dictInput))
    }
    if (!words.length) {
      flash('没有漏写 / 填错的词')
      return
    }
    mergeBatch(batchItemsFromWords(words))
    flash(`已把 ${words.length} 个词加入待选`)
  }, [dictQueue, dictIndex, dictMode, dictCloze, dictBlanks, dictInput, mergeBatch, batchItemsFromWords, flash])

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
      .filter(
        (s) =>
          batchSids.has(s.id) ||
          wordSpans(s.text).some(
            (w) => activeLemmas.has(w.text.toLowerCase()) || activeLemmas.has(lemmaOf(w.text)),
          ),
      )
      .map((s) => s.id)
  }, [doc, activeLemmas, batch])
  const vocabSidSet = useMemo(() => new Set(vocabSids), [vocabSids])

  /** 浏览器 TTS：只读一遍，不循环；同一句正在读时不重开。 */
  const speak = useCallback((text: string) => {
    readAllRef.current = false
    setReadingAll(false)
    try {
      if (typeof speechSynthesis === 'undefined') return
      const t = text.trim()
      if (!t) return
      // 同一句正在读就别重开（避免重复 / 叠读）
      if (speechSynthesis.speaking && utterRef.current && utterRef.current.text === t) return
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'en-US'
      u.onend = () => {
        if (utterRef.current === u) utterRef.current = null
      }
      utterRef.current = u // 持有引用，避免被 GC 导致中断/重读
      speechSynthesis.speak(u)
    } catch {
      // 忽略
    }
  }, [])

  /** 停止「朗读全文」。 */
  const stopReadAll = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    } catch {
      // 忽略
    }
  }, [])

  /** 逐句朗读整篇（TTS）；再点一次停止。 */
  const startReadAll = useCallback(() => {
    if (!doc) return
    stopReadAll()
    const list = doc.sentences.filter((s) => s.text.trim())
    if (!list.length) return
    readAllRef.current = true
    setReadingAll(true)
    let i = 0
    const next = () => {
      if (!readAllRef.current || i >= list.length) {
        readAllRef.current = false
        setReadingAll(false)
        return
      }
      const s = list[i++]
      try {
        const u = new SpeechSynthesisUtterance(s.text)
        u.lang = 'en-US'
        u.rate = 0.95
        u.onend = () => next()
        u.onerror = () => next()
        utterRef.current = u
        speechSynthesis.speak(u)
      } catch {
        readAllRef.current = false
        setReadingAll(false)
      }
    }
    next()
  }, [doc, stopReadAll])

  // 选中句子后自动朗读（可选）
  useEffect(() => {
    if (!autoSpeak || !selectedId || !doc) return
    if (lastSpokenRef.current === selectedId) return
    lastSpokenRef.current = selectedId
    const s = doc.sentences.find((x) => x.id === selectedId)
    if (s && s.text.trim()) speak(s.text)
  }, [selectedId, autoSpeak, doc, speak])

  // 把 speak 存到 ref，供定义更早的回调（如 checkQuiz）调用
  useEffect(() => {
    speakRef.current = speak
  }, [speak])

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
  const selectSentence = useCallback(
    (sid: string) => {
      if (selectedId === sid) {
        try {
          if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
        } catch {
          // 忽略
        }
        lastSpokenRef.current = null
        return
      }
      setSelectedId(sid)
    },
    [selectedId],
  )

  /** 点正文里的生词 → 高亮并滚到生词本对应词条。 */
  const focusEntry = useCallback((word: string) => {
    const key = lemmaOf(word)
    setFocusLemma(key)
    window.requestAnimationFrame(() => {
      sideRef.current
        ?.querySelector(`[data-lemma="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [])

  /** 滚到某一句（优先滚可见的那个—「只看译文」时英文是隐藏的）。 */
  const scrollToSid = useCallback((sid: string) => {
    const nodes = articleRef.current?.querySelectorAll(`[data-sid="${CSS.escape(sid)}"]`)
    const el = nodes ? ([...nodes] as HTMLElement[]).find((e) => e.offsetParent !== null) : undefined
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  /** 点生词本词条 → 回原文定位（优先用来源句，没有就在当前正文里搜；找到后回填来源）。 */
  const jumpToSource = useCallback(
    (item: VocabItem) => {
      if (!doc) return
      let sid =
        item.source?.fileName === articleIdentity && item.source.sentenceId ? item.source.sentenceId : null
      if (sid && !doc.sentences.some((s) => s.id === sid)) sid = null
      let hit = sid ? doc.sentences.find((s) => s.id === sid) : undefined
      if (!hit) {
        hit = doc.sentences.find((s) =>
          wordSpans(s.text).some(
            (w) => w.text.toLowerCase() === item.word.toLowerCase() || lemmaOf(w.text) === item.lemma,
          ),
        )
        sid = hit?.id ?? null
      }
      if (!hit || !sid) {
        flash('当前这篇里找不到这个词')
        return
      }
      // 回填来源，下次直接跳、也让 A/D 与来源更准
      if (!item.source || item.source.sentenceId !== sid) {
        persist({
          ...library,
          items: library.items.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  source: {
                    articleId: articleTitle || articleKey || '手动粘贴',
                    fileName: articleKey,
                    sentenceId: sid,
                    sentenceText: hit!.text,
                  },
                }
              : it,
          ),
        })
      }
      setPeekSid(sid)
      window.requestAnimationFrame(() => scrollToSid(sid))
    },
    [doc, articleIdentity, articleTitle, library, persist, flash, scrollToSid],
  )

  /** A/D：在所有句子间上/下移动，临时浮动高亮作为提示并滚到中间（选词模式游标）。 */
  const navigateVocab = useCallback(
    (dir: 1 | -1) => {
      if (!doc || !doc.sentences.length) return
      const sids = doc.sentences.map((s) => s.id)
      const cur = peekSid ?? selectedId
      let idx = cur ? sids.indexOf(cur) : -1
      idx = idx < 0 ? (dir === 1 ? 0 : sids.length - 1) : (idx + dir + sids.length) % sids.length
      const sid = sids[idx]
      setPeekSid(sid)
      window.requestAnimationFrame(() => scrollToSid(sid))
    },
    [doc, peekSid, selectedId, scrollToSid],
  )
  toggleVocabRef.current = toggleVocabMode
  navVocabRef.current = navigateVocab

  // 最近选中的词 → 气泡位置（贴在所在句上方）
  useEffect(() => {
    if (!lastPicked) {
      setBubblePos(null)
      return
    }
    const nodes = articleRef.current?.querySelectorAll(`[data-sid="${CSS.escape(lastPicked.sid)}"]`)
    const el = nodes ? ([...nodes] as HTMLElement[]).find((e) => e.offsetParent !== null) : undefined
    if (!el) {
      setBubblePos(null)
      return
    }
    setBubblePos({ top: el.offsetTop - 4, left: el.offsetLeft })
  }, [lastPicked, doc, fontSize, bold, serif])

  const remember = useCallback((key: string | null, id: string | null) => {
    try {
      localStorage.setItem('reader:last', JSON.stringify({ key, id }))
    } catch {
      // 隐私模式忽略
    }
  }, [])

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

  const loadText = useCallback(
    (key: string | null, text: string, title: string, id: string | null) => {
      const cleaned = cleanText(text)
      setDoc(segment(cleaned))
      setSourceText(cleaned)
      setEditing(false)
      resetSelection()
      setArticleKey(key)
      setArticleTitle(title)
      setArticleBook('')
      setSavedId(id)
      setBatch(batchMapRef.current[key ?? id ?? title] ?? [])
    },
    [resetSelection],
  )

  /** 打开一篇已保存的文章（保留上次粘回的翻译/语法）。 */
  const loadSaved = useCallback(
    (a: SavedArticle) => {
      setDoc({ paragraphs: a.paragraphs, sentences: a.sentences })
      setSourceText(a.text || reconstructText(a))
      setEditing(false)
      resetSelection()
      setArticleKey(a.sourceKey)
      setArticleTitle(a.title)
      setArticleBook(a.book ?? '')
      setSavedId(a.id)
      setBatch(batchMapRef.current[a.sourceKey ?? a.id ?? a.title] ?? [])
      remember(a.sourceKey, a.id)
    },
    [resetSelection, remember],
  )

  /** 从内置原文库打开：保存过就优先用保存的版本（含改动）。 */
  const loadFromBook = useCallback(
    (key: string) => {
      const existing = saved.find((a) => a.sourceKey === key)
      if (existing) {
        loadSaved(existing)
        return
      }
      const text = book?.[key]?.text
      if (text == null) return
      loadText(key, text, book?.[key]?.title ?? key, null)
      remember(key, null)
    },
    [saved, book, loadSaved, loadText, remember],
  )

  /** 把当前这篇文章（含粘回的翻译/语法）存到本机。 */
  const saveCurrent = useCallback(async () => {
    if (!doc) {
      flash('先打开或粘一篇文章')
      return
    }
    const id = savedId ?? (articleKey ? `saved:${articleKey}` : `saved:${Date.now()}`)
    let title = articleTitle
    if (!savedId && !title) {
      title = window.prompt('给这篇文章起个名字', articleKey ?? '未命名') || '未命名'
    }
    const article: SavedArticle = {
      id,
      title: title || '未命名',
      book: articleBook || undefined,
      sourceKey: articleKey,
      text: sourceText,
      paragraphs: doc.paragraphs,
      sentences: doc.sentences,
      updatedAt: new Date().toISOString(),
    }
    await articles.current?.save(article)
    setSaved((await articles.current?.list()) ?? [])
    setSavedId(id)
    setArticleTitle(article.title)
    setArticleBook(article.book ?? '')
    remember(articleKey, id)
    flash('已保存到本机')
  }, [doc, savedId, articleKey, articleTitle, articleBook, sourceText, remember, flash])

  const deleteSaved = useCallback(async () => {
    if (!savedId) return
    await articles.current?.remove(savedId)
    setSaved((await articles.current?.list()) ?? [])
    setSavedId(null)
    flash('已删除保存；正文还在，可重新保存')
  }, [savedId, flash])

  /** 「删除保存」两步确认，防误删。 */
  const askDeleteSave = useCallback(() => {
    if (confirmDelSave) {
      setConfirmDelSave(false)
      if (saveDelTimerRef.current) window.clearTimeout(saveDelTimerRef.current)
      void deleteSaved()
      return
    }
    setConfirmDelSave(true)
    if (saveDelTimerRef.current) window.clearTimeout(saveDelTimerRef.current)
    saveDelTimerRef.current = window.setTimeout(() => setConfirmDelSave(false), 3000)
  }, [confirmDelSave, deleteSaved])

  /** 改文章标题（已保存的同步存库）。 */
  const renameArticle = useCallback(async () => {
    const next = window.prompt('修改文章标题', articleTitle || articleKey || '')
    if (next === null) return
    const title = next.trim()
    if (!title) return
    setArticleTitle(title)
    if (savedId && doc) {
      const id = savedId
      await articles.current?.save({
        id,
        title,
        book: articleBook || undefined,
        sourceKey: articleKey,
        text: sourceText,
        paragraphs: doc.paragraphs,
        sentences: doc.sentences,
        updatedAt: new Date().toISOString(),
      })
      setSaved((await articles.current?.list()) ?? [])
    }
    flash('已修改标题')
  }, [articleTitle, articleKey, articleBook, savedId, doc, sourceText, flash])

  /** 新建一篇文章：清洗 + 切句 + 直接存进「已保存」。 */
  const createArticle = useCallback(async () => {
    if (!manual.trim()) return
    const title = newTitle.trim() || '未命名'
    const cleaned = cleanText(manual)
    const seg = segment(cleaned)
    const article: SavedArticle = {
      id: `saved:${Date.now()}`,
      title,
      book: newBook.trim() || undefined,
      sourceKey: null,
      text: cleaned,
      paragraphs: seg.paragraphs,
      sentences: seg.sentences,
      updatedAt: new Date().toISOString(),
    }
    await articles.current?.save(article)
    setSaved((await articles.current?.list()) ?? [])
    loadSaved(article)
    setComposing(false)
    setManual('')
    setNewTitle('')
    setNewBook('')
    flash('已新建文章')
  }, [manual, newTitle, newBook, loadSaved, flash])

  /** 从 .txt/.md 导入：一个文件=一篇；多选就是多篇。 */
  /** 复制清洗提示词：让 AI 去掉复制文本的多余换行、粘连和错误。next 是拿到结果后该做什么。 */
  const copyCleanupPrompt = useCallback(
    async (text: string, next: string) => {
      if (!text.trim()) return
      try {
        await navigator.clipboard.writeText(buildCleanupPrompt(text))
        flash(`已复制；去 AI 粘贴，把结果贴回来再${next}`)
      } catch {
        flash('复制失败：浏览器需要 localhost 或 https')
      }
    },
    [flash],
  )

  const onImportFiles = useCallback(
    async (files: FileList | null) => {
      const list = Array.from(files ?? [])
      if (!list.length) return
      const read = (f: File) =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result ?? ''))
          r.onerror = () => reject(r.error)
          r.readAsText(f)
        })
      const texts = await Promise.all(list.map(read))
      if (list.length === 1) {
        setManual(texts[0])
        setNewTitle(list[0].name.replace(/\.[^.]+$/, ''))
        setComposing(true)
        flash('已读入，确认后点「创建文章」')
        return
      }
      const now = Date.now()
      for (let i = 0; i < list.length; i++) {
        const cleaned = cleanText(texts[i])
        const seg = segment(cleaned)
        await articles.current?.save({
          id: `saved:${now}:${i}`,
          title: list[i].name.replace(/\.[^.]+$/, '') || `第 ${i + 1} 篇`,
          book: newBook.trim() || undefined,
          sourceKey: null,
          text: cleaned,
          paragraphs: seg.paragraphs,
          sentences: seg.sentences,
          updatedAt: new Date().toISOString(),
        })
      }
      setSaved((await articles.current?.list()) ?? [])
      flash(`已导入 ${list.length} 篇`)
    },
    [newBook, flash],
  )

  /** 浏览器内解析 PDF → 填入 composer，人工确认后创建。 */
  const onPickPdf = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      setImporting('正在解析 PDF…')
      try {
        const text = await extractPdfText(file, pdfRange)
        setManual(text)
        setNewTitle(file.name.replace(/\.[^.]+$/, ''))
        setComposing(true)
        flash('PDF 已解析，检查正文后点「创建文章」')
      } catch {
        flash('PDF 解析失败（可能是扫描件，没有文字层）')
      } finally {
        setImporting('')
      }
    },
    [pdfRange, flash],
  )

  /** 浏览器内解析 EPUB：按章拆成多篇，标题形如「书名 · 章节」。 */
  const onPickEpub = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      setImporting('正在解析 EPUB…')
      try {
        const chapters = await extractEpub(file)
        if (!chapters.length) {
          flash('EPUB 里没读到文本')
          return
        }
        const book = file.name.replace(/\.[^.]+$/, '')
        const now = Date.now()
        for (let i = 0; i < chapters.length; i++) {
          const cleaned = cleanText(chapters[i].text)
          const seg = segment(cleaned)
          await articles.current?.save({
            id: `saved:${now}:${i}`,
            title: `${book} · ${chapters[i].title || `第 ${i + 1} 章`}`,
            book,
            sourceKey: null,
            text: cleaned,
            paragraphs: seg.paragraphs,
            sentences: seg.sentences,
            updatedAt: new Date().toISOString(),
          })
        }
        setSaved((await articles.current?.list()) ?? [])
        flash(`已导入《${book}》共 ${chapters.length} 章`)
      } catch {
        flash('EPUB 解析失败')
      } finally {
        setImporting('')
      }
    },
    [flash],
  )
  const enterEdit = useCallback(() => {
    if (!doc) return
    setDraft(sourceText)
    setEditing(true)
  }, [doc, sourceText])

  /** 完成编辑：重新切句，并按句文把已粘回的分析搬过来。 */
  const applyEdit = useCallback(() => {
    const cleaned = cleanText(draft)
    const next = segment(cleaned)
    const sentences = carryAnalysis(doc?.sentences ?? [], next.sentences)
    setDoc({ paragraphs: next.paragraphs, sentences })
    setSourceText(cleaned)
    setEditing(false)
    setPendingSave(true)
    flash('已应用修改（已粘回的分析按句保留）')
  }, [draft, doc, flash])

  const cancelEdit = useCallback(() => setEditing(false), [])

  // 已保存的文章，改动后自动落盘（翻译/语法粘回后不丢）
  useEffect(() => {
    if (!savedId || !doc) return
    const t = window.setTimeout(() => void saveCurrent(), 900)
    return () => window.clearTimeout(t)
  }, [doc, savedId, saveCurrent])

  // 应用结果 / 编辑正文后：没有保存记录就立即建一条，之后照旧自动存
  useEffect(() => {
    if (!pendingSave || !doc) return
    setPendingSave(false)
    void saveCurrent()
  }, [pendingSave, doc, saveCurrent])

  // 启动后恢复「上次打开的文章」
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    if (!book && saved.length === 0) return
    let last: { key: string | null; id: string | null } | null = null
    try {
      last = JSON.parse(localStorage.getItem('reader:last') ?? 'null')
    } catch {
      last = null
    }
    restored.current = true
    if (!last) return
    if (last.id) {
      const a = saved.find((x) => x.id === last.id)
      if (a) {
        loadSaved(a)
        return
      }
    }
    if (last.key && book?.[last.key]) loadFromBook(last.key)
  }, [book, saved, loadSaved, loadFromBook])

  const currentValue = savedId ? `s:${savedId}` : articleKey ? `b:${articleKey}` : ''
  const onPick = useCallback(
    (value: string) => {
      if (value.startsWith('b:')) loadFromBook(value.slice(2))
      else if (value.startsWith('s:')) {
        const a = saved.find((x) => x.id === value.slice(2))
        if (a) loadSaved(a)
      }
    },
    [loadFromBook, loadSaved, saved],
  )

  const bookKeys = useMemo(() => (book ? Object.keys(book).sort() : []), [book])
  const editions = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of bookKeys) {
      const e = editionOf(k)
      m.set(e, (m.get(e) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [bookKeys])
  const shownKeys = useMemo(
    () => bookKeys.filter((k) => edition === '全部' || editionOf(k) === edition),
    [bookKeys, edition],
  )

  /** 让原生选区消失（改用我们的圆角 .hl 高亮）。 */
  const clearDomSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel) return
    applyingDom.current = true
    sel.removeAllRanges()
    window.requestAnimationFrame(() => {
      applyingDom.current = false
    })
  }, [])

  /** 字符区间 [start,end) 覆盖了这句话的第几到第几个词。 */
  const wordIndexRange = useCallback((text: string, start: number, end: number) => {
    const spans = wordSpans(text)
    const first = spans.findIndex((w) => w.end > start)
    if (first < 0) return null
    let last = first
    for (let i = spans.length - 1; i >= 0; i--) {
      if (spans[i].start < end) {
        last = i
        break
      }
    }
    return { start: first, end: last + 1 }
  }, [])

  /**
   * 读取当前选区。
   *   - Ctrl：只选**一个词**
   *   - 不按 Ctrl + 单击：**整句**
   *   - 不按 Ctrl + 拖动：按**整词吸附**
   * finalize=true（松手）时清掉原生选区，改用能加圆角的 .hl。
   */
  const applySelection = useCallback(
    (ctrl: boolean, finalize: boolean) => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const span = sentSpanOf(range.startContainer) ?? sentSpanOf(range.endContainer)
      if (!span) return
      const sid = span.dataset.sid ?? null
      if (sid) setSelectedId(sid)
      setPeekSid(null)

      const text = span.textContent ?? ''
      const a = offsetIn(span, range.startContainer, range.startOffset)
      const b = offsetIn(span, range.endContainer, range.endOffset)
      if (a == null || b == null) return
      const sentenceText = text.trim()
      const spans = wordSpans(text)

      /** 设精确选区（离散词下标）；vocabMode 加进待选时清空精确选区（避免两处重复）。 */
      const commitSel = (indices: number[], batchWord?: string) => {
        const uniq = [...new Set(indices)].sort((x, y) => x - y)
        if (finalize && vocabMode && sid && batchWord) {
          setSelSid(null)
          setSelIndices([])
          setExact('')
          setUseExact(false)
          const already = batch.some((x) => lemmaOf(x.word) === lemmaOf(batchWord))
          addToBatch([batchWord], sentenceText, sid)
          if (!already) sessionPickedRef.current += 1
          setLastPicked({ word: batchWord, sid })
        } else {
          setSelSid(sid)
          setSelIndices(uniq)
          setExact(uniq.map((i) => spans[i].text).join(' '))
          setUseExact(uniq.length > 0)
        }
        if (finalize) clearDomSelection()
      }

      const indicesInRange = (startChar: number, endChar: number): number[] => {
        const r = wordIndexRange(text, startChar, endChar)
        const out: number[] = []
        if (r) for (let i = r.start; i < r.end; i++) out.push(i)
        return out
      }

      const idxAt = (offset: number) => spans.findIndex((w) => offset >= w.start && offset < w.end)

      // 选词模式：普通点=该词进待选；Ctrl 点=离散选区，拼成词组后再点「加入待选」；Alt/Ctrl 拖动=整段
      if (vocabMode) {
        if (range.collapsed) {
          const idx = idxAt(a)
          if (idx < 0) return
          if (ctrl) {
            if (!finalize) return
            const cur = new Set(selSid === sid ? selIndices : [])
            if (cur.has(idx)) cur.delete(idx)
            else cur.add(idx)
            commitSel([...cur])
            return
          }
          commitSel([idx], spans[idx].text)
          return
        }
        const end = altHeld || ctrl ? b : a
        const snapped = snapSelection(text, a, end)
        if (!snapped) return
        commitSel(indicesInRange(snapped.start, snapped.end), snapped.text)
        return
      }

      // 非选词：Ctrl 点 = **离散多选**（点 bar、from 就选这两个，不补中间）
      if (ctrl && range.collapsed) {
        if (!finalize) return
        const idx = idxAt(a)
        if (idx < 0) return
        const cur = new Set(selSid === sid ? selIndices : [])
        if (cur.has(idx)) cur.delete(idx)
        else cur.add(idx)
        commitSel([...cur])
        return
      }

      if (range.collapsed) {
        // 只是点了一下：整句
        setExact('')
        setUseExact(false)
        setSelSid(null)
        setSelIndices([])
        return
      }

      // 拖动：连续整段（Ctrl / 非 Ctrl 一样）
      const snapped = snapSelection(text, a, b)
      if (!snapped) return
      commitSel(indicesInRange(snapped.start, snapped.end))
    },
    [
      vocabMode,
      altHeld,
      batch,
      addToBatch,
      clearDomSelection,
      wordIndexRange,
      selSid,
      selIndices,
    ],
  )

  // 拖动过程中实时更新（不改 DOM，避免和拖选打架）；松手时才清原生选区、显示圆角高亮
  useEffect(() => {
    if (editing) return
    const handler = () => {
      if (applyingDom.current) return
      if (rightDownRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      applySelection(ctrlHeld, false)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [editing, ctrlHeld, applySelection])

  const onMouseUp = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (editing) return
      if (e.button !== 0) {
        rightDownRef.current = false
        return // 右键单独处理
      }
      applySelection(e.ctrlKey || e.metaKey, true)
    },
    [editing, applySelection],
  )

  const onMouseDown = useCallback((e: MouseEvent<HTMLElement>) => {
    rightDownRef.current = e.button === 2
  }, [])

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

  /** 把当前精确选区（可能是离散拼成的词组）加入待选。 */
  const addSelectionToBatch = useCallback(() => {
    const word = exact.trim()
    if (!word) return
    const already = batch.some((x) => lemmaOf(x.word) === lemmaOf(word))
    addToBatch([word], sentence?.text ?? '', sentence?.id ?? null)
    if (!already) sessionPickedRef.current += 1
    if (sentence) setLastPicked({ word, sid: sentence.id })
    setSelSid(null)
    setSelIndices([])
    flash(`已加入待选：${word}`)
  }, [exact, batch, addToBatch, sentence, flash])

  // 选词模式下有精确选区时，右键 = 「加入待选」（不再弹浏览器菜单）
  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      rightDownRef.current = false
      if (!vocabMode || !exact.trim()) return
      e.preventDefault()
      addSelectionToBatch()
    },
    [vocabMode, exact, addSelectionToBatch],
  )

  const mark = useCallback(() => {
    if (!exact) {
      flash('先划一个单词（按住 Ctrl 可精确选词组）')
      return
    }
    const result = markWord(library, {
      word: exact,
      articleId: articleTitle || articleKey || '手动粘贴',
      fileName: articleIdentity,
      sentenceId: sentence?.id ?? null,
      sentenceText: sentence?.text ?? '',
    })
    persist(result.library)
    flash(result.created ? `已加入：${result.item.word}` : `已合并：${result.item.word}`)
  }, [exact, library, articleIdentity, articleTitle, articleKey, sentence, persist, flash])

  const copyPrompt = useCallback(
    async (task: AnalysisTask) => {
      const text = useExact && exact ? exact : sentence?.text || exact
      if (!text) {
        flash('先划一段文字或点一句')
        return
      }
      setLastTask(task)
      askedWordsRef.current = task === 'lookup' && exact && !exact.includes(' ') ? [exact] : []
      askedIdsRef.current = []
      const prompt = buildPrompt({
        task,
        text,
        words: task === 'lookup' && exact && !exact.includes(' ') ? [exact] : undefined,
      })
      try {
        await navigator.clipboard.writeText(prompt)
        flash('提示词已复制，去 chat.deepseek.com 粘贴')
      } catch {
        flash('复制失败：浏览器需要 localhost 或 https')
      }
    },
    [exact, useExact, sentence, flash],
  )

  /** 待选词一次性加入生词本。 */
  const commitBatch = useCallback(() => {
    if (!visibleBatch.length) return
    let lib = library
    for (const b of visibleBatch) {
      lib = markWord(lib, {
        word: b.word,
        articleId: articleTitle || articleKey || '手动粘贴',
        fileName: articleIdentity,
        sentenceId: b.sentenceId,
        sentenceText: b.sentence,
      }).library
    }
    persist(lib)
    flash(`已加入 ${visibleBatch.length} 个生词`)
    setBatch([])
  }, [visibleBatch, library, articleIdentity, articleTitle, articleKey, persist, flash])

  /** 待选词一键生成批量查词提示词，复制到网页版 DeepSeek。 */
  const copyBatchPrompt = useCallback(async () => {
    if (!visibleBatch.length) return
    const prompt = buildBatchLookupPrompt(
      visibleBatch.map((b) => ({ word: b.word, context: b.sentence })),
    )
    setLastTask('lookup')
    askedWordsRef.current = visibleBatch.map((b) => b.word)
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(prompt)
      flash(`已复制 ${visibleBatch.length} 个词的查词提示词`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [visibleBatch, flash])

  /** 从生词本里挑出缺音标的词，生成查词提示词（补齐用）。 */
  const copyMissingPhonetic = useCallback(
    async (only: 'missing' | 'all') => {
      const todo = only === 'missing' ? library.items.filter((it) => !it.phonetic) : library.items
      if (!todo.length) {
        flash(only === 'missing' ? '生词都有音标了' : '生词本是空的')
        return
      }
      const prompt = buildBatchLookupPrompt(
        todo.map((it) => ({ word: it.word, context: it.source?.sentenceText })),
      )
      setLastTask('lookup')
      askedWordsRef.current = todo.map((it) => it.word)
      askedIdsRef.current = []
      try {
        await navigator.clipboard.writeText(prompt)
        flash(`已复制 ${todo.length} 个词，去 AI 粘贴后把结果贴回「应用结果」`)
      } catch {
        flash('复制失败：浏览器需要 localhost 或 https')
      }
    },
    [library.items, flash],
  )

  /** 全文翻译：按句子 id 逐句翻译，位置天然对齐。 */
  const copyTranslateAll = useCallback(async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const prompt = buildTranslateAllPrompt(doc.sentences.map((s) => ({ id: s.id, text: s.text })))
    setLastTask('translate')
    askedIdsRef.current = doc.sentences.map((s) => s.id)
    askedWordsRef.current = []
    try {
      await navigator.clipboard.writeText(prompt)
      flash('已复制全文翻译提示词；把结果贴回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [doc, flash])

  /** 自动标词：按词汇标准让 AI 从全文挑词，结果进「待选」。 */
  const copyAutoVocab = useCallback(async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const text = doc.sentences.map((s) => s.text).join(' ')
    setLastTask('auto_vocab')
    try {
      await navigator.clipboard.writeText(buildAutoVocabPrompt(text, vocabLevel))
      flash('已复制自动标词提示词；把 AI 返回的词表粘到「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [doc, vocabLevel, flash])

  /** 生成混淆项：让 AI 为缺混淆项的词产出形近/义近干扰词，结果粘回「应用结果」。 */
  const copyConfusablePrompt = useCallback(async () => {
    if (!confusableBatch.length) {
      flash('没有需要生成混淆项的词（需有释义）')
      return
    }
    setLastTask('confusable')
    askedWordsRef.current = confusableBatch.map((it) => it.word)
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildConfusablePrompt(confusableBatch.map((it) => ({ word: it.word, meaning: it.meaning }))),
      )
      const rest = confusableTodo.length - confusableBatch.length
      flash(
        rest > 0
          ? `已复制本批 ${confusableBatch.length} 个（还剩 ${rest}）；应用后再点一次继续`
          : `已复制 ${confusableBatch.length} 个词的混淆项提示词；结果粘回「应用结果」`,
      )
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [confusableBatch, confusableTodo, flash])

  /** 去重整理（程序）：重算 lemma 后按 lemma 合并重复词条。 */
  const dedupeNow = useCallback(() => {
    const before = library.items.length
    const next = dedupeLibrary(relemmaLibrary(library))
    persist(next)
    const removed = before - next.items.length
    flash(removed > 0 ? `已合并 ${removed} 个重复词` : '没有发现重复词')
  }, [library, persist, flash])

  /** 生成原形校正提示词：带来源语境，让 AI 判断原形。 */
  const copyLemmaPrompt = useCallback(async () => {
    if (!lemmaCandidates.length) {
      flash('没有疑似非原型的词（word 与原形一致）')
      return
    }
    setLastTask('lemma')
    askedWordsRef.current = lemmaCandidates.map((it) => it.word)
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildLemmaPrompt(lemmaCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      )
      flash(`已复制 ${lemmaCandidates.length} 个词的原形校正提示词；结果粘回「应用结果」`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [lemmaCandidates, flash])

  /** 生成 -ing/-ed 语法辨析提示词。 */
  const copyPosPrompt = useCallback(async () => {
    if (!posCandidates.length) {
      flash('没有含 -ing/-ed 的词')
      return
    }
    setLastTask('pos')
    askedWordsRef.current = posCandidates.map((it) => it.word)
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildPosPrompt(posCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      )
      flash(`已复制 ${posCandidates.length} 条 -ing/-ed 辨析提示词；结果粘回「应用结果」`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [posCandidates, flash])

  const applyPaste = useCallback(() => {
    const raw = pasted.trim()
    if (!raw) return
    setPasteReport([])
    setPasteMissing(null)

    // 自动标词：AI 返回的是一串单词 → 进「待选」清单（可增删，不直接落库）
    if (lastTask === 'auto_vocab') {
      const words = parseWordList(raw)
      if (!words.length) {
        setPasteReport(['没解析出单词（应为一行一个，或逗号/顿号分隔）'])
        flash('没解析出单词')
        return
      }
      mergeBatch(batchItemsFromWords(words))
      setPasted('')
      setPasteReport([`已加入待选 ${words.length} 个词，可增删后再查词`])
      flash(`已加入待选 ${words.length} 个词`)
      return
    }

    // 混淆项：写到对应词条，供选择题当干扰项。先校验再落库。
    if (lastTask === 'confusable') {
      const parsed = parseConfusables(raw)
      if (!parsed.length) {
        setPasteReport(['没解析出混淆项（格式：原词 | 词:释义 ; 词:释义）'])
        flash('没解析出混淆项')
        return
      }
      const asked = askedWordsRef.current
      const libLemmas = new Set(library.items.map((it) => it.lemma))
      // 每条至少要有 1 个「非空且和原词不同」的易混词
      const valid = parsed
        .map((r) => ({
          ...r,
          confusables: r.confusables.filter((c) => c.word.trim() && lemmaOf(c.word) !== lemmaOf(r.word)),
        }))
        .filter((r) => r.confusables.length > 0)
      const applied = valid.filter((r) => libLemmas.has(lemmaOf(r.word)))
      const unknown = valid.filter((r) => !libLemmas.has(lemmaOf(r.word))).map((r) => r.word)
      const empty = parsed
        .filter((r) => r.confusables.every((c) => !c.word.trim() || lemmaOf(c.word) === lemmaOf(r.word)))
        .map((r) => r.word)
      const missing = missingWords(asked, valid.map((r) => r.word))

      const report: string[] = []
      if (applied.length) persist(applyConfusables(library, applied))
      report.push(`成功写入 ${applied.length} 个词的混淆项`)
      if (missing.length) {
        report.push(`AI 未返回 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        setPasteMissing({ task: 'confusable', words: missing })
      }
      if (empty.length) {
        report.push(`内容无效 ${empty.length} 个（缺有效易混词）：${empty.slice(0, 10).join('、')}`)
      }
      if (unknown.length) {
        report.push(`词库里没有 ${unknown.length} 个：${unknown.slice(0, 10).join('、')}`)
      }
      setPasteReport(report)
      setPasted('')
      flash(`已写入 ${applied.length} 个${missing.length ? `，缺 ${missing.length}` : ''}`)
      return
    }

    // 原形校正：改 word/lemma，再合并重复
    if (lastTask === 'lemma') {
      const pairs = parseLemmaTable(raw)
      if (!pairs.length) {
        setPasteReport(['没解析出原形（格式：原词形 | 原形）'])
        flash('没解析出原形')
        return
      }
      const before = library.items.length
      const mapped = applyLemmaMap(library, pairs)
      const next = dedupeLibrary(mapped)
      persist(next)
      const changed = pairs.filter((p) => normalizeWord(p.from) !== normalizeWord(p.to)).length
      const merged = before - next.items.length
      const report: string[] = [`校正 ${changed} 个词形（共 ${pairs.length} 行）`]
      if (merged > 0) report.push(`合并去重 ${merged} 个`)
      const missing = missingWords(askedWordsRef.current, pairs.map((p) => p.from))
      if (missing.length) {
        report.push(`AI 未返回 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        setPasteMissing({ task: 'lemma', words: missing })
      }
      setPasteReport(report)
      setPasted('')
      flash(`已校正 ${changed} 个词形${merged ? `，合并 ${merged} 个` : ''}`)
      return
    }

    // -ing/-ed 语法辨析：写回原形 / 词性 / 笔记
    if (lastTask === 'pos') {
      const rows = parsePosTable(raw)
      if (!rows.length) {
        setPasteReport(['没解析出辨析结果（应为 8 列：原形 | 当前形式 | … | 最准确词性标注）'])
        flash('没解析出辨析结果')
        return
      }
      const before = library.items.length
      const next = dedupeLibrary(applyPosAnalysis(library, rows))
      persist(next)
      const merged = before - next.items.length
      const surfaces = rows.map((r) => normalizeWord(r.surface)).filter(Boolean)
      const missing = askedWordsRef.current.filter((w) => {
        const nw = normalizeWord(w)
        return !surfaces.some((s) => nw === s || nw.split(' ').includes(s))
      })
      const report: string[] = [`已写回 ${rows.length} 条辨析`]
      if (merged > 0) report.push(`合并去重 ${merged} 个`)
      if (missing.length) {
        report.push(`AI 未覆盖 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        setPasteMissing({ task: 'pos', words: missing })
      }
      setPasteReport(report)
      setPasted('')
      flash(`已写回 ${rows.length} 条辨析${merged ? `，合并 ${merged} 个` : ''}`)
      return
    }

    // 听力理解题：解析严格 JSON 并存起来
    if (lastTask === 'listening') {
      const quiz = parseListeningQuiz(raw)
      if (!quiz.questions.length) {
        setPasteReport(['没解析出题目（需要严格 JSON：{"questions":[…] }，含 type/stem/answer）'])
        flash('没解析出题目')
        return
      }
      setListenQuiz(quiz)
      try {
        localStorage.setItem('reader:listening:' + articleIdentity, JSON.stringify(quiz))
      } catch {
        // 忽略
      }
      setPasted('')
      setPasteReport([`已生成 ${quiz.questions.length} 道题`, '点工具栏「理解题」开始作答'])
      flash(`已生成 ${quiz.questions.length} 道听力理解题`)
      return
    }

    // 逐句语言点：写回句子
    if (lastTask === 'language') {
      const rows = parseLanguage(raw)
      if (!rows.length) {
        setPasteReport(['没解析出语言点（需要 JSON：{"sentences":[{"id":…}] }）'])
        flash('没解析出语言点')
        return
      }
      setDoc((d) => (d ? { ...d, sentences: applyLanguage(d.sentences, rows) } : d))
      setPendingSave(true)
      recordActivity('write', rows.length)
      const asked = askedIdsRef.current
      const got = new Set(rows.map((r) => r.id))
      const missing = asked.filter((id) => !got.has(id))
      const report = [`已写入 ${rows.length} 句语言点`]
      if (missing.length) {
        report.push(`AI 未返回 ${missing.length} 句：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
      }
      setPasteReport(report)
      setPasted('')
      flash(`已写入 ${rows.length} 句语言点`)
      return
    }

    // 仿写：生成任务
    if (lastTask === 'imitation') {
      const t = parseImitationTask(raw)
      if (!t) {
        setPasteReport(['没解析出仿写任务（需要 JSON：{task, model, rubric}）'])
        flash('没解析出仿写任务')
        return
      }
      setWritingTask(t)
      setWritingFeedback(null)
      setPasted('')
      setPasteReport([`已生成仿写任务（${t.rubric.length} 个维度）`])
      flash('已生成仿写任务，开始写吧')
      return
    }
    // 仿写：批改
    if (lastTask === 'feedback') {
      const f = parseWritingFeedback(raw)
      if (!f) {
        setPasteReport(['没解析出批改结果（需要 JSON：{scores, issues, polished}）'])
        flash('没解析出批改结果')
        return
      }
      setWritingFeedback(f)
      setWritingHistory((h) =>
        addWritingRecord(h, {
          at: new Date().toISOString(),
          articleId: articleIdentity,
          articleTitle: articleTitle || undefined,
          model: writingModel,
          text: writingText,
          feedback: f,
          task: writingTask ?? undefined,
        }),
      )
      recordActivity('write', 1)
      setPasted('')
      setPasteReport([`批改完成：${f.total}/${f.max}，${f.issues.length} 处修改`])
      flash(`批改完成：${f.total}/${f.max}`)
      return
    }

    const result = parseAnalysis(raw)
    const report: string[] = []
    let next = library
    if (result.words?.length) {
      next = dedupeLibrary(
        applyWordAnalysis(next, result.words, new Date(), {
          articleId: articleTitle || articleKey || '手动粘贴',
          fileName: articleIdentity,
          sentenceId: null,
          sentenceText: '',
        }),
      )
    }
    if (result.sentences?.length) {
      const map = new Map(result.sentences.map((x) => [x.sentenceId, x]))
      setDoc((d) =>
        d
          ? {
              ...d,
              sentences: d.sentences.map((s) => {
                const a = map.get(s.id)
                if (!a) return s
                return {
                  ...s,
                  translation: a.translation ?? s.translation,
                  grammarNote: a.grammarNote ?? s.grammarNote,
                  collocations: a.collocations
                    ? [...new Set([...s.collocations, ...a.collocations])]
                    : s.collocations,
                  vocab: a.vocab ? [...new Set([...s.vocab, ...a.vocab])] : s.vocab,
                }
              }),
            }
          : d,
      )
      recordActivity('read', result.sentences.length)
    }
    const sentenceTask = lastTask
    const fellBack = !result.words?.length && !result.sentences?.length && !!sentenceTask && !!sentence
    if (fellBack && sentenceTask) {
      const updated = applyToSentence(sentence, sentenceTask, raw)
      setDoc((d) => (d ? { ...d, sentences: d.sentences.map((x) => (x.id === updated.id ? updated : x)) } : d))
    }

    // 一点都没解析出来：保留粘贴内容，方便改格式重试
    if (!result.words?.length && !result.sentences?.length && !fellBack) {
      setPasteReport(['没解析出可用内容（查词表格 / 逐句翻译 / JSON）；检查格式后重试'])
      flash('没解析出内容')
      return
    }

    persist(next)
    // 有句子级结果（翻译/语法/搭配）或落到句子上 → 正文有改动，自动保存
    if (result.sentences?.length || fellBack) setPendingSave(true)
    setPasted('')

    if (result.words?.length) {
      report.push(`已填入 ${result.words.length} 个词条`)
      const asked = askedWordsRef.current
      if (asked.length) {
        const missing = missingWords(asked, result.words.map((w) => w.word))
        if (missing.length) {
          report.push(`AI 未返回 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
          setPasteMissing({ task: 'lookup', words: missing })
        }
      }
      const noPhon = result.words.filter((w) => !w.phonetic).length
      const noMean = result.words.filter((w) => !w.meaning).length
      if (noPhon) report.push(`其中 ${noPhon} 个没音标`)
      if (noMean) report.push(`其中 ${noMean} 个没释义`)
    }
    if (result.sentences?.length) {
      report.push(`已更新 ${result.sentences.length} 句`)
      const asked = askedIdsRef.current
      if (asked.length) {
        const got = new Set(result.sentences.map((x) => x.sentenceId))
        const missing = asked.filter((id) => !got.has(id))
        if (missing.length) {
          report.push(`AI 未返回 ${missing.length} 句：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        }
      }
    }
    if (fellBack) report.push('已按所选句子落上结果')
    setPasteReport(report.length ? report : ['已应用'])
    flash(report[0] ?? '已应用')
  }, [
    pasted,
    library,
    lastTask,
    sentence,
    persist,
    flash,
    mergeBatch,
    batchItemsFromWords,
    articleTitle,
    articleKey,
    articleIdentity,
    writingModel,
    writingText,
    recordActivity,
  ])

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

  const download = useCallback(
    (name: string, content: string, mime: string) => {
      const url = URL.createObjectURL(new Blob([content], { type: mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    },
    [],
  )

  const doExportAnki = useCallback(
    (items: VocabItem[]) =>
      download('vocab-anki.csv', toAnkiCSV(sortItems(items, 'word')), 'text/csv;charset=utf-8'),
    [download],
  )
  const exportJson = useCallback(
    () => download('vocab.json', exportLibraryJSON(library), 'application/json'),
    [library, download],
  )
  const exportBatch = useCallback(
    () =>
      download(
        'picked-words.csv',
        toWordsCSV(visibleBatch.map((b) => ({ word: b.word, context: b.sentence }))),
        'text/csv;charset=utf-8',
      ),
    [visibleBatch, download],
  )
  const doExportWrong = useCallback(
    (items: VocabItem[]) =>
      download('wrong-words.csv', toWrongWordsCSV(items), 'text/csv;charset=utf-8'),
    [download],
  )

  /** 导出全部：词库 + 已保存的文章，一个 JSON 换电脑用。 */
  const exportAll = useCallback(() => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      library,
      articles: saved,
      stats: sessions,
      studyStats: studyDays,
      activity,
      writingHistory,
      practice,
      mistakes,
    }
    const day = new Date().toISOString().slice(0, 10)
    download(`economist-backup-${day}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }, [library, saved, sessions, studyDays, activity, writingHistory, practice, mistakes, download])

  /** 导入备份：兼容「全部备份」「词库 JSON」「文章数组」「单篇」。 */
  const onImportBackup = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      try {
        const data: unknown = JSON.parse(await file.text())
        let imported: SavedArticle[] = []
        let importedLib: VocabLibrary | null = null
        if (Array.isArray(data)) {
          if (data.length && data[0] && typeof data[0] === 'object' && 'sentences' in data[0]) {
            imported = data as SavedArticle[]
          } else if (data.length && data[0] && typeof data[0] === 'object' && 'lemma' in data[0]) {
            importedLib = { schemaVersion: 1, items: data as VocabLibrary['items'] }
          }
        } else if (data && typeof data === 'object') {
          const obj = data as Record<string, unknown>
          if (Array.isArray(obj.articles)) imported = obj.articles as SavedArticle[]
          if (obj.library && typeof obj.library === 'object' && Array.isArray((obj.library as VocabLibrary).items)) {
            importedLib = obj.library as VocabLibrary
          } else if (Array.isArray(obj.items)) {
            importedLib = data as VocabLibrary
          }
          if (Array.isArray(obj.stats)) {
            const stats = obj.stats as { at: string; seconds: number; picked: number }[]
            setSessions(stats)
            try {
              localStorage.setItem('reader:vocabStats', JSON.stringify(stats))
            } catch {
              // 忽略
            }
          }
          if (Array.isArray(obj.studyStats)) {
            const ss = obj.studyStats as { day: string; seconds: number; cards: number }[]
            setStudyDays(ss)
          }
          if (Array.isArray(obj.activity)) {
            setActivity(obj.activity as DayActivity[])
          }
          if (Array.isArray(obj.writingHistory)) {
            setWritingHistory(obj.writingHistory as WritingRecord[])
          }
          if (Array.isArray(obj.practice)) {
            setPractice(obj.practice as PracticeRecord[])
          }
          if (Array.isArray(obj.mistakes)) {
            setMistakes(obj.mistakes as MistakeEntry[])
          }
          if (!imported.length && 'sentences' in obj && 'paragraphs' in obj) imported = [data as SavedArticle]
        }
        for (const a of imported) {
          if (a && a.id && Array.isArray(a.sentences) && Array.isArray(a.paragraphs)) {
            await articles.current?.save(a)
          }
        }
        if (importedLib) persist(importedLib)
        setSaved((await articles.current?.list()) ?? [])
        flash(`导入完成：文章 ${imported.length} 篇${importedLib ? `，生词 ${importedLib.items.length} 个` : ''}`)
      } catch {
        flash('导入失败：不是有效的 JSON 备份')
      }
    },
    [persist, flash],
  )
  const doPrint = useCallback(
    (items: VocabItem[], title: string, numberOf?: (it: VocabItem) => number | null) => {
      const sorted = numberOf
        ? [...items].sort((a, b) => (numberOf(a) ?? 1e9) - (numberOf(b) ?? 1e9))
        : sortItems(items, 'word')
      const groups = numberOf ? [{ key: '', items: sorted }] : groupItems(sorted, 'alphabet')
      const day = new Date().toISOString().slice(0, 10)
      const html = renderPrintHTML({
        title,
        groups,
        subtitle: `${day} · ${items.length} 词`,
        numberOf,
      })
      const win = window.open('', '_blank')
      if (!win) {
        flash('弹窗被拦截，允许后重试')
        return
      }
      win.document.write(html)
      win.document.close()
    },
    [flash],
  )

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
        <div className="bar">
          <strong>Economist 精读</strong>
          {book && editions.length > 1 && (
            <select value={edition} onChange={(e) => setEdition(e.target.value)} title="按期次筛选内置文章">
              <option value="全部">全部期次（{bookKeys.length}）</option>
              {editions.map(([label, n]) => (
                <option key={label} value={label}>
                  {label}（{n}）
                </option>
              ))}
            </select>
          )}
          {(book || saved.length > 0) && (
            <ArticlePicker
              book={book}
              saved={saved}
              savedGroups={savedGroups}
              builtinKeys={shownKeys}
              currentValue={currentValue}
              onPick={onPick}
            />
          )}
          <button onClick={() => void saveCurrent()} disabled={!doc} title="把这篇（含粘回的翻译/语法）存到本机，刷新后还在">
            保存这篇
          </button>
          {!editing && (
            <button onClick={() => setComposing((v) => !v)} title="新建 / 导入一篇文章（可多选 .txt / .md）">
              ＋ 新建文章
            </button>
          )}
          {doc && !editing && (
            <button className={vocabMode ? 'primary' : ''} onClick={toggleVocabMode} title="选词模式（W）：默认选单个词；按住 Alt / Ctrl 拖动选词组">
              选词模式{vocabMode ? ' · 开' : ''}
            </button>
          )}
          {doc && !editing && (
            <button onClick={() => void copyTranslateAll()} title="生成按句 id 的全文翻译提示词；粘回「应用结果」后逐句对齐">
              全文翻译
            </button>
          )}
          {doc && !editing && (
            <>
              <select
                value={vocabLevel}
                onChange={(e) => setVocabLevel(e.target.value as VocabLevel)}
                title="自动标词的词汇标准"
              >
                <option value="cet4">四级</option>
                <option value="cet6">六级</option>
                <option value="ielts">刚开始学雅思</option>
                <option value="ielts65">雅思 6.5</option>
                <option value="kaoyan">考研</option>
              </select>
              <button
                onClick={() => void copyAutoVocab()}
                title="按所选词汇标准，让 AI 从全文挑出要查的词（结果进「待选」，可增删后再查词）"
              >
                自动标词
              </button>
            </>
          )}
          {doc && !editing && (
            <select
              value={translateView}
              onChange={(e) => setTranslateView(e.target.value as 'off' | 'below' | 'only')}
              title="译文显示：只看原文 / 原文+译文 / 只看译文"
            >
              <option value="off">只看原文</option>
              <option value="below">原文+译文</option>
              <option value="only">只看译文</option>
            </select>
          )}
          {doc && !editing && (
            <label className="check-inline" title="点句子后自动朗读原文">
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={(e) => setAutoSpeak(e.target.checked)}
              />
              选中朗读
            </label>
          )}
          {doc && !editing && selectedId && (
            <button
              onClick={() => {
                const s = doc.sentences.find((x) => x.id === selectedId)
                if (s) speak(s.text)
              }}
              title="朗读当前选中句"
            >
              🔊 读本句
            </button>
          )}
          {doc && !editing && (
            <button
              className={readingAll ? 'danger' : ''}
              onClick={readingAll ? stopReadAll : startReadAll}
              title="用 TTS 逐句朗读整篇；再点一次停止"
            >
              {readingAll ? '⏹ 停止朗读' : '🔊 朗读全文'}
            </button>
          )}
          {doc && !editing && (
            <button onClick={enterEdit} title="改正文；完成时重新切句，已粘回的分析按句保留">
              编辑正文
            </button>
          )}
          {vocabMode && (
            <span className="muted timer" title="选词模式计时；今日/连续/累计统计记在本机">
              ⏱ {fmtDur(vocabSeconds)} · 本轮 {sessionPickedRef.current} · 今日 {dayStats.todayPicked} ·🔥
              {dayStats.streak} · 累计 {totals.picked} 词 / {fmtDur(totals.seconds)}
            </span>
          )}
          {editing && (
            <>
              <button
                onClick={() => void copyCleanupPrompt(draft, '「完成」')}
                disabled={!draft.trim()}
                title="复制一段提示词：让 AI 去掉这段文本的多余换行、粘连和错误，再把结果贴回编辑框"
              >
                生成清洗提示词
              </button>
              <button className="primary" onClick={applyEdit}>
                完成
              </button>
              <button onClick={cancelEdit}>取消</button>
            </>
          )}
          {savedId && (
            <button
              className={confirmDelSave ? 'danger' : ''}
              onClick={askDeleteSave}
              title="从本机删除这篇的保存（两步确认，防误删）"
            >
              {confirmDelSave ? '确认删除保存' : '删除保存'}
            </button>
          )}
          <span className="muted">{library.items.length} 个生词</span>
          <span
            className="muted goal-chip"
            title="今日目标（按学过的不同单词数）；点「统计」可改目标"
          >
            🎯 {studiedToday.ids.length}
            {dailyGoal > 0 ? `/${dailyGoal}` : ''} · 🔥{dayStats.streak}
          </span>
          <details className="tb-settings">
            <summary title="显示设置">显示 ⚙</summary>
            <div className="tb-settings-body">
              <select value={fontSize} onChange={(e) => setFontSize(e.target.value)} title="正文字号">
                <option value="sm">字号 小</option>
                <option value="md">字号 中</option>
                <option value="lg">字号 大</option>
                <option value="xl">字号 特大</option>
              </select>
              <label className="check-inline" title="正文加粗">
                <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
                加粗
              </label>
              <label className="check-inline" title="正文用衬线字体（更像书）">
                <input type="checkbox" checked={serif} onChange={(e) => setSerif(e.target.checked)} />
                衬线
              </label>
              <label className="check-inline" title="护眼模式：浅色纸感（浅绿底 + 深色字）">
                <input type="checkbox" checked={eye} onChange={(e) => setEye(e.target.checked)} />
                护眼
              </label>
            </div>
          </details>
          <a className="navlink" href="./index.html" title="回到跟读练习">
            <span className="arrow">←</span> 跟读练习
          </a>
        </div>
        )}

        {bookError && !book && (
          <p className="muted">没取到 articles.json（要 http://localhost 打开且文件存在）。可直接把正文粘在下面。</p>
        )}

        {studyQueue && (
          <div className="study">
            <div className="bar study-bar">
              <button onClick={closeStudy}>结束（Esc）</button>
              <button
                onClick={() => {
                  setStudyQueue(null)
                  setQuizResults([])
                  setQuizSetupOpen(true)
                }}
                title="直接考试：拼写 / 例句填空 / 搭配填空 / 听力填空"
              >
                考试
              </button>
              <span
                className="view-toggle"
                title="新学习：还没学过的词；复习：学过且到期的词（切换会立即重开一轮）"
              >
                <button
                  className={studyMode === 'learn' ? 'primary' : ''}
                  onClick={() => switchMode('learn')}
                >
                  新学习 {newCount}
                </button>
                <button
                  className={studyMode === 'review' ? 'primary' : ''}
                  onClick={() => switchMode('review')}
                >
                  复习 {dueCount}
                </button>
              </span>
              <select
                value={studyScope}
                onChange={(e) => setStudyScope(e.target.value as 'all' | 'article' | 'unmastered' | 'lapses')}
                title="背词范围（下一轮生效）"
              >
                <option value="unmastered">未掌握</option>
                <option value="lapses">错词</option>
                <option value="article">本篇</option>
                <option value="all">全部</option>
              </select>
              <select
                value={String(newLimit)}
                onChange={(e) => setNewLimit(Number(e.target.value))}
                title="每天最多引入多少新词（下一轮生效）"
              >
                <option value="0">新词不限</option>
                <option value="10">新词 10/天</option>
                <option value="20">新词 20/天</option>
                <option value="30">新词 30/天</option>
                <option value="50">新词 50/天</option>
              </select>
              <label className="check-inline" title="看中文拼英文">
                <input
                  type="checkbox"
                  checked={studySpelling}
                  onChange={(e) => {
                    setStudySpelling(e.target.checked)
                    setStudyChecked(false)
                    setStudyInput('')
                  }}
                />
                拼写
              </label>
              <span className="muted">
                {Math.min(studyIndex + 1, studyQueue.length)} / {studyQueue.length}
                {studyMode === 'learn' && newLimit > 0 ? ` · 新词 ${newToday}/${newLimit}` : ''}
              </span>
              <span
                className={
                  'study-timer' + (cardSeconds >= 25 ? ' slow' : cardSeconds >= 12 ? ' warn' : '')
                }
                title="这张卡停了多久；变红就是该翻面/评分了"
              >
                ⏱ {cardSeconds}s{cardSeconds >= 25 ? ' · 别墨迹' : ''}
              </span>
              <span className="muted study-total" title="本轮 / 累计 背单词时长；累计会记入统计">
                本轮 {fmtDur(studyLive)} · 累计 {fmtDur(studyGrandSeconds)}
              </span>
            </div>
            {studyCard
              ? (() => {
                  const spellingFront = studySpelling && !studyChecked
                  const canGrade = studySpelling ? studyChecked : studyRevealed
                  const correct = studyInput.trim().toLowerCase() === studyCard.word.trim().toLowerCase()
                  return (
                    <>
                      <div
                        className="study-card"
                        onClick={spellingFront ? undefined : () => setStudyRevealed(true)}
                      >
                        {spellingFront ? (
                          <div className="study-prompt">
                            <div className="study-meaning">
                              {studyCard.partOfSpeech && (
                                <span className="cell-pos">{studyCard.partOfSpeech} </span>
                              )}
                              {studyCard.meaning ?? '（无释义）'}
                            </div>
                            <input
                              className="study-input"
                              autoFocus
                              placeholder="拼出这个英文单词，回车检查"
                              value={studyInput}
                              onChange={(e) => setStudyInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  setStudyChecked(true)
                                }
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <div className="study-word">
                              {studyCard.word}
                              <button
                                className="speak"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  speak(studyCard.word)
                                }}
                                title="朗读"
                              >
                                🔊
                              </button>
                            </div>
                            {studyCard.phonetic && (
                              <div
                                className="study-phon"
                                title="点读发音"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  speak(studyCard.word)
                                }}
                              >
                                {studyCard.phonetic}
                              </div>
                            )}
                            {studyCard.usage.length > 0 && (
                              <div className="study-usage">{studyCard.usage.join('；')}</div>
                            )}
                            {studySpelling && studyChecked && (
                              <div className={'study-result ' + (correct ? 'ok' : 'bad')}>
                                {correct ? '✔ 正确' : `✘ 你写的是「${studyInput || '（空）'}」`}
                              </div>
                            )}
                            {(studyRevealed || (studySpelling && studyChecked)) && (
                              <div className="study-back">
                                <div className="study-meaning">
                                  {studyCard.partOfSpeech && (
                                    <span className="cell-pos">{studyCard.partOfSpeech} </span>
                                  )}
                                  {studyCard.meaning ?? '（无释义）'}
                                </div>
                                {studyCard.examples.slice(0, 1).map((ex, i) => (
                                  <div className="ex" key={i}>
                                    {ex.text}
                                    {ex.translation ? ` — ${ex.translation}` : ''}
                                  </div>
                                ))}
                                {studyCard.source?.sentenceText && (
                                  <div className="muted src">来源：{studyCard.source.sentenceText}</div>
                                )}
                                {studyCard.confusables && studyCard.confusables.length > 0 && (
                                  <div className="muted study-conf">
                                    易混：
                                    {studyCard.confusables
                                      .map((c) => `${c.word}${c.meaning ? `（${c.meaning}）` : ''}`)
                                      .join('；')}
                                  </div>
                                )}
                                <div className="muted study-srs">
                                  复习 {studyCard.reviewState.repetitions} 次
                                  {(studyCard.reviewState.lapses ?? 0) > 0
                                    ? ` · 忘记 ${studyCard.reviewState.lapses} 次`
                                    : ''}
                                  {studyCard.reviewState.due
                                    ? ` · 下次 ${fmtDue(studyCard.reviewState.due)}`
                                    : ' · 还没排期'}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* 卡内维护：改词形/释义、删误加的词 */}
                      <div className="bar study-tools">
                        <button onClick={openStudyEdit} title="改单词/音标/词性/释义/用法（会持久保存）">
                          ✎ 编辑
                        </button>
                        <button
                          className={studyDelArmed ? 'danger' : ''}
                          onClick={studyDelete}
                          title="删除这个误加的词（两步确认）"
                        >
                          {studyDelArmed ? '确认删除' : '删除'}
                        </button>
                        {(!studyCard.meaning || studyCard.usage.length === 0) && (
                          <button
                            className="primary"
                            onClick={openStudyEdit}
                            title="补上释义 / 用法后，才能出「拼写 / 填空 / 听力」题"
                          >
                            ＋ 补全释义/用法
                          </button>
                        )}
                        {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
                      </div>

                      {studyEditOpen && studyDraft && (
                        <div className="study-edit">
                          <label>
                            单词
                            <input
                              value={studyDraft.word}
                              onChange={(e) => setStudyDraft({ ...studyDraft, word: e.target.value })}
                            />
                          </label>
                          <label>
                            音标
                            <input
                              value={studyDraft.phonetic}
                              onChange={(e) => setStudyDraft({ ...studyDraft, phonetic: e.target.value })}
                              placeholder="/.../"
                            />
                          </label>
                          <label>
                            词性
                            <input
                              value={studyDraft.partOfSpeech}
                              onChange={(e) => setStudyDraft({ ...studyDraft, partOfSpeech: e.target.value })}
                              placeholder="n. / v. / adj."
                            />
                          </label>
                          <label className="wide">
                            释义
                            <textarea
                              value={studyDraft.meaning}
                              onChange={(e) => setStudyDraft({ ...studyDraft, meaning: e.target.value })}
                              rows={2}
                            />
                          </label>
                          <label className="wide">
                            用法（分号分隔）
                            <input
                              value={studyDraft.usage}
                              onChange={(e) => setStudyDraft({ ...studyDraft, usage: e.target.value })}
                              placeholder="run a business；run out"
                            />
                          </label>
                          <div className="bar">
                            <button className="primary" onClick={saveStudyEdit}>
                              保存
                            </button>
                            <button
                              onClick={() => {
                                setStudyEditOpen(false)
                                setStudyDraft(null)
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}

                      {canGrade ? (
                        <>
                          <div className="muted grade-preview">
                            预计下次：认识 {fmtInterval(review(studyCard.reviewState, 'good').interval)} ·
                            模糊 {fmtInterval(review(studyCard.reviewState, 'hard').interval)} · 忘记了{' '}
                            {fmtInterval(review(studyCard.reviewState, 'again').interval)}
                          </div>
                          <div className="bar study-actions">
                            <button className="primary" onClick={() => gradeStudy('good')}>
                              认识 <kbd>1</kbd>
                            </button>
                            <button onClick={() => gradeStudy('hard')}>
                              模糊 <kbd>2</kbd>
                            </button>
                            <button onClick={() => gradeStudy('again')}>
                              忘记了 <kbd>3</kbd>
                            </button>
                          </div>
                        </>
                      ) : spellingFront ? (
                        <button className="primary" onClick={() => setStudyChecked(true)}>
                          检查（回车）
                        </button>
                      ) : (
                        <button className="primary" onClick={() => setStudyRevealed(true)}>
                          显示释义（空格）
                        </button>
                      )}
                    </>
                  )
                })()
              : (
              <div className="study-done">
                <p>
                  本轮完成：认识 <b>{studyCounts.know}</b> · 模糊 <b>{studyCounts.fuzzy}</b> · 忘记了{' '}
                  <b>{studyCounts.forgot}</b>，用时 {fmtDur(studyLive)}。
                </p>
                <div className="bar">
                  {studyForgotRef.current.length > 0 && (
                    <button className="primary" onClick={retryForgot}>
                      重练忘记的 {studyForgotRef.current.length} 个
                    </button>
                  )}
                  <button
                    className={studyForgotRef.current.length ? '' : 'primary'}
                    onClick={() => startStudy()}
                  >
                    再来一轮（{studyMode === 'review' ? '复习' : '新学习'}）
                  </button>
                  <button
                    onClick={() => {
                      setQuizResults([])
                      setQuizSetupOpen(true)
                    }}
                  >
                    考试
                  </button>
                  <button onClick={closeStudy}>回到阅读</button>
                </div>
              </div>
            )}
          </div>
        )}

        {quizSetupOpen && !quizQueue && (
          <div className="study quiz-setup">
            <div className="bar study-bar">
              <strong>考试设置</strong>
              <button onClick={() => setQuizSetupOpen(false)}>取消</button>
            </div>
            <div className="quiz-setup-body">
              <div className="quiz-field">
                <span className="muted">题型</span>
                <div className="bar">
                  {(['spell', 'cloze', 'usage', 'listen', 'choice', 'meaning', 'ear'] as QuizKind[]).map((k) => (
                    <label className="check-inline" key={k}>
                      <input
                        type="checkbox"
                        checked={quizKinds.includes(k)}
                        onChange={(e) =>
                          setQuizKinds((prev) => (e.target.checked ? [...prev, k] : prev.filter((x) => x !== k)))
                        }
                      />
                      {QUIZ_KIND_LABEL[k]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="quiz-field">
                <span className="muted">范围</span>
                <div className="bar">
                  <select
                    value={quizScope}
                    onChange={(e) =>
                      setQuizScope(e.target.value as 'all' | 'article' | 'unmastered' | 'due' | 'lapses')
                    }
                  >
                    <option value="unmastered">未掌握</option>
                    <option value="due">到期</option>
                    <option value="lapses">错词</option>
                    <option value="article">本篇</option>
                    <option value="all">全部</option>
                  </select>
                </div>
              </div>
              <div className="quiz-field">
                <span className="muted">题量</span>
                <div className="bar">
                  <select value={String(quizLimit)} onChange={(e) => setQuizLimit(Number(e.target.value))}>
                    <option value="10">10 题</option>
                    <option value="20">20 题</option>
                    <option value="50">50 题</option>
                    <option value="0">全部</option>
                  </select>
                </div>
              </div>
              <div className="quiz-field">
                <span className="muted">答题</span>
                <div className="bar">
                  <label className="check-inline" title="答对/答错后自动进入下一题（答错会多停一会儿看答案）">
                    <input type="checkbox" checked={quizAuto} onChange={(e) => setQuizAuto(e.target.checked)} />
                    自动下一题
                  </label>
                  <label className="check-inline" title="每个单词只考一题、题型随机；关掉可让同一词出多种题型">
                    <input
                      type="checkbox"
                      checked={quizUnique}
                      onChange={(e) => setQuizUnique(e.target.checked)}
                    />
                    每词一题 · 乱序
                  </label>
                  <label className="check-inline" title="答完自动朗读正确答案（练发音）">
                    <input
                      type="checkbox"
                      checked={quizSpeak}
                      onChange={(e) => setQuizSpeak(e.target.checked)}
                    />
                    答完朗读
                  </label>
                </div>
              </div>
              <p className="muted">
                当前范围可出 {buildQuizSet(quizPool).length} 题（未掌握约 {quizPoolSizes.unmastered} 题）。
                答对按「认识」、答错按「忘记了」计入复习排期。
              </p>
              <div className="bar">
                <button className="primary" onClick={startQuiz} disabled={!quizKinds.length}>
                  开始考试
                </button>
              </div>
            </div>
          </div>
        )}

        {quizQueue && (
          <div className="study quiz">
            <div className="bar study-bar">
              <button onClick={closeQuiz}>结束（Esc）</button>
              <span className="muted">
                {Math.min(quizIndex + 1, quizQueue.length)} / {quizQueue.length}
              </span>
              <span className="muted study-timer">⏱ {fmtDur(quizSeconds)}</span>
              <span className="muted">
                正确 {quizResults.filter((r) => r.correct).length} / {quizResults.length}
              </span>
            </div>
            {quizIndex < quizQueue.length
              ? (() => {
                  const q = quizQueue[quizIndex]
                  return (
                    <>
                      <div className="study-card quiz-card">
                        <div className="quiz-kind">{QUIZ_KIND_LABEL[q.kind]}</div>
                        {q.kind === 'listen' || q.kind === 'ear' ? (
                          <button
                            className="primary quiz-play"
                            onClick={() => speak(q.audioText ?? q.context ?? q.word)}
                            title="再听一遍"
                          >
                            🔊 {q.kind === 'ear' ? '播放单词' : '播放句子'}
                          </button>
                        ) : q.kind === 'meaning' ? (
                          <div className="study-word quiz-word">
                            {q.word}
                            <button
                              className="speak"
                              onClick={() => speak(q.word)}
                              title="朗读"
                            >
                              🔊
                            </button>
                          </div>
                        ) : (
                          <div className={q.kind === 'spell' ? 'study-meaning quiz-prompt' : 'quiz-sentence'}>
                            {q.kind === 'spell' ? (
                              <>
                                {q.partOfSpeech && <span className="cell-pos">{q.partOfSpeech} </span>}
                                {q.prompt}
                              </>
                            ) : (
                              q.prompt
                            )}
                          </div>
                        )}
                        {(q.kind === 'cloze' || q.kind === 'usage' || q.kind === 'listen') && q.meaning && (
                          <div className="muted quiz-hint">
                            释义：{q.partOfSpeech ? `${q.partOfSpeech} ` : ''}
                            {q.meaning}
                          </div>
                        )}
                        {(q.kind === 'choice' || q.kind === 'meaning') && q.options ? (
                          <div className="quiz-options">
                            {q.options.map((opt, i) => (
                              <button
                                key={opt}
                                className={
                                  !quizChecked
                                    ? ''
                                    : opt === q.answer
                                      ? 'primary'
                                      : opt === quizInput
                                        ? 'danger'
                                        : ''
                                }
                                disabled={quizChecked}
                                onClick={() => {
                                  setQuizInput(opt)
                                  checkQuiz(opt)
                                }}
                              >
                                <kbd>{i + 1}</kbd> {opt}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <>
                            <input
                              className="study-input"
                              autoFocus
                              ref={quizInputRef}
                              placeholder="输入答案，回车提交 / 下一题"
                              value={quizInput}
                              onChange={(e) => setQuizInput(formatAnswerInput(e.target.value, q.answer))}
                              disabled={quizChecked}
                            />
                            <div className="muted quiz-mask" title="提示：一个下划线=一个字母；空格=一个词">
                              {maskAnswer(q.answer)}
                            </div>
                          </>
                        )}
                        {quizChecked && (
                          <>
                            <div className={'study-result ' + (quizResult ? 'ok' : 'bad')}>
                              {quizResult ? '✔ 正确' : `✘ 正确答案：${q.answer}`}
                            </div>
                            {q.context && <div className="muted quiz-full">{q.context}</div>}
                            {q.translation && <div className="muted quiz-full">{q.translation}</div>}
                          </>
                        )}
                      </div>
                      <div className="bar study-actions">
                        {!quizChecked ? (
                          <button className="primary" onClick={() => checkQuiz()}>
                            提交（回车）
                          </button>
                        ) : (
                          <button className="primary" onClick={nextQuiz}>
                            {quizIndex + 1 >= quizQueue.length ? '看结果（回车）' : '下一题（回车）'}
                          </button>
                        )}
                        <button onClick={closeQuiz}>退出</button>
                      </div>
                    </>
                  )
                })()
              : (() => {
                  const total = quizResults.length
                  const correct = quizResults.filter((r) => r.correct).length
                  const wrongIds = [...new Set(quizResults.filter((r) => !r.correct).map((r) => r.itemId))]
                  return (
                    <div className="study-done">
                      <p>
                        考试结束：答对 <b>{correct}</b> / {total}
                        {total ? `（正确率 ${Math.round((correct / total) * 100)}%）` : ''}，用时{' '}
                        {fmtDur(quizSeconds)}。
                      </p>
                      {wrongIds.length > 0 && (
                        <div className="quiz-wrong">
                          <div className="muted">错题：</div>
                          {wrongIds.map((id) => {
                            const it = library.items.find((x) => x.id === id)
                            return it ? (
                              <div key={id}>
                                <b>{it.word}</b>
                                {it.meaning ? ` — ${it.meaning}` : ''}
                              </div>
                            ) : null
                          })}
                        </div>
                      )}
                      <div className="bar">
                        {wrongIds.length > 0 && (
                          <button className="primary" onClick={retryQuizWrong}>
                            重做错题 {wrongIds.length}
                          </button>
                        )}
                        <button className={wrongIds.length ? '' : 'primary'} onClick={startQuiz}>
                          再来一轮
                        </button>
                        <button onClick={closeQuiz}>回到阅读</button>
                      </div>
                    </div>
                  )
                })()}
          </div>
        )}

        {quickQueue && (
          <div className="study quick">
            <div className="bar study-bar">
              <button onClick={() => setQuickQueue(null)}>结束（Esc）</button>
              <span className="muted">
                {Math.min(quickIndex + 1, quickQueue.length)} / {quickQueue.length}
              </span>
              <span className="muted">快刷：1/← 不认识 · 2/→ 认识 · 空格 看释义</span>
            </div>
            {quickIndex < quickQueue.length
              ? (() => {
                  const cur =
                    library.items.find((it) => it.id === quickQueue[quickIndex].id) ?? quickQueue[quickIndex]
                  return (
                    <>
                      <div className="study-card quick-card" onClick={() => setQuickRevealed(true)}>
                        <div className="study-word">
                          {cur.word}
                          <button
                            className="speak"
                            onClick={(e) => {
                              e.stopPropagation()
                              speak(cur.word)
                            }}
                            title="朗读"
                          >
                            🔊
                          </button>
                        </div>
                        {cur.phonetic && <div className="study-phon">{cur.phonetic}</div>}
                        {quickRevealed && (
                          <div className="study-back">
                            <div className="study-meaning">
                              {cur.partOfSpeech && <span className="cell-pos">{cur.partOfSpeech} </span>}
                              {cur.meaning ?? '（无释义）'}
                            </div>
                            {cur.usage.length > 0 && <div className="muted">{cur.usage.join('；')}</div>}
                          </div>
                        )}
                        {!quickRevealed && <div className="muted quick-hint">空格 / 点击 = 看释义</div>}
                      </div>
                      <div className="bar study-actions">
                        <button onClick={() => gradeQuick(false)}>
                          不认识 <kbd>1</kbd>
                        </button>
                        <button className="primary" onClick={() => gradeQuick(true)}>
                          认识 <kbd>2</kbd>
                        </button>
                      </div>
                    </>
                  )
                })()
              : (
                <div className="study-done">
                  <p>快刷完成，共 {quickQueue.length} 个词。</p>
                  <div className="bar">
                    <button className="primary" onClick={startQuick}>
                      再来一轮
                    </button>
                    <button onClick={() => setQuickQueue(null)}>回到阅读</button>
                  </div>
                </div>
              )}
          </div>
        )}

        {dictQueue && (
          <div className="study dict">
            <div className="bar study-bar">
              <button
                onClick={() => {
                  clearDictAdvance()
                  setDictQueue(null)
                }}
              >
                结束（Esc）
              </button>
              <span className="view-toggle" title="整句：听写整句；填空：句中挖掉几个词来填">
                <button
                  className={dictMode === 'full' ? 'primary' : ''}
                  onClick={() => startDictation({ mode: 'full' })}
                >
                  整句
                </button>
                <button
                  className={dictMode === 'cloze' ? 'primary' : ''}
                  onClick={() => startDictation({ mode: 'cloze' })}
                >
                  填空
                </button>
              </span>
              <select
                value={String(dictWords)}
                onChange={(e) => startDictation({ words: Number(e.target.value) })}
                title="整句模式下每句最多多少词（越长越难）；改完立即重开一轮"
              >
                <option value="1">每句 1 词</option>
                <option value="2">每句 2 词</option>
                <option value="3">每句 3 词</option>
                <option value="5">每句 5 词</option>
                <option value="8">每句 8 词</option>
                <option value="12">每句 12 词</option>
                <option value="20">每句 20 词</option>
              </select>
              {dictMode === 'cloze' && (
                <select
                  value={String(dictBlankCount)}
                  onChange={(e) => startDictation({ blanks: Number(e.target.value) })}
                  title="填空模式下每题挖几个空；不够空会自动并长句子"
                >
                  <option value="1">填空 1 个/题</option>
                  <option value="2">填空 2 个/题</option>
                  <option value="3">填空 3 个/题</option>
                  <option value="5">填空 5 个/题</option>
                </select>
              )}
              <span className="muted">
                {Math.min(dictIndex + 1, dictQueue.length)} / {dictQueue.length}
              </span>
              <button
                onClick={() => {
                  const s = dictQueue[dictIndex]
                  if (s) speak(s.text)
                }}
                title="再听一遍"
              >
                🔊 再听一遍
              </button>
            </div>
            {dictIndex < dictQueue.length ? (
              <>
                {dictMode === 'cloze' && dictCloze ? (
                  <>
                    <div className="dict-sentence">{dictCloze.display}</div>
                    <div className="dict-blanks">
                      {dictCloze.blanks.map((b, i) => (
                        <input
                          key={i}
                          className={
                            'study-input dict-blank' +
                            (dictChecked ? (isClozeBlankCorrect(b, dictBlanks[i] ?? '') ? ' ok' : ' bad') : '')
                          }
                          autoFocus={i === 0}
                          ref={i === 0 ? dictFirstBlankRef : undefined}
                          placeholder={`空 ${i + 1}`}
                          value={dictBlanks[i] ?? ''}
                          disabled={dictChecked}
                          onChange={(e) => {
                            const v = e.target.value
                            setDictBlanks((arr) => {
                              const next = [...arr]
                              next[i] = v
                              return next
                            })
                          }}
                        />
                      ))}
                    </div>
                    {dictChecked && <div className="dict-reveal">原文：{dictCloze.sentence}</div>}
                  </>
                ) : (
                  <>
                    <textarea
                      className="study-input dict-input"
                      autoFocus
                      ref={dictInputRef}
                      placeholder="听写这一句，回车检查 / 下一句"
                      value={dictInput}
                      onChange={(e) => setDictInput(e.target.value)}
                      disabled={dictChecked}
                    />
                    {dictChecked && dictDiff && (
                      <div className="dict-diff">
                        {dictDiff.map((t, i) => (
                          <span key={i} className={'dt ' + t.type}>
                            {t.text}{' '}
                          </span>
                        ))}
                      </div>
                    )}
                    {dictChecked && <div className="dict-reveal">原文：{dictQueue[dictIndex]?.text}</div>}
                  </>
                )}
                <div className="bar study-actions">
                  {!dictChecked ? (
                    <button className="primary" onClick={checkDict}>
                      检查（回车）
                    </button>
                  ) : (
                    <button className="primary" onClick={nextDict}>
                      {dictIndex + 1 >= dictQueue.length ? '完成（回车）' : '下一句（回车）'}
                    </button>
                  )}
                  {dictChecked && <button onClick={dictWrongNow}>漏词加入待选</button>}
                </div>
              </>
            ) : (
              <div className="study-done">
                <p>
                  听写完成：答对 <b>{dictResults.filter(Boolean).length}</b> / {dictResults.length}
                  {dictResults.length
                    ? `（${Math.round((dictResults.filter(Boolean).length / dictResults.length) * 100)}%）`
                    : ''}
                </p>
                {dictWrongItems.length > 0 && (
                  <div className="dict-wrong">
                    <div className="muted">错题（{dictWrongItems.length}）：</div>
                    {dictWrongItems.map((w) => (
                      <div key={w.id} className="dict-wrong-item">
                        {w.text}
                      </div>
                    ))}
                  </div>
                )}
                <div className="bar">
                  {dictWrongItems.length > 0 && (
                    <button className="primary" onClick={retryDictWrong}>
                      重练错题 {dictWrongItems.length}
                    </button>
                  )}
                  <button
                    className={dictWrongItems.length ? '' : 'primary'}
                    onClick={() => startDictation()}
                  >
                    再来一遍
                  </button>
                  <button
                    onClick={() => {
                      clearDictAdvance()
                      setDictQueue(null)
                    }}
                  >
                    回到阅读
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {listenOpen && listenQuiz && (
          <div className="study listen">
            <div className="bar study-bar">
              <button onClick={() => setListenOpen(false)}>结束（Esc）</button>
              <button
                className={readingAll ? 'danger' : ''}
                onClick={readingAll ? stopReadAll : startReadAll}
                title="朗读整篇（练习听力）"
              >
                {readingAll ? '⏹ 停止' : '🔊 播放全文'}
              </button>
              <span className="muted">
                共 {listenQuestions.length} 题{listenWrongIds ? '（只做错题）' : ''}
              </span>
              {listenSubmitted && listenResult && (
                <span className="muted">
                  得分 {listenResult.correct}/{listenResult.total}（
                  {Math.round(listenResult.score * 100)}%）
                </span>
              )}
            </div>
            <div className="listen-list">
              {listenQuestions.map((q, qi) => {
                const got = listenAnswers[q.id] ?? ''
                const ok = listenSubmitted && isListeningCorrect(q, got)
                return (
                  <div className="listen-q" key={q.id}>
                    <div className="listen-stem">
                      {qi + 1}. {q.stem}
                    </div>
                    {q.type === 'mcq' && q.options ? (
                      <div className="listen-opts">
                        {q.options.map((opt) => {
                          const chosen = got === opt
                          const cls =
                            (chosen ? 'primary' : '') +
                            (listenSubmitted && opt === q.answer ? ' ok' : '') +
                            (listenSubmitted && chosen && opt !== q.answer ? ' bad' : '')
                          return (
                            <button
                              key={opt}
                              className={cls}
                              disabled={listenSubmitted}
                              onClick={() => setListenAnswers((a) => ({ ...a, [q.id]: opt }))}
                            >
                              {opt}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <input
                        className="study-input listen-input"
                        disabled={listenSubmitted}
                        placeholder={q.type === 'gap' ? '填空' : '简答'}
                        value={got}
                        onChange={(e) => setListenAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      />
                    )}
                    {listenSubmitted && (
                      <div className={'listen-feedback ' + (ok ? 'ok' : 'bad')}>
                        {ok ? '✔ 正确' : `✘ 正确答案：${q.answer}`}
                        {q.explanation ? `　${q.explanation}` : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="bar study-actions">
              {!listenSubmitted ? (
                <button className="primary" onClick={submitListening}>
                  提交判分
                </button>
              ) : (
                <>
                  {listenResult && listenResult.correct < listenResult.total && (
                    <button className="primary" onClick={retryListenWrong}>
                      重做错题 {listenResult.total - listenResult.correct}
                    </button>
                  )}
                  <button onClick={showAllListen}>重做全部</button>
                </>
              )}
              <button onClick={() => void copyListeningPrompt()}>重新出题</button>
            </div>
            {listenSubmitted && doc && (
              <details className="listen-transcript">
                <summary>显示原文</summary>
                <div>{doc.sentences.map((s) => s.text).join(' ')}</div>
              </details>
            )}
          </div>
        )}

        {writingOpen && (
          <div className="study writing">
            <div className="bar study-bar">
              <button onClick={() => setWritingOpen(false)}>结束（Esc）</button>
              <span className="muted">仿写训练</span>
              <button onClick={() => void copyImitationTask()}>① 生成任务</button>
              <button
                className="primary"
                onClick={() => void copyFeedback()}
                disabled={!writingTask || !writingText.trim()}
              >
                ② 批改
              </button>
              <button onClick={() => setHistoryOpen((v) => !v)}>历史（{writingHistory.length}）</button>
            </div>
            <div className="write-block">
              <div className="muted">范句（可改）</div>
              <textarea
                className="study-input write-model"
                value={writingModel}
                onChange={(e) => setWritingModel(e.target.value)}
                rows={3}
              />
              {writingTask && (
                <div className="write-task">
                  <div>
                    <b>任务：</b>
                    {writingTask.task}
                  </div>
                  {writingTask.structure && <div className="muted">结构：{writingTask.structure}</div>}
                  {writingTask.mustUse.length > 0 && (
                    <div className="muted">必须用上：{writingTask.mustUse.join('、')}</div>
                  )}
                  {writingTask.rubric.length > 0 && (
                    <div className="muted">
                      评分：{writingTask.rubric.map((r) => `${r.dimension}(${r.weight})`).join(' · ')}
                    </div>
                  )}
                </div>
              )}
              <div className="muted">我的仿写</div>
              <textarea
                className="study-input write-text"
                placeholder="在这里写…写完点「② 批改」"
                value={writingText}
                onChange={(e) => setWritingText(e.target.value)}
                rows={6}
              />
            </div>
            {writingFeedback && (
              <div className="write-feedback">
                <div className="muted">
                  得分：{writingFeedback.total}/{writingFeedback.max}
                </div>
                {writingFeedback.scores.map((s) => (
                  <div key={s.dimension}>
                    {s.dimension}：{s.score}/{s.max}
                    {s.comment ? ` — ${s.comment}` : ''}
                  </div>
                ))}
                {writingFeedback.issues.length > 0 && (
                  <ul className="write-issues">
                    {writingFeedback.issues.map((is, i) => (
                      <li key={i}>
                        <span className="bad">{is.original}</span> → <span className="ok">{is.suggestion}</span>
                        {is.reason ? `（${is.reason}）` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {writingFeedback.polished && (
                  <div className="write-polished">
                    <b>改写示范：</b>
                    {writingFeedback.polished}
                  </div>
                )}
                {writingFeedback.summary && <div className="muted">{writingFeedback.summary}</div>}
              </div>
            )}
            {historyOpen && (
              <div className="write-history">
                <div className="bar">
                  <span className="muted">练习历史（{writingHistory.length}）</span>
                  {writingHistory.length > 0 && (
                    <button className="danger" onClick={() => setWritingHistory([])}>
                      清空
                    </button>
                  )}
                </div>
                {writingHistory.length ? (
                  writingHistory.map((rec, i) => (
                    <button key={i} className="write-hist-row" onClick={() => loadWritingRecord(rec)}>
                      <span className="muted">{new Date(rec.at).toLocaleString()}</span>
                      <span className="ellipsis"> {rec.model}</span>
                      <b>
                        {rec.feedback.total}/{rec.feedback.max}
                      </b>
                    </button>
                  ))
                ) : (
                  <div className="muted">还没有记录；批改一次就会存下来。</div>
                )}
              </div>
            )}
          </div>
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
          <div className="composer">
            <img className="composer-mascot" src={mascotAI} alt="" />
            <div className="bar">
              <input
                className="title-input"
                placeholder="文章标题（可留空）"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <input
                className="title-input book-input"
                placeholder="书名（可选，用于分组）"
                value={newBook}
                onChange={(e) => setNewBook(e.target.value)}
              />
              <label className="filebtn" title="读入本地 .txt / .md，可多选（每个文件一篇）">
                选择文件
                <input
                  type="file"
                  accept=".txt,.md,.markdown,text/plain"
                  multiple
                  onChange={(e) => {
                    void onImportFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <input
                className="title-input range-input"
                placeholder="页码范围 14-16（留空=整本）"
                value={pdfRange}
                onChange={(e) => setPdfRange(e.target.value)}
                title="只抽这几页；留空抽整本"
              />
              <label className="filebtn" title="浏览器内解析 PDF 文本（扫描件无文字层则读不出）">
                选择 PDF
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    void onPickPdf(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              <label className="filebtn" title="解析 EPUB，按章拆成多篇保存">
                选择 EPUB
                <input
                  type="file"
                  accept=".epub,application/epub+zip"
                  onChange={(e) => {
                    void onPickEpub(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              <button
                onClick={() => void copyCleanupPrompt(manual, '「创建文章」')}
                disabled={!manual.trim()}
                title="复制一段提示词：让 AI 去掉这段复制文本的多余换行、粘连和错误"
              >
                生成清洗提示词
              </button>
              <button className="primary" onClick={() => void createArticle()} disabled={!manual.trim()}>
                创建文章
              </button>
              {composing && <button onClick={() => setComposing(false)}>取消</button>}
              {importing && <span className="muted">{importing}</span>}
            </div>
            <textarea
              className="manual"
              placeholder="把英文正文粘在这里（或点「选择文件」导入），再点「创建文章」"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
          </div>
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
                <article className={'article' + (translateView === 'only' ? ' tr-only' : '')} ref={articleRef}>
                  {vocabMode && lastPicked && bubblePos && (
                    <div className="bubble" style={{ top: bubblePos.top, left: bubblePos.left }}>
                      {lastPicked.word}
                    </div>
                  )}
                  {doc.paragraphs.map((p) => (
                    <p className="para" key={p.id}>
                      {p.sentenceIds.map((sid) => {
                        const s = doc.sentences.find((x) => x.id === sid)
                        if (!s) return null
                        return (
                          <span key={sid} className="s-pair">
                            <span
                              data-sid={sid}
                              className={
                                'sent' +
                                (selectedId === sid ? ' sel' : '') +
                                (peekSid === sid && selectedId !== sid ? ' peek' : '') +
                                (vocabSidSet.has(sid) ? ' has-vocab' : '')
                              }
                              onClick={() => selectSentence(sid)}
                            >
                              {sentenceNodes(
                                s.text,
                                selSid === sid && selIndices.length ? new Set(selIndices) : null,
                                libraryLemmas,
                                focusEntry,
                                sid,
                                articleNums,
                                articleFirst,
                              )}{' '}
                            </span>
                            {translateView !== 'off' && (s.translation || translateView === 'only') && (
                              <span
                                data-sid={sid}
                                className={'tr-block' + (selectedId === sid ? ' sel' : '')}
                                onClick={() => selectSentence(sid)}
                                title="点这里等价于选中这句"
                              >
                                {s.translation ?? '（未翻译）'}
                              </span>
                            )}
                            {showLanguage && s.language && (
                              <span className="lang-block">
                                {s.language.structure && <div>结构：{s.language.structure}</div>}
                                {s.language.grammar && <div>语法：{s.language.grammar}</div>}
                                {s.language.idioms?.length ? (
                                  <div>习语：{s.language.idioms.join('；')}</div>
                                ) : null}
                                {s.language.phrases?.length ? (
                                  <div>词组：{s.language.phrases.join('；')}</div>
                                ) : null}
                                {s.language.usage?.length ? <div>用法：{s.language.usage.join('；')}</div> : null}
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </p>
                  ))}
                </article>
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
        <div className="side-sec" data-sec="overview">
          <div className="board">
            {mistakes.length > 0 &&
              (() => {
                const c = mistakeCounts(mistakes)
                const rows: { k: 'vocab' | 'listen' | 'dict'; run: () => void }[] = [
                  { k: 'vocab', run: retryMistakeVocab },
                  { k: 'listen', run: retryMistakeListen },
                  { k: 'dict', run: retryMistakeDict },
                ]
                return (
                  <div className="board-group">
                    <div className="side-label">错题本（{mistakes.length}）</div>
                    {rows.map(({ k, run }) => (
                      <div className="board-row partial" key={k}>
                        <span className="dot" />
                        <div className="board-body">
                          <div className="board-head">
                            <b>{MISTAKE_LABEL[k]}</b>
                            <span className="muted">{c[k]} 条</span>
                          </div>
                        </div>
                        <button className="board-act" onClick={run} disabled={c[k] === 0}>
                          重练
                        </button>
                      </div>
                    ))}
                    <button className="danger" onClick={() => setMistakes([])}>
                      清空错题本
                    </button>
                  </div>
                )
              })()}
            {['读', '词', '听', '写'].map((g) => {
              const rows = readyRows.filter((r) => r.group === g)
              if (!rows.length) return null
              return (
                <div key={g} className="board-group">
                  <div className="side-label">{g}</div>
                  {rows.map((r) => {
                    const action = boardAction(r.key)
                    return (
                      <div key={r.key} className={'board-row ' + r.level}>
                        <span className="dot" />
                        <div className="board-body">
                          <div className="board-head">
                            <b>{r.label}</b>
                            <span className="muted">{r.detail}</span>
                          </div>
                          {r.hint && <div className="board-hint">{r.hint}</div>}
                        </div>
                        {action && (
                          <button className="board-act" onClick={action.run}>
                            {action.label}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
        <div className="side-sec" data-sec="stats">
          {(() => {
            const today = new Date()
            const tk = dayKeyLocal(today)
            const weekFrom = (() => {
              const d = new Date(today)
              d.setDate(d.getDate() - 6)
              return dayKeyLocal(d)
            })()
            const monthFrom = dayKeyLocal(new Date(today.getFullYear(), today.getMonth(), 1))
            const todayCats = sumCats(activity, tk, tk)
            const weekCats = sumCats(activity, weekFrom, tk)
            const monthCats = sumCats(activity, monthFrom, tk)
            const streak = activityStreak(activity, today)
            const counts: Record<string, number> = {}
            for (const a of activity) counts[a.day] = dayTotal(a)
            const heat = buildHeatmap(counts, 13, today)
            const pct = (s: { total: number; correct: number }) =>
              s.total ? `${s.correct}/${s.total}（${Math.round((s.correct / s.total) * 100)}%）` : '—'
            const weekPractice = sumPractice(practice.filter((r) => r.at.slice(0, 10) >= weekFrom))
            const monthPractice = sumPractice(practice.filter((r) => r.at.slice(0, 10) >= monthFrom))
            const allPractice = sumPractice(practice)
            const kindSums = sumByKind(practice)
            const line = (label: string, cats: Record<ActivityCat, number>) => (
              <div className="stat-line" key={label}>
                <span className="stat-name">{label}</span>
                {ACTIVITY_CATS.map((c) => (
                  <span key={c} className="stat-cat">
                    {ACTIVITY_LABEL[c]} {cats[c]}
                  </span>
                ))}
                <b className="stat-total">{ACTIVITY_CATS.reduce((s, c) => s + cats[c], 0)}</b>
              </div>
            )
            return (
              <>
                <div className="side-label">今日 · 🔥 {streak} 天连续</div>
                {line('今日', todayCats)}
                <div className="side-label">近 7 天</div>
                {line('本周', weekCats)}
                <div className="side-label">本月（{today.getMonth() + 1} 月）</div>
                {line('本月', monthCats)}
                <div className="side-label">练习正确率（考试 / 听写 / 听力）</div>
                <div className="stat-line">
                  <span className="stat-name">本周</span>
                  <span className="stat-cat">{pct(weekPractice)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-name">本月</span>
                  <span className="stat-cat">{pct(monthPractice)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-name">累计</span>
                  <span className="stat-cat">{pct(allPractice)}</span>
                </div>
                <div className="muted">
                  考试 {pct(kindSums.quiz)} · 听写 {pct(kindSums.dictation)} · 听力{' '}
                  {pct(kindSums.listening)}
                </div>
                <div className="side-label">近 13 周热力图</div>
                <div className="heat">
                  <div className="heat-months">
                    {heat.monthLabels.map((m) => (
                      <span key={m.col} style={{ gridColumnStart: m.col + 1 }}>
                        {m.label}月
                      </span>
                    ))}
                  </div>
                  <div className="heat-grid">
                    {heat.cells.map((col, ci) =>
                      col.map((cell, ri) => (
                        <div
                          key={`${ci}-${ri}`}
                          className={'heat-cell' + (cell.future ? ' future' : ' lv' + cell.level)}
                          title={cell.future ? '' : `${cell.key}：${cell.count}`}
                        />
                      )),
                    )}
                  </div>
                </div>
                <div className="muted heat-legend">
                  少 <span className="heat-cell lv0" /> <span className="heat-cell lv1" />{' '}
                  <span className="heat-cell lv2" /> <span className="heat-cell lv3" />{' '}
                  <span className="heat-cell lv4" /> 多
                </div>
                <div className="side-label">最近练习（考试 / 听写 / 听力理解）</div>
                {practice.length ? (
                  recentPractice(practice, 8).map((r, i) => (
                    <div className="stat-line" key={i}>
                      <span className="stat-name">{PRACTICE_LABEL[r.kind]}</span>
                      <span className="stat-cat">
                        {r.correct}/{r.total}（{Math.round(accuracy(r) * 100)}%）
                      </span>
                      <span className="stat-total muted">{new Date(r.at).toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <div className="muted">还没有练习记录</div>
                )}
              </>
            )
          })()}
        </div>
        <div className="side-sec" data-sec="pick">
        {visibleBatch.length > 0 && (
          <div className="picked batch">
            <div className="picked-head">
              <span className="tag exact">待选 {visibleBatch.length}</span>
              <span className="muted">点正文里的词可加 / 减</span>
            </div>
            <div className="chips">
              {visibleBatch.map((b) => (
                <button
                  key={b.word}
                  className="chipx"
                  onClick={() => addToBatch([b.word], b.sentence, b.sentenceId)}
                  title="点击移除"
                >
                  {b.word} ×
                </button>
              ))}
            </div>
            <div className="tasks">
              <button className="primary" onClick={commitBatch}>
                加入生词本
              </button>
              <button onClick={() => void copyBatchPrompt()}>复制查词提示词</button>
              <button onClick={exportBatch}>导出 CSV</button>
              <button onClick={() => setBatch([])}>清空</button>
            </div>
            {batch.length > visibleBatch.length && (
              <div className="muted hint">
                另有 {batch.length - visibleBatch.length} 个已入库，不再显示（清空可重置）。
              </div>
            )}
          </div>
        )}
        <div className="picked">
          <div className="picked-head">
            <span className={'tag' + (useExact ? ' exact' : '')}>{useExact ? '精确片段' : '整句'}</span>
            <span className="word ellipsis" title={target}>
              {target || '（在正文里划选，或点一句）'}
            </span>
          </div>
          <div className="muted hint">
            {vocabMode
              ? '选词模式：点=一个词进待选；Ctrl 点多个词后右键或「加入待选」拼成词组；Alt 拖动=整段。'
              : '单击=整句；拖动=整段；Ctrl 点词=离散多选（点 bar 再点 from 就选这两个）。'}
          </div>
          <div className="tasks">
            <button
              className="primary"
              onClick={addSelectionToBatch}
              disabled={!exact}
              title="把当前选中（Ctrl 点选拼成的词组）加入「待选」清单，之后统一查词"
            >
              加入待选
            </button>
            <button
              onClick={mark}
              disabled={!exact}
              title="不查词，直接把当前选中存进生词本（状态：未查），之后可用「补查音标」批量补齐"
            >
              直接入库（未查词）
            </button>
            {TASKS.map((t) => (
              <button key={t.task} onClick={() => copyPrompt(t.task)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="muted">
            {lastTask ? `上一个任务：${lastTask}` : '点任务 → 复制提示词 → 去 chat.deepseek.com'}
          </div>
        </div>

        <textarea
          className="paste"
          placeholder="把 DeepSeek 的结果粘回这里，再点「应用结果」"
          value={pasted}
          onChange={(e) => {
            setPasted(e.target.value)
            if (pasteReport.length) setPasteReport([])
            if (pasteMissing) setPasteMissing(null)
          }}
        />
        <button className="primary" onClick={applyPaste} disabled={!pasted.trim()} style={{ marginTop: 6 }}>
          应用结果
        </button>
        {pasteReport.length > 0 && (
          <div className="paste-report">
            {pasteReport.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        {pasteMissing && pasteMissing.words.length > 0 && (
          <button
            onClick={() => void copyMissingAgain()}
            style={{ marginTop: 6 }}
            title="把 AI 没返回的词重新组成提示词，复制后再贴回"
          >
            🔁 复制未返回的 {pasteMissing.words.length} 个
          </button>
        )}
        <button
          onClick={() => void copyConfusablePrompt()}
          disabled={!confusableBatch.length}
          style={{ marginTop: 6, marginLeft: 6 }}
          title="让 AI 为缺混淆项的词生成形近/义近干扰词（用于看词选义/词形辨析）；可分批，应用后再点继续"
        >
          🤖 生成混淆项（{confusableBatch.length}/{confusableTodo.length}）
        </button>
        <select
          value={String(confusableBatchSize)}
          onChange={(e) => setConfusableBatchSize(Number(e.target.value))}
          style={{ marginTop: 6, marginLeft: 6 }}
          title="每次生成多少个词的混淆项（全部 = 一次生成，词多时 AI 回复可能被截断，截断的会留到下一批）"
        >
          <option value="30">30/批</option>
          <option value="60">60/批</option>
          <option value="100">100/批</option>
          <option value="200">200/批</option>
          <option value="0">全部/批</option>
        </select>
        <button
          onClick={() => void copyLemmaPrompt()}
          disabled={!lemmaCandidates.length}
          style={{ marginTop: 6, marginLeft: 6 }}
          title="把疑似非原型的词（带来源语境）交给 AI 判断原形；结果粘到上面再点「应用结果」"
        >
          🔤 校正原形（{lemmaCandidates.length}）
        </button>
        <button
          onClick={() => void copyPosPrompt()}
          disabled={!posCandidates.length}
          style={{ marginTop: 6, marginLeft: 6 }}
          title="让 AI 逐个判断 -ing / -ed 形式在语境里的语法身份（谓语/非谓语/分词形容词…），结果粘回「应用结果」"
        >
          🔎 -ing/-ed 辨析（{posCandidates.length}）
        </button>
        <button
          onClick={dedupeNow}
          disabled={!library.items.length}
          style={{ marginTop: 6, marginLeft: 6 }}
          title="重算原形并按原形合并重复词条（程序处理，不经过 AI）"
        >
          🧹 去重整理
        </button>

        </div>

        <div className="side-sec" data-sec="vocab">
        <div className="section-title">
          生词本 · 本篇（{articleWords.length}）
          <span className="view-toggle">
            <button className={vocabView === 'card' ? 'primary' : ''} onClick={() => setVocabView('card')}>
              卡片
            </button>
            <button
              className={vocabView === 'table' ? 'primary' : ''}
              onClick={() => setVocabView('table')}
              title="像书本词汇表一样密排"
            >
              表格
            </button>
          </span>
        </div>
        <div className="side-label">学习 / 练习</div>
        <div className="bar">
          <button
            className="primary"
            onClick={() => {
              setQuizQueue(null)
              setQuizSetupOpen(false)
              startStudy()
            }}
            disabled={!library.items.length}
            title="卡片式背单词：新学习没学过的、复习到期的；空格翻面，1/2/3 认识/模糊/忘记了，Esc 退出"
          >
            背单词
          </button>
          <button
            onClick={() => {
              setStudyQueue(null)
              setQuizResults([])
              setQuizSetupOpen(true)
            }}
            disabled={!library.items.length}
            title="考试：拼写 / 例句填空 / 搭配填空 / 听力填空 / 词形辨析，成绩计入复习排期"
          >
            考试
          </button>
          <button
            onClick={() => {
              setQuickQueue(null)
              setStudyQueue(null)
              setQuizSetupOpen(false)
              startQuick()
            }}
            disabled={!library.items.length}
            title="快刷：只看单词+音标，1/← 不认识，2/→ 认识，空格看释义，Esc 退出"
          >
            快刷
          </button>
          <button
            onClick={() => startDictation()}
            disabled={!doc}
            title="逐句听写：按文章顺序播句子，听写整句或听音填空；Tab 重听，回车检查"
          >
            听写
          </button>
          <button
            onClick={openListening}
            disabled={!doc}
            title="听力理解题：AI 出题（带答案+解析）→ 本地判分；没题目时先复制出题提示词"
          >
            理解题
          </button>
          <select
            value={String(listenCount)}
            onChange={(e) => setListenCount(Number(e.target.value))}
            title="听力理解题出题数量（点「理解题」用）"
          >
            <option value="5">5 题</option>
            <option value="8">8 题</option>
            <option value="10">10 题</option>
            <option value="15">15 题</option>
          </select>
          <button
            onClick={() => void copyLanguagePrompt()}
            disabled={!doc}
            title="逐句语言点分析（结构/语法/idiom/词组/用法）：复制提示词，粘回「应用结果」后写回句子"
          >
            语言点
          </button>
          <label className="check-inline" title="在正文里显示语言点（结构/语法/习语/词组/用法）">
            <input
              type="checkbox"
              checked={showLanguage}
              onChange={(e) => setShowLanguage(e.target.checked)}
            />
            显示语言点
          </label>
          <button onClick={openWriting} disabled={!doc} title="仿写：从范句生成任务 + 评分标准 → 你写 → AI 严格批改">
            仿写
          </button>
          <button
            onClick={() => {
              setQuizScope('lapses')
              setQuizResults([])
              setQuizSetupOpen(true)
            }}
            disabled={!library.items.some((w) => (w.reviewState.lapses ?? 0) > 0)}
            title="错题专练：把所有「忘记了」过的词拉出来考"
          >
            错题专练
          </button>
        </div>
        <div className="side-label">库 / 导出</div>
        <div className="bar">
          <button
            onClick={() => setBrowseAll(true)}
            disabled={!library.items.length}
            title="查看全部生词（跨文章）"
          >
            全部生词
          </button>
          <button
            onClick={() => doExportAnki(articleWords)}
            disabled={!articleWords.length}
            title="导出本篇生词为 Anki CSV"
          >
            Anki（本篇）
          </button>
          <button
            onClick={() =>
              doPrint(
                articleWords,
                articleTitle || articleKey || '本篇生词',
                (it) => articleNums.get(it.lemma) ?? null,
              )
            }
            disabled={!articleWords.length}
            title="打印本篇生词（A4）"
          >
            A4（本篇）
          </button>
          <button
            onClick={() => doExportAnki(library.items)}
            disabled={!library.items.length}
            title="导出整库生词为 Anki CSV"
          >
            Anki（整库）
          </button>
          <button
            onClick={() => doPrint(library.items, '全部生词')}
            disabled={!library.items.length}
            title="打印整库生词（A4）"
          >
            A4（整库）
          </button>
          <button onClick={exportJson} disabled={!library.items.length}>
            导出 JSON
          </button>
          <button
            onClick={() => void copyMissingPhonetic('missing')}
            disabled={!library.items.length}
            title="给生词本里没有音标的词生成查词提示词；粘回结果即可补齐"
          >
            补查音标
          </button>
          <button
            onClick={() => void copyMissingPhonetic('all')}
            disabled={!library.items.length}
            title="给全部生词重新生成查词提示词"
          >
            全部重查
          </button>
          <button onClick={() => setStatsOpen((v) => !v)} title="每日选词统计">
            统计
          </button>
          <button
            onClick={() => doExportWrong(library.items)}
            disabled={!library.items.some((it) => (it.reviewState.lapses ?? 0) > 0)}
            title="导出出错过的词（Word, Lapses, Meaning, Context）"
          >
            导出错词
          </button>
        </div>
        <div className="bar">
          <button onClick={exportAll} title="词库 + 已保存的文章打包成一个 JSON，换电脑时带走">
            导出全部（备份）
          </button>
          <label className="filebtn" title="导入之前的备份 JSON（文章 + 生词）">
            导入备份
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                void onImportBackup(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {statsOpen && (
          <div className="stats">
            <div className="muted">
              累计 {totals.picked} 词 / {fmtDur(totals.seconds)} · 今日 {dayStats.todayPicked} · 连续{' '}
              {dayStats.streak} 天
            </div>
            <div className="muted">
              背单词：今日 {fmtDur(studyTodaySeconds)} · 累计 {fmtDur(studyTotalSeconds)} · 完成{' '}
              {studyTotalCards} 次评分
            </div>
            <div className="goal">
              <div className="muted">
                今日目标：{studiedToday.ids.length} / {dailyGoal > 0 ? dailyGoal : '不限'} · 🔥{dayStats.streak} 天
                <select
                  value={String(dailyGoal)}
                  onChange={(e) => setDailyGoal(Number(e.target.value))}
                  title="每日目标（按学过的不同单词数）"
                >
                  <option value="0">不限</option>
                  <option value="10">10 词</option>
                  <option value="20">20 词</option>
                  <option value="30">30 词</option>
                  <option value="50">50 词</option>
                </select>
              </div>
              {dailyGoal > 0 && (
                <div className="goal-bar">
                  <div style={{ width: `${Math.min(100, (studiedToday.ids.length / dailyGoal) * 100)}%` }} />
                </div>
              )}
            </div>
            <div className="stats-bars">
              {last7.map((d) => (
                <div className="stats-day" key={d.key} title={`${d.key}：${d.picked} 词`}>
                  <div className="stats-col">
                    <div className="stats-bar" style={{ height: `${Math.min(100, d.picked * 8)}%` }} />
                  </div>
                  <div className="stats-label">{d.label}</div>
                </div>
              ))}
            </div>
            <div className="muted due-title">未来 30 天到期（颜色越深越多）</div>
            <div className="due-heat">
              {dueForecast.map((d) => (
                <div
                  key={d.key}
                  className={
                    'due-cell' +
                    (d.count >= 20
                      ? ' lv4'
                      : d.count >= 10
                        ? ' lv3'
                        : d.count >= 4
                          ? ' lv2'
                          : d.count > 0
                            ? ' lv1'
                            : '')
                  }
                  title={`${d.key}：${d.count} 词到期`}
                >
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
            {byArticle.length > 0 && (
              <div className="stats-articles">
                {byArticle.map(([name, n]) => (
                  <div className="stats-article" key={name}>
                    <span className="muted ellipsis" title={name}>
                      {name}
                    </span>
                    <b>{n}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {articleList.length ? (
          <VocabList
            items={articleList}
            view={vocabView}
            focusLemma={focusLemma}
            confirmDel={confirmDel}
            onJump={jumpToSource}
            onSpeak={speak}
            onDelete={askDelete}
            onReview={handleReview}
            onEdit={handleEdit}
            numberOf={(it) => articleNums.get(it.lemma) ?? null}
          />
        ) : (
          <div className="muted empty-hint">这篇还没有生词；划词标记，或点「全部生词」看别的文章。</div>
        )}
        </div>
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
