import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { styleOf, type ArticleBook } from '../core/matchArticle'
import { cleanText } from '../core/cleaner'
import { carryAnalysis, segment } from '../core/segmenter'
import { snapSelection, wordSpans } from '../core/wordSelect'
import {
  applyWordAnalysis,
  buildStudyQueue,
  createLibrary,
  dedupeLibrary,
  editItem,
  groupItems,
  lemmaOf,
  markWord,
  removeItem,
  reviewItem,
  sortItems,
  type ReviewGrade,
} from '../core/vocab'
import {
  applyToSentence,
  buildBatchLookupPrompt,
  buildCleanupPrompt,
  buildPrompt,
  buildTranslateAllPrompt,
  parseAnalysis,
  type AnalysisTask,
} from '../core/analyzer'
import { exportLibraryJSON, renderPrintHTML, toAnkiCSV, toWordsCSV, toWrongWordsCSV } from '../core/exports'
import { createVocabRepo } from '../adapters/vocabRepo'
import { createArticleRepo, type ArticleRepoPort, type SavedArticle } from '../adapters/articleRepo'
import { extractEpub, extractPdfText } from './importers'
import type { VocabRepoPort } from '../core/ports'
import type { Paragraph, Sentence, VocabLibrary, VocabItem } from '../types/document'
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
  active: { start: number; end: number } | null,
  lemmas: Set<string>,
  onWord: (word: string) => void,
): ReactNode[] {
  const spans = wordSpans(text)
  const out: ReactNode[] = []
  let pos = 0
  spans.forEach((w, i) => {
    if (w.start > pos) out.push(text.slice(pos, w.start))
    const on = active !== null && i >= active.start && i < active.end
    if (on) {
      out.push(<span key={`w${i}`} className="hl">{w.text}</span>)
    } else {
      const key = w.text.toLowerCase()
      const isVocab = lemmas.has(key) || lemmas.has(lemmaOf(key))
      out.push(
        isVocab ? (
          <span key={`w${i}`} className="vw" onClick={() => onWord(w.text)} title="在生词本里查看">
            {w.text}
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

export default function ReaderApp() {
  const [book, setBook] = useState<ArticleBook | null>(null)
  const [bookError, setBookError] = useState(false)
  const [articleKey, setArticleKey] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 鼠标精确选中的片段（划选 / 双击选词），可能为空 */
  const [exact, setExact] = useState('')
  /** 是否用精确片段：按住 Ctrl（Mac ⌘）划选时为真，默认用整句 */
  const [useExact, setUseExact] = useState(false)
  /** 精确片段落在哪个句子的第几个词（渲染圆角高亮用） */
  const [exactRange, setExactRange] = useState<{ sid: string; start: number; end: number } | null>(null)
  const [library, setLibrary] = useState<VocabLibrary>(() => createLibrary())
  const [pasted, setPasted] = useState('')
  const [lastTask, setLastTask] = useState<AnalysisTask | null>(null)
  const [toast, setToast] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [saved, setSaved] = useState<SavedArticle[]>([])
  const [savedId, setSavedId] = useState<string | null>(null)
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
  const [composing, setComposing] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  /** 新建/导入时可选的书名（epub 自动用文件名） */
  const [newBook, setNewBook] = useState('')
  /** 当前打开文章所属的书 */
  const [articleBook, setArticleBook] = useState('')
  /** 每日统计面板是否展开 */
  const [statsOpen, setStatsOpen] = useState(false)
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
  /** 背单词模式：本轮队列 / 当前序号 / 是否已翻面 */
  const [studyQueue, setStudyQueue] = useState<VocabItem[] | null>(null)
  const [studyIndex, setStudyIndex] = useState(0)
  const [studyRevealed, setStudyRevealed] = useState(false)
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
  const applyingDom = useRef(false)
  const repo = useRef<VocabRepoPort | null>(null)
  const articles = useRef<ArticleRepoPort | null>(null)
  const vocabStartRef = useRef<number | null>(null)
  const vocabAccumRef = useRef(0)
  const sessionPickedRef = useRef(0)
  const articleRef = useRef<HTMLElement | null>(null)
  const sideRef = useRef<HTMLElement | null>(null)
  const confirmTimerRef = useRef<number | null>(null)

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

  // 键盘 W 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发）
  const toggleVocabRef = useRef<() => void>(() => {})
  const navVocabRef = useRef<(dir: 1 | -1) => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('reader:size', fontSize)
    } catch {
      // 忽略
    }
  }, [fontSize])
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
        it.source?.fileName === articleKey ||
        (doc != null && doc.sentences.some((s) => wordSpans(s.text).some((w) => lemmaOf(w.text) === it.lemma))),
    )
  }, [library.items, studyScope, articleKey, doc])

  /** 开始背单词：先到期，再没学过的（受每日新词配额限制），最后其它。 */
  const startStudy = useCallback(() => {
    const q = buildStudyQueue(studyPool, new Date(), { newLimit, newToday })
    if (!q.length) {
      flash('这个范围里没有词')
      return
    }
    setStudyQueue(q)
    setStudyIndex(0)
    setStudyRevealed(false)
    setStudyInput('')
    setStudyChecked(false)
  }, [studyPool, newLimit, newToday, flash])

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

  const gradeStudy = useCallback(
    (grade: ReviewGrade) => {
      if (!studyQueue) return
      const cur = studyQueue[studyIndex]
      if (cur) {
        persist(reviewItem(library, cur.id, grade))
        if (cur.reviewState.repetitions === 0) bumpNewToday()
      }
      setStudyRevealed(false)
      setStudyInput('')
      setStudyChecked(false)
      setStudyIndex((i) => i + 1)
    },
    [studyQueue, studyIndex, library, persist, bumpNewToday],
  )

  const closeStudy = useCallback(() => setStudyQueue(null), [])

  // 背单词快捷键：空格/回车 翻面/判卷/记得，1/2/3/4 评分，Esc 退出
  useEffect(() => {
    if (!studyQueue) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const canGrade = studySpelling ? studyChecked : studyRevealed
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (studyIndex >= studyQueue.length) return
        if (!canGrade) {
          if (studySpelling) setStudyChecked(true)
          else setStudyRevealed(true)
          return
        }
        gradeStudy('good')
      } else if (e.key === '1') {
        if (canGrade) gradeStudy('again')
      } else if (e.key === '2') {
        if (canGrade) gradeStudy('hard')
      } else if (e.key === '3') {
        if (canGrade) gradeStudy('good')
      } else if (e.key === '4') {
        if (canGrade) gradeStudy('easy')
      } else if (e.key === 'Escape') closeStudy()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studyQueue, studyIndex, studyRevealed, studySpelling, studyChecked, gradeStudy, closeStudy])

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

  /** 生词本里所有词形 + lemma（正文里据此标出"生词"并可点）。 */
  const libraryLemmas = useMemo(() => {
    const s = new Set<string>()
    for (const it of library.items) {
      s.add(it.word.toLowerCase())
      s.add(it.lemma)
    }
    return s
  }, [library.items])

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

  /** 浏览器 TTS 读单词。 */
  const speak = useCallback((text: string) => {
    try {
      if (typeof speechSynthesis === 'undefined') return
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    } catch {
      // 忽略
    }
  }, [])

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

  /** 点生词本词条 → 回原文定位（优先用来源句，没有就在当前正文里搜；找到后回填来源）。 */
  const jumpToSource = useCallback(
    (item: VocabItem) => {
      if (!doc) return
      let sid =
        item.source?.fileName === articleKey && item.source.sentenceId ? item.source.sentenceId : null
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
      window.requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-sid="${sid}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    },
    [doc, articleKey, articleTitle, library, persist, flash],
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
      window.requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-sid="${sid}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    },
    [doc, peekSid, selectedId],
  )
  toggleVocabRef.current = toggleVocabMode
  navVocabRef.current = navigateVocab

  // 最近选中的词 → 气泡位置（贴在所在句上方）
  useEffect(() => {
    if (!lastPicked) {
      setBubblePos(null)
      return
    }
    const el = articleRef.current?.querySelector(`[data-sid="${lastPicked.sid}"]`) as HTMLElement | null
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
    setExactRange(null)
    setBatch([])
    setPeekSid(null)
    setLastPicked(null)
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
    flash('已应用修改（已粘回的分析按句保留）')
  }, [draft, doc, flash])

  const cancelEdit = useCallback(() => setEditing(false), [])

  // 已保存的文章，改动后自动落盘（翻译/语法粘回后不丢）
  useEffect(() => {
    if (!savedId || !doc) return
    const t = window.setTimeout(() => void saveCurrent(), 900)
    return () => window.clearTimeout(t)
  }, [doc, savedId, saveCurrent])

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

      const setRange = (s: number, e: number) => {
        const r = wordIndexRange(text, s, e)
        setExactRange(r && sid ? { sid, start: r.start, end: r.end } : null)
      }

      // 选词模式：点=一个词，拖=范围内所有词，都进「待选」清单
      if (vocabMode) {
        // 默认只选一个词；按住 Alt 拖动才按整段词组
        const end = altHeld && !range.collapsed ? b : a
        const snapped = snapSelection(text, a, end)
        if (!snapped) return
        setExact(snapped.text)
        setUseExact(true)
        setRange(snapped.start, snapped.end)
        if (finalize) {
          const already = batch.some((b) => lemmaOf(b.word) === lemmaOf(snapped.text))
          addToBatch([snapped.text], sentenceText, sid)
          if (!already) sessionPickedRef.current += 1
          if (sid) setLastPicked({ word: snapped.text, sid })
          clearDomSelection()
        }
        return
      }

      if (ctrl) {
        const word = snapSelection(text, a, a)
        if (!word) return
        setExact(word.text)
        setUseExact(true)
        setRange(word.start, word.end)
        if (finalize) clearDomSelection()
        return
      }

      if (range.collapsed) {
        // 只是点了一下：整句
        setExact('')
        setUseExact(false)
        setExactRange(null)
        return
      }

      const snapped = snapSelection(text, a, b)
      if (!snapped) return
      setExact(snapped.text)
      setUseExact(true)
      setRange(snapped.start, snapped.end)
      if (finalize) clearDomSelection()
    },
    [vocabMode, altHeld, batch, addToBatch, clearDomSelection, wordIndexRange],
  )

  // 拖动过程中实时更新（不改 DOM，避免和拖选打架）；松手时才清原生选区、显示圆角高亮
  useEffect(() => {
    if (editing) return
    const handler = () => {
      if (applyingDom.current) return
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
      applySelection(e.ctrlKey || e.metaKey, true)
    },
    [editing, applySelection],
  )

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

  /** 实际用于提示词/复制的文本：默认整句；按 Ctrl 划选时用更短的精确片段。 */
  const target = useExact && exact ? exact : sentence?.text || exact

  const mark = useCallback(() => {
    if (!exact) {
      flash('先划一个单词（按住 Ctrl 可精确选词组）')
      return
    }
    const result = markWord(library, {
      word: exact,
      articleId: articleKey ?? '手动粘贴',
      fileName: articleKey,
      sentenceId: sentence?.id ?? null,
      sentenceText: sentence?.text ?? '',
    })
    persist(result.library)
    flash(result.created ? `已加入：${result.item.word}` : `已合并：${result.item.word}`)
  }, [exact, library, articleKey, sentence, persist, flash])

  const copyPrompt = useCallback(
    async (task: AnalysisTask) => {
      const text = useExact && exact ? exact : sentence?.text || exact
      if (!text) {
        flash('先划一段文字或点一句')
        return
      }
      setLastTask(task)
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
    if (!batch.length) return
    let lib = library
    for (const b of batch) {
      lib = markWord(lib, {
        word: b.word,
        articleId: articleKey ?? '手动粘贴',
        fileName: articleKey,
        sentenceId: b.sentenceId,
        sentenceText: b.sentence,
      }).library
    }
    persist(lib)
    flash(`已加入 ${batch.length} 个生词`)
    setBatch([])
  }, [batch, library, articleKey, persist, flash])

  /** 待选词一键生成批量查词提示词，复制到网页版 DeepSeek。 */
  const copyBatchPrompt = useCallback(async () => {
    if (!batch.length) return
    const prompt = buildBatchLookupPrompt(batch.map((b) => ({ word: b.word, context: b.sentence })))
    setLastTask('lookup')
    try {
      await navigator.clipboard.writeText(prompt)
      flash(`已复制 ${batch.length} 个词的查词提示词`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [batch, flash])

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
    try {
      await navigator.clipboard.writeText(prompt)
      flash('已复制全文翻译提示词；把结果贴回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [doc, flash])

  const applyPaste = useCallback(() => {
    const raw = pasted.trim()
    if (!raw) return
    const result = parseAnalysis(raw)
    let next = library
    if (result.words?.length) next = applyWordAnalysis(next, result.words)
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
    }
    if (!result.words?.length && !result.sentences?.length && lastTask && sentence) {
      const updated = applyToSentence(sentence, lastTask, raw)
      setDoc((d) => (d ? { ...d, sentences: d.sentences.map((x) => (x.id === updated.id ? updated : x)) } : d))
    }
    persist(next)
    setPasted('')
    flash(result.words?.length ? `已填入 ${result.words.length} 个词条` : '已应用')
  }, [pasted, library, lastTask, sentence, persist, flash])

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

  const exportAnki = useCallback(
    () => download('vocab-anki.csv', toAnkiCSV(sortItems(library.items, 'word')), 'text/csv;charset=utf-8'),
    [library.items, download],
  )
  const exportJson = useCallback(
    () => download('vocab.json', exportLibraryJSON(library), 'application/json'),
    [library, download],
  )
  const exportBatch = useCallback(
    () =>
      download(
        'picked-words.csv',
        toWordsCSV(batch.map((b) => ({ word: b.word, context: b.sentence }))),
        'text/csv;charset=utf-8',
      ),
    [batch, download],
  )
  const exportWrong = useCallback(
    () => download('wrong-words.csv', toWrongWordsCSV(library.items), 'text/csv;charset=utf-8'),
    [library.items, download],
  )

  /** 导出全部：词库 + 已保存的文章，一个 JSON 换电脑用。 */
  const exportAll = useCallback(() => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      library,
      articles: saved,
      stats: sessions,
    }
    const day = new Date().toISOString().slice(0, 10)
    download(`economist-backup-${day}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }, [library, saved, sessions, download])

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
  const printWords = useCallback(() => {
    const html = renderPrintHTML({
      title: '我的生词本',
      groups: groupItems(sortItems(library.items, 'word'), 'alphabet'),
    })
    const win = window.open('', '_blank')
    if (!win) {
      flash('弹窗被拦截，允许后重试')
      return
    }
    win.document.write(html)
    win.document.close()
  }, [library.items, flash])

  const list = sortItems(library.items, 'updatedAt')
  const studyCard = studyQueue && studyIndex < studyQueue.length ? studyQueue[studyIndex] : null

  return (
    <div className={`reader size-${fontSize}${bold ? ' weight-bold' : ''}${serif ? ' font-serif' : ''}`}>
      <main className="reader-main" onMouseUp={onMouseUp}>
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
            <select value={currentValue} onChange={(e) => onPick(e.target.value)}>
              <option value="">选择文章…</option>
              {book && (
                <optgroup label={`内置（${shownKeys.length}）`}>
                  {shownKeys.map((k) => (
                    <option key={k} value={`b:${k}`}>
                      {k}
                    </option>
                  ))}
                </optgroup>
              )}
              {savedGroups.map(([book, list]) => (
                <optgroup
                  key={book}
                  label={book === '单篇' ? `已保存（${list.length}）` : `📖 ${book}（${list.length}）`}
                >
                  {list.map((a) => (
                    <option key={a.id} value={`s:${a.id}`}>
                      {book === '单篇' ? a.title : a.title.replace(`${book} · `, '')}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
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
            <button className={vocabMode ? 'primary' : ''} onClick={toggleVocabMode} title="选词模式（W）：默认选单个词；按住 Alt 拖动选词组">
              选词模式{vocabMode ? ' · 开' : ''}
            </button>
          )}
          {doc && !editing && (
            <button onClick={() => void copyTranslateAll()} title="生成按句 id 的全文翻译提示词；粘回「应用结果」后逐句对齐">
              全文翻译
            </button>
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
            <button onClick={() => void deleteSaved()} title="从本机删除这篇的保存（正文仍可重新保存）">
              删除保存
            </button>
          )}
          <span className="muted">{library.items.length} 个生词</span>
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
          <a className="navlink" href="./index.html" title="回到跟读练习">
            ← 跟读练习
          </a>
        </div>

        {bookError && !book && (
          <p className="muted">没取到 articles.json（要 http://localhost 打开且文件存在）。可直接把正文粘在下面。</p>
        )}

        {studyQueue && (
          <div className="study">
            <div className="bar study-bar">
              <button onClick={closeStudy}>结束（Esc）</button>
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
                {newLimit > 0 ? ` · 新词 ${newToday}/${newLimit}` : ''}
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
                                {studyCard.usage.length > 0 && (
                                  <div className="mu">{studyCard.usage.join('；')}</div>
                                )}
                                {studyCard.examples.slice(0, 1).map((ex, i) => (
                                  <div className="ex" key={i}>
                                    {ex.text}
                                    {ex.translation ? ` — ${ex.translation}` : ''}
                                  </div>
                                ))}
                                {studyCard.source?.sentenceText && (
                                  <div className="muted src">来源：{studyCard.source.sentenceText}</div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {canGrade ? (
                        <div className="bar study-actions">
                          <button onClick={() => gradeStudy('again')}>忘记 (1)</button>
                          <button onClick={() => gradeStudy('hard')}>困难 (2)</button>
                          <button className="primary" onClick={() => gradeStudy('good')}>
                            记得 (3)
                          </button>
                          <button onClick={() => gradeStudy('easy')}>简单 (4)</button>
                        </div>
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
                <p>本轮完成，共 {studyQueue.length} 个词。</p>
                <div className="bar">
                  <button className="primary" onClick={startStudy}>
                    再来一轮
                  </button>
                  <button onClick={closeStudy}>回到阅读</button>
                </div>
              </div>
            )}
          </div>
        )}

        {!studyQueue && (composing || !doc) && (
          <div className="composer">
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

        {!studyQueue && doc && !composing && (
          <>
            <h1>{articleTitle || (articleKey ? articleKey : '手动粘贴')}</h1>
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
                  {translateView === 'off'
                    ? doc.paragraphs.map((p) => (
                        <p className="para" key={p.id}>
                          {p.sentenceIds.map((sid) => {
                            const s = doc.sentences.find((x) => x.id === sid)
                            if (!s) return null
                            return (
                              <span
                                key={sid}
                                data-sid={sid}
                                className={
                                  'sent' +
                                  (selectedId === sid ? ' sel' : '') +
                                  (peekSid === sid && selectedId !== sid ? ' peek' : '') +
                                  (vocabSidSet.has(sid) ? ' has-vocab' : '')
                                }
                                onClick={() => setSelectedId(sid)}
                              >
                                {sentenceNodes(
                                  s.text,
                                  useExact && exactRange?.sid === sid ? exactRange : null,
                                  libraryLemmas,
                                  focusEntry,
                                )}{' '}
                              </span>
                            )
                          })}
                        </p>
                      ))
                    : doc.paragraphs.map((p) => (
                        <div className="tr-para" key={p.id}>
                          {p.sentenceIds.map((sid) => {
                            const s = doc.sentences.find((x) => x.id === sid)
                            if (!s) return null
                            return (
                              <div
                                key={sid}
                                className={
                                  'tr-sent' +
                                  (selectedId === sid ? ' sel' : '') +
                                  (peekSid === sid && selectedId !== sid ? ' peek' : '')
                                }
                              >
                                {translateView === 'below' && (
                                  <span className="sent" data-sid={sid} onClick={() => setSelectedId(sid)}>
                                    {sentenceNodes(
                                      s.text,
                                      useExact && exactRange?.sid === sid ? exactRange : null,
                                      libraryLemmas,
                                      focusEntry,
                                    )}
                                  </span>
                                )}
                                <div
                                  className="tr-text"
                                  data-sid={sid}
                                  onClick={() => setSelectedId(sid)}
                                >
                                  {s.translation ?? '（未翻译）'}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ))}
                </article>
              </>
            )}
          </>
        )}
      </main>

      <aside className="reader-side" ref={sideRef}>
        {batch.length > 0 && (
          <div className="picked batch">
            <div className="picked-head">
              <span className="tag exact">待选 {batch.length}</span>
              <span className="muted">点正文里的词可加 / 减</span>
            </div>
            <div className="chips">
              {batch.map((b) => (
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
              ? '选词模式：点 / 拖 = 一个词；按住 Alt 拖动 = 词组。'
              : '单击=整句；拖动=按整词吸附；按住 Ctrl 点=单个词。'}
          </div>
          <div className="tasks">
            <button className="primary" onClick={mark} disabled={!exact}>
              加入生词
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
          onChange={(e) => setPasted(e.target.value)}
        />
        <button className="primary" onClick={applyPaste} disabled={!pasted.trim()} style={{ marginTop: 6 }}>
          应用结果
        </button>

        <div className="section-title">
          生词本（{library.items.length}）
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
        <div className="bar">
          <button
            className="primary"
            onClick={startStudy}
            disabled={!library.items.length}
            title="卡片式背单词：先到期、再新词；空格翻面，1/2/3/4 评分，Esc 退出"
          >
            背单词
          </button>
          <button onClick={exportAnki} disabled={!library.items.length}>
            导出 Anki CSV
          </button>
          <button onClick={exportJson} disabled={!library.items.length}>
            导出 JSON
          </button>
          <button onClick={printWords} disabled={!library.items.length}>
            A4 打印
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
            onClick={exportWrong}
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

        {vocabView === 'table' ? (
          <table className="vtable">
            <thead>
              <tr>
                <th>单词</th>
                <th>含义</th>
                <th>用法</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr
                  key={it.id}
                  data-lemma={it.lemma}
                  className={it.lemma === focusLemma ? 'focus' : ''}
                  onClick={() => jumpToSource(it)}
                  title={it.examples[0]?.text ?? ''}
                >
                  <td className="cell-word">
                    {it.word}
                    {it.phonetic && (
                      <span
                        className="cell-phon"
                        title="点读发音"
                        onClick={(e) => {
                          e.stopPropagation()
                          speak(it.word)
                        }}
                      >
                        {it.phonetic}
                      </span>
                    )}
                  </td>
                  <td className="cell-meaning">
                    {it.partOfSpeech && <span className="cell-pos">{it.partOfSpeech} </span>}
                    {it.meaning ?? ''}
                  </td>
                  <td className="cell-usage">{it.usage.join('；')}</td>
                  <td className="cell-act">
                    <button
                      className={confirmDel === it.id ? 'danger' : ''}
                      onClick={(e) => {
                        e.stopPropagation()
                        askDelete(it.id)
                      }}
                      title={confirmDel === it.id ? '再点一次确认删除' : '删除（需两步确认）'}
                    >
                      {confirmDel === it.id ? '确认' : '×'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          list.map((it) => (
            <div
              className={'entry' + (it.lemma === focusLemma ? ' focus' : '')}
              key={it.id}
              data-lemma={it.lemma}
            >
              <div className="w" onClick={() => jumpToSource(it)} title="回到原文这句">
                {it.word}{' '}
                {it.phonetic && (
                  <span
                    className="ph"
                    title="点读发音"
                    onClick={(e) => {
                      e.stopPropagation()
                      speak(it.word)
                    }}
                  >
                    {it.phonetic}
                  </span>
                )}
              </div>
              {it.partOfSpeech && <div className="mu">{it.partOfSpeech}</div>}
              {it.meaning && <div className="mu">{it.meaning}</div>}
              {it.usage.length > 0 && <div className="mu">{it.usage.join('；')}</div>}
              {it.examples.slice(0, 1).map((ex, i) => (
                <div className="ex" key={i}>
                  {ex.text}
                  {ex.translation ? ` — ${ex.translation}` : ''}
                </div>
              ))}
              <div className="muted">
                状态：{it.status}
                {it.reviewState.lapses ? ` · 错 ${it.reviewState.lapses}` : ''}
                {it.source ? ` · ${it.source.articleId}` : ''}
              </div>
              <div className="row">
                <button onClick={() => persist(reviewItem(library, it.id, 'again'))}>重来</button>
                <button onClick={() => persist(reviewItem(library, it.id, 'good'))}>记得</button>
                <button onClick={() => persist(reviewItem(library, it.id, 'easy'))}>简单</button>
                <button
                  onClick={() => {
                    const m = window.prompt('修改含义', it.meaning ?? '')
                    if (m !== null) persist(editItem(library, it.id, { meaning: m }))
                  }}
                >
                  改释义
                </button>
                <button
                  className={confirmDel === it.id ? 'danger' : ''}
                  onClick={() => askDelete(it.id)}
                  title="两步确认，防误触"
                >
                  {confirmDel === it.id ? '确认删除' : '删除'}
                </button>
              </div>
            </div>
          ))
        )}
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
