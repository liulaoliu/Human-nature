import { hasLearningData, normalizeLearning, type LearningData } from '../core/learning'
import { learningRepo } from '../adapters/learningRepo'

/**
 * 学习记录在 localStorage 里的同步缓存。
 *
 * SQLite 是耐久主存；这些键仍然保留，是因为现有 UI 大量同步读 localStorage，
 * 首屏不能等异步。启动时先把 SQLite 里“本地没有”的键补回来，之后每次变更
 * 由 `useLearningSync` 防抖写回 SQLite。
 *
 * 这里**只列学习记录**。主题、字号、面板、上次文章、草稿、会话快照等偏好/会话键
 * 不要加进来——它们继续留在 localStorage。
 */
export const LEARNING_KEYS = {
  practice: 'reader:practice',
  mistakes: 'reader:mistakes',
  readDone: 'reader:readDone',
  writingHistory: 'reader:writingHistory',
  retells: 'reader:retells',
  activity: 'reader:activity',
  studyDays: 'reader:studyStats',
  sessions: 'reader:vocabStats',
  studiedDays: 'reader:studiedToday',
  skimmed: 'reader:intensiveSkimmed',
  kindStats: 'reader:kindStats',
} as const

export const LEARNING_KEY_SET: ReadonlySet<string> = new Set(Object.values(LEARNING_KEYS))

export function isLearningKey(key: string | null | undefined): boolean {
  return !!key && LEARNING_KEY_SET.has(key)
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readJson<T>(key: string, fallback: T): T {
  const s = storage()
  if (!s) return fallback
  try {
    const raw = s.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** 从 localStorage 读一份完整学习记录；坏字段由 `normalizeLearning` 过滤。 */
export function readLearningFromLocalStorage(): LearningData {
  return normalizeLearning({
    practice: readJson(LEARNING_KEYS.practice, []),
    mistakes: readJson(LEARNING_KEYS.mistakes, []),
    readDone: readJson(LEARNING_KEYS.readDone, []),
    writingHistory: readJson(LEARNING_KEYS.writingHistory, []),
    retells: readJson(LEARNING_KEYS.retells, []),
    activity: readJson(LEARNING_KEYS.activity, []),
    studyDays: readJson(LEARNING_KEYS.studyDays, []),
    sessions: readJson(LEARNING_KEYS.sessions, []),
    studiedDays: readJson(LEARNING_KEYS.studiedDays, []),
    skimmed: readJson(LEARNING_KEYS.skimmed, []),
    kindStats: readJson(LEARNING_KEYS.kindStats, {}),
  })
}

/**
 * 把学习记录写回 localStorage。
 * `onlyMissing=true` 用于启动恢复：只补本地没有的键，不覆盖本地已有数据。
 */
export function writeLearningToLocalStorage(data: LearningData, onlyMissing = false): void {
  const s = storage()
  if (!s) return
  const values: Record<string, unknown> = {
    [LEARNING_KEYS.practice]: data.practice,
    [LEARNING_KEYS.mistakes]: data.mistakes,
    [LEARNING_KEYS.readDone]: data.readDone,
    [LEARNING_KEYS.writingHistory]: data.writingHistory,
    [LEARNING_KEYS.retells]: data.retells,
    [LEARNING_KEYS.activity]: data.activity,
    [LEARNING_KEYS.studyDays]: data.studyDays,
    [LEARNING_KEYS.sessions]: data.sessions,
    [LEARNING_KEYS.studiedDays]: data.studiedDays,
    [LEARNING_KEYS.skimmed]: data.skimmed,
    [LEARNING_KEYS.kindStats]: data.kindStats,
  }
  for (const [key, value] of Object.entries(values)) {
    try {
      if (onlyMissing && s.getItem(key) !== null) continue
      s.setItem(key, JSON.stringify(value))
    } catch {
      // 配额满 / 隐私模式：保持原样，不能因为恢复缓存把页面搞崩
    }
  }
}

/**
 * 启动时从 SQLite 恢复。
 * 只补 localStorage 缺失的键；本地已有数据优先（离线期间的修改不会被旧服务端数据盖掉）。
 */
export async function hydrateLearningFromServer(): Promise<void> {
  try {
    const data = await learningRepo.load()
    if (!data || !hasLearningData(data)) return
    writeLearningToLocalStorage(data, true)
  } catch {
    // 静态部署 / 服务没起：继续用 localStorage
  }
}

/** 把当前 localStorage 里的学习记录写回 SQLite；失败返回 false，不阻塞 UI。 */
export async function syncLearningToServer(): Promise<boolean> {
  const data = readLearningFromLocalStorage()
  if (!hasLearningData(data)) return false
  try {
    await learningRepo.save(data)
    return true
  } catch {
    return false
  }
}
