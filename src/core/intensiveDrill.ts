/**
 * 精读面板「快速拷打」的种类与每次题数。
 *
 * 七种入口各自一个数：记忆 / 词块 / 英英释义 / 语法标记 / 语法·结构 / 听力 / 错题包围战。
 * 默认都是 10，用户点开入口后自己选；选择分别持久化，互不影响。
 *
 * 纯数据 / 纯函数，不碰 React / 存储；设置存取在 `reader/hooks/useQuizSettings`。
 */

/** 七种拷打入口；`siege` 是错题包围战（按词挑，不直接映射一组 QuizKind）。 */
export type DrillKind = 'memory' | 'chunk' | 'deep' | 'mark' | 'grammar' | 'listen' | 'siege'

/** 走考试引擎的六种（排除错题包围战）。 */
export type QuizDrillKind = Exclude<DrillKind, 'siege'>

export const QUIZ_DRILL_KINDS: readonly QuizDrillKind[] = [
  'memory',
  'chunk',
  'deep',
  'mark',
  'grammar',
  'listen',
]

export const DRILL_KINDS: readonly DrillKind[] = [...QUIZ_DRILL_KINDS, 'siege']

/** 可选档位；默认值必须包含在内，界面下拉永远有对应选项。 */
export const DRILL_LIMIT_OPTIONS = [5, 10, 15, 20, 30] as const

export const DEFAULT_DRILL_LIMIT = 10

export type DrillLimits = Record<DrillKind, number>

export const DEFAULT_DRILL_LIMITS: DrillLimits = {
  memory: DEFAULT_DRILL_LIMIT,
  chunk: DEFAULT_DRILL_LIMIT,
  deep: DEFAULT_DRILL_LIMIT,
  mark: DEFAULT_DRILL_LIMIT,
  grammar: DEFAULT_DRILL_LIMIT,
  listen: DEFAULT_DRILL_LIMIT,
  siege: DEFAULT_DRILL_LIMIT,
}

/**
 * 是不是合法档位（数字 / 数字字符串都认）。
 * `null` / 空串 / 布尔 / 小数 / 不在档位里的数都不算。
 */
export function isDrillLimit(raw: unknown): raw is number | string {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return (DRILL_LIMIT_OPTIONS as readonly number[]).includes(n)
}

/** 把外部输入收敛到合法档位；坏数据一律回默认 10。 */
export function normalizeDrillLimit(raw: unknown): number {
  return isDrillLimit(raw) ? Number(raw) : DEFAULT_DRILL_LIMIT
}

/**
 * 解析 `reader:drillLimits` 里的对象：只认七种入口，缺的 / 坏的各自回默认 10。
 * 不返回 `null`：坏数据最多丢设置，不能让整个词库或面板进不去。
 */
export function parseDrillLimits(raw: unknown): DrillLimits {
  const limits = { ...DEFAULT_DRILL_LIMITS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return limits
  const obj = raw as Record<string, unknown>
  for (const kind of DRILL_KINDS) {
    if (isDrillLimit(obj[kind])) limits[kind] = Number(obj[kind])
  }
  return limits
}
