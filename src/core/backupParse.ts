/**
 * 备份 / 导入 JSON 的**运行时守卫**（纯函数）。
 *
 * 为什么不在 `useExport` 里做：导入是外部输入，`as` 强转挡不住坏文件；
 * 一条缺 `lemma`/`createdAt` 的词条就能让合并逻辑算出 `undefined` 键，甚至把现有词库弄坏。
 *
 * 规矩（见 AGENTS.md「外部输入必须运行时校验」）：
 *   - 逐段检查，坏条目**丢弃并计数**，不因一条脏数据整份失败；
 *   - 词库交给 `migrateLibrary` 洗（它本身就会丢弃修不出来的条目）；
 *   - 学习记录交给 `normalizeLearning`；
 *   - 返回 `dropped/errors`，界面必须能提示用户。
 */
import type { SavedArticle, VocabLibrary } from '../types/document'
import { isArticleOrigin } from './articleOrigin'
import { normalizeGoldenLesson } from './goldenParse'
import { normalizeLearning, type LearningData } from './learning'
import { migrateLibrary } from './migrations'

export interface ParsedBackup extends Partial<LearningData> {
  articles: SavedArticle[]
  library: VocabLibrary | null
  readGoal?: number
  goalMemo?: string
  /** 被丢弃的条目总数（坏数据 / 修不出来的） */
  dropped: number
  /** 给人看的丢弃原因（去重后） */
  errors: string[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isSentence(v: unknown): boolean {
  return isObject(v) && typeof v.id === 'string' && typeof v.text === 'string'
}

function isArticle(v: unknown): v is SavedArticle {
  if (!isObject(v)) return false
  return (
    typeof v.id === 'string' &&
    !!v.id.trim() &&
    typeof v.updatedAt === 'string' &&
    Array.isArray(v.paragraphs) &&
    Array.isArray(v.sentences) &&
    v.sentences.every(isSentence)
  )
}

/** 老文章可能没有 title/text/createdAt：补默认值，别整篇丢。 */
function sanitizeArticle(a: SavedArticle): SavedArticle {
  const { golden: rawGolden, ...rest } = a as SavedArticle & { golden?: unknown }
  const golden = normalizeGoldenLesson(rawGolden, a.sentences)
  return {
    ...rest,
    title: typeof a.title === 'string' && a.title.trim() ? a.title : '未命名',
    text: typeof a.text === 'string' ? a.text : '',
    sourceKey: typeof a.sourceKey === 'string' || a.sourceKey === null ? a.sourceKey : null,
    // 外部备份里的来源只接受白名单；坏值当未知，不整篇丢。
    origin: isArticleOrigin(a.origin) ? a.origin : undefined,
    // 金句课内容也得过运行时守卫：坏目标/未知句子丢掉，文章本身保留。
    ...(golden ? { golden } : {}),
  }
}

const LEARNING_KEYS = [
  'practice',
  'mistakes',
  'readDone',
  'writingHistory',
  'backTranslations',
  'retells',
  'activity',
  'studyDays',
  'sessions',
  'studiedDays',
  'skimmed',
  'kindStats',
  'answerEvents',
  'goldenDrills',
] as const

type LearningKey = (typeof LEARNING_KEYS)[number]

const LEARNING_LABEL: Record<LearningKey, string> = {
  practice: '练习记录',
  mistakes: '错题',
  readDone: '读完记录',
  writingHistory: '仿写记录',
  backTranslations: '回译记录',
  retells: '复述记录',
  activity: '活动统计',
  studyDays: '背词日统计',
  sessions: '选词会话',
  studiedDays: '每天背过的词',
  skimmed: '略读标记',
  kindStats: '题型统计',
  answerEvents: '答题事件',
  goldenDrills: '金句锤炼记录',
}

function countArray(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

/**
 * 解析导入的 JSON：兼容「全部备份」「词库 JSON」「文章数组」「单篇」。
 * 只返回结构能用的数据；`dropped > 0` 时调用方必须提示。
 */
export function parseBackupPayload(data: unknown): ParsedBackup {
  const out: ParsedBackup = { articles: [], library: null, dropped: 0, errors: [] }
  const drop = (reason: string, n = 1) => {
    if (n <= 0) return
    out.dropped += n
    if (!out.errors.includes(reason)) out.errors.push(reason)
  }

  let obj: Record<string, unknown> | null = null
  if (Array.isArray(data)) {
    if (data.length && isObject(data[0]) && 'sentences' in data[0]) {
      out.articles = data.filter(isArticle).map(sanitizeArticle)
      drop('文章结构不完整', data.length - out.articles.length)
    } else if (data.length && isObject(data[0]) && 'lemma' in data[0]) {
      const lib = migrateLibrary({ schemaVersion: 1, items: data })
      out.library = lib.items.length ? lib : null
      drop('词条缺少必要字段', data.length - lib.items.length)
    }
    return out
  }
  if (!isObject(data)) {
    drop('不是对象也不是数组', 1)
    return out
  }
  obj = data

  // 文章
  if (Array.isArray(obj.articles)) {
    out.articles = obj.articles.filter(isArticle).map(sanitizeArticle)
    drop('文章结构不完整', obj.articles.length - out.articles.length)
  } else if ('sentences' in obj && 'paragraphs' in obj) {
    if (isArticle(obj)) out.articles = [sanitizeArticle(obj)]
    else drop('文章结构不完整', 1)
  } else if (obj.articles !== undefined) {
    drop('articles 不是数组', 1)
  }

  // 词库：整库 / 只有 items
  const rawLib = obj.library ?? (Array.isArray(obj.items) ? data : null)
  if (rawLib !== null) {
    const before = Array.isArray((rawLib as { items?: unknown }).items)
      ? ((rawLib as { items: unknown[] }).items.length)
      : 0
    const lib = migrateLibrary(rawLib)
    // 空词库不导入：防止坏文件/空文件把现有词库清空。
    if (lib.items.length) {
      out.library = lib
      drop('词条缺少必要字段', before - lib.items.length)
    } else {
      drop('词库为空或全部无效，已忽略', before || 1)
    }
  }

  // 学习记录：备份里的老键名映射到 LearningData
  const learningRaw: Record<string, unknown> = {
    practice: obj.practice,
    mistakes: obj.mistakes,
    readDone: obj.readDone,
    writingHistory: obj.writingHistory,
    backTranslations: obj.backTranslations,
    retells: obj.retells,
    activity: obj.activity,
    studyDays: obj.studyDays ?? obj.studyStats,
    sessions: obj.sessions ?? obj.stats,
    studiedDays: obj.studiedDays,
    skimmed: obj.skimmed,
    kindStats: obj.kindStats,
    answerEvents: obj.answerEvents,
    goldenDrills: obj.goldenDrills,
  }
  const normalized = normalizeLearning(learningRaw)
  for (const key of LEARNING_KEYS) {
    const raw = learningRaw[key]
    if (raw === undefined) continue
    if (!Array.isArray(raw) && typeof raw !== 'object') {
      drop(`${LEARNING_LABEL[key]}格式不对`, 1)
      continue
    }
    if (key === 'kindStats') {
      out.kindStats = normalized.kindStats
      const before = isObject(raw) ? Object.keys(raw).length : 0
      const after = Object.keys(normalized.kindStats).length
      drop('题型统计格式不对', before - after)
      continue
    }
    const valid = normalized[key]
    out[key] = valid as never
    drop(`${LEARNING_LABEL[key]}含无效条目`, countArray(raw) - (Array.isArray(valid) ? valid.length : 0))
  }

  if (typeof obj.readGoal === 'number' && Number.isFinite(obj.readGoal) && obj.readGoal >= 0) {
    out.readGoal = obj.readGoal
  } else if (obj.readGoal !== undefined) {
    drop('阅读目标不是有效数字', 1)
  }
  if (typeof obj.goalMemo === 'string') out.goalMemo = obj.goalMemo

  return out
}
