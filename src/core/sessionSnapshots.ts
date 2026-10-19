/**
 * 会话快照（考试 / 听写）的**运行时解析**。
 *
 * 快照存在 localStorage，属于「外部输入」：用户可能手改、旧版本可能残留半截结构、
 * 浏览器也可能在写一半时崩掉。以前只检查 `v` 和 `queue` 是不是数组，坏题会一路带到
 * 判分 / 渲染里才炸。这里逐项校验，坏条目丢弃，整份不可用就当作没有快照。
 */
import { isQuizKind, type QuizQuestion } from './quiz'
import type { DiffToken } from './dictation'

export interface QuizResultRow {
  id: string
  itemId: string
  correct: boolean
}

export interface QuizSessionSnapshot {
  v: 1
  queue: QuizQuestion[]
  index: number
  input: string
  checked: boolean
  result: boolean | null
  results: QuizResultRow[]
  autoRun: boolean
}

export interface DictItemData {
  id: string
  text: string
  targets?: string[]
  /** 整句模式：源句全文 + 本块在该句里的词区间（复用整句音频 seek 播放）。 */
  src?: string
  sw?: number
  ew?: number
}

export interface DictSessionSnapshot {
  v: 1
  queue: DictItemData[]
  index: number
  mode: 'full' | 'cloze'
  input: string
  checked: boolean
  diff: DiffToken[] | null
  blanks: string[]
  results: boolean[]
  wrongItems: DictItemData[]
  round: { offset: number; grand: number }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isStr) : []
}

/** 单选/判断字段：类型不对就用默认值（不让一份快照整体失败）。 */
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function parseQuizQuestion(v: unknown): QuizQuestion | null {
  if (!isObject(v)) return null
  if (!isStr(v.id) || !v.id) return null
  if (!isStr(v.itemId) || !isStr(v.lemma) || !isStr(v.word) || !isStr(v.prompt) || !isStr(v.answer)) return null
  if (!isQuizKind(v.kind)) return null
  const q: QuizQuestion = {
    id: v.id,
    itemId: v.itemId,
    lemma: v.lemma,
    kind: v.kind,
    word: v.word,
    prompt: v.prompt,
    meaning: isStr(v.meaning) ? v.meaning : null,
    partOfSpeech: isStr(v.partOfSpeech) ? v.partOfSpeech : null,
    phonetic: isStr(v.phonetic) ? v.phonetic : null,
    answer: v.answer,
    accept: strArray(v.accept),
  }
  if (v.source === 'vocab' || v.source === 'article') q.source = v.source
  if (isStr(v.context)) q.context = v.context
  if (isStr(v.translation)) q.translation = v.translation
  if (isStr(v.audioText)) q.audioText = v.audioText
  if (Array.isArray(v.options)) q.options = v.options.filter(isStr)
  // accept 为空会让判分永远错：至少把标准答案放进去。
  if (!q.accept.length) q.accept = [q.answer]
  return q
}

export function parseQuizSessionSnapshot(raw: string | null): QuizSessionSnapshot | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(data) || data.v !== 1 || !Array.isArray(data.queue)) return null
  const queue = data.queue.map(parseQuizQuestion).filter((q): q is QuizQuestion => q !== null)
  if (!queue.length) return null

  const results: QuizResultRow[] = Array.isArray(data.results)
    ? data.results
        .filter(
          (r): r is QuizResultRow =>
            isObject(r) && isStr(r.id) && isStr(r.itemId) && typeof r.correct === 'boolean',
        )
        .map((r) => ({ id: r.id, itemId: r.itemId, correct: r.correct }))
    : []
  const rawIndex = isNum(data.index) ? Math.floor(data.index) : 0
  const index = Math.min(Math.max(rawIndex, 0), queue.length)

  return {
    v: 1,
    queue,
    index,
    input: isStr(data.input) ? data.input : '',
    checked: bool(data.checked, false),
    result: typeof data.result === 'boolean' ? data.result : null,
    results,
    autoRun: bool(data.autoRun, false),
  }
}

function parseDiff(v: unknown): DiffToken[] | null {
  if (!Array.isArray(v)) return null
  const out = v.filter(
    (t): t is DiffToken =>
      isObject(t) && (t.type === 'same' || t.type === 'del' || t.type === 'ins') && isStr(t.text),
  )
  return out.length ? out : null
}

function parseDictItem(v: unknown): DictItemData | null {
  if (!isObject(v) || !isStr(v.id) || !v.id || !isStr(v.text)) return null
  const item: DictItemData = { id: v.id, text: v.text }
  if (Array.isArray(v.targets)) item.targets = v.targets.filter(isStr)
  if (isStr(v.src)) item.src = v.src
  if (isNum(v.sw)) item.sw = v.sw
  if (isNum(v.ew)) item.ew = v.ew
  return item
}

export function parseDictSessionSnapshot(raw: string | null): DictSessionSnapshot | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(data) || data.v !== 1 || !Array.isArray(data.queue)) return null
  const queue = data.queue.map(parseDictItem).filter((x): x is DictItemData => x !== null)
  if (!queue.length) return null

  const rawIndex = isNum(data.index) ? Math.floor(data.index) : 0
  const index = Math.min(Math.max(rawIndex, 0), queue.length)
  const round = isObject(data.round) && isNum(data.round.offset) && isNum(data.round.grand)
    ? { offset: data.round.offset, grand: data.round.grand }
    : { offset: 0, grand: 0 }

  return {
    v: 1,
    queue,
    index,
    mode: data.mode === 'cloze' ? 'cloze' : 'full',
    input: isStr(data.input) ? data.input : '',
    checked: bool(data.checked, false),
    diff: parseDiff(data.diff),
    blanks: strArray(data.blanks),
    results: Array.isArray(data.results) ? data.results.map((x) => x === true) : [],
    wrongItems: Array.isArray(data.wrongItems)
      ? data.wrongItems.map(parseDictItem).filter((x): x is DictItemData => x !== null)
      : [],
    round,
  }
}
