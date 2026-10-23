/**
 * 产出看板：把**产出性**学习（词块 / 搭配 / 习语 / 仿写 / 复述）量化成看得见的分数与指标。
 *
 * 为什么单开一个：泛读（速读）练的是「接受性理解」，光通读容易「自我感动」；
 * 真正决定水平的是**产出**和**词块**。这里把这几项都算成 0–100 的数字，
 * 权重也偏向产出，避免「读得多但说不出」。
 *
 * 纯函数，UI 只负责画。
 */

export interface KindStat {
  total: number
  correct: number
}

export interface OutputInput {
  /** 词块类题型（搭配填空 / 搭配默写 / 介词填空 / 习语填空）的总计。 */
  chunkStats: KindStat
  /** 语言点类题型（词组/习语填空 / 结构语法 / 功能词 / 排序 / 翻译）的总计。 */
  grammarStats: KindStat
  /** 本篇生词：总数 / 有词块 / 学过 / 稳定。 */
  words: { total: number; withChunks: number; studied: number; stable: number }
  /** 仿写：条数 + 平均分（0–100，没批改过则 null）。 */
  writes: { count: number; avgScore: number | null }
  /** 复述：条数 + 总词数。 */
  retells: { count: number; words: number }
  /** 连续学习天数。 */
  streak: number
}

export interface OutputRow {
  key: string
  label: string
  /** 展示值（已格式化） */
  value: string
  /** 0–100，用于色阶 */
  level: number
  detail: string
  /** 达标（绿） */
  good: boolean
}

export interface OutputBoard {
  /** 0–100 产出分（越靠产出/词块） */
  score: number
  grade: string
  rows: OutputRow[]
  /** 下一步（一句） */
  next: string
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const pct = (a: number, b: number): number => (b > 0 ? clamp(Math.round((a / b) * 100)) : 0)

function gradeOf(score: number): string {
  if (score < 25) return '还没产出'
  if (score < 50) return '在练'
  if (score < 75) return '有产出'
  return '实打实'
}

/** 由当前数据算产出看板。 */
export function buildOutputBoard(i: OutputInput): OutputBoard {
  const w = i.words
  const chunkAcc = i.chunkStats.total > 0 ? pct(i.chunkStats.correct, i.chunkStats.total) : 0
  const grammarAcc = i.grammarStats.total > 0 ? pct(i.grammarStats.correct, i.grammarStats.total) : 0
  const chunkCover = w.total > 0 ? pct(w.withChunks, w.total) : 0
  const memory = w.total > 0 ? Math.round(pct(w.studied, w.total) * 0.6 + pct(w.stable, w.total) * 0.4) : 0
  // 仿写：**没批改过的一律不给分**。以前没批改按 70 算，而 `good` 又按 0 算，
  // 同一行两个口径 —— 看板说「有 70 分」，行上却永远不达标。
  const write =
    i.writes.count <= 0
      ? 0
      : Math.round(pct(Math.min(i.writes.count, 4), 4) * 0.45 + (i.writes.avgScore ?? 0) * 0.55)
  const retell =
    i.retells.count <= 0
      ? 0
      : Math.round(pct(Math.min(i.retells.count, 3), 3) * 0.45 + pct(Math.min(i.retells.words, 120), 120) * 0.55)
  const streak = pct(Math.min(i.streak, 7), 7)

  const score = Math.round(
    clamp(
      0.24 * chunkAcc +
        0.1 * grammarAcc +
        0.2 * write +
        0.16 * retell +
        0.14 * chunkCover +
        0.1 * memory +
        0.06 * streak,
    ),
  )

  const rows: OutputRow[] = [
    {
      key: 'chunkAcc',
      label: '词块 / 搭配正确率',
      value: i.chunkStats.total > 0 ? `${chunkAcc}%（${i.chunkStats.correct}/${i.chunkStats.total}）` : '还没测过',
      level: chunkAcc,
      detail: '搭配填空 · 搭配默写 · 介词填空 · 习语填空',
      good: i.chunkStats.total > 0 && chunkAcc >= 80,
    },
    {
      key: 'grammarAcc',
      label: '语法 / 结构正确率',
      value:
        i.grammarStats.total > 0 ? `${grammarAcc}%（${i.grammarStats.correct}/${i.grammarStats.total}）` : '还没测过',
      level: grammarAcc,
      detail: '词组/习语填空 · 结构语法 · 功能词 · 排序 · 翻译',
      good: i.grammarStats.total > 0 && grammarAcc >= 80,
    },
    {
      key: 'chunkCover',
      label: '词块覆盖',      value: w.total > 0 ? `${w.withChunks}/${w.total}` : '—',
      level: chunkCover,
      detail: '本篇生词里已有词组/搭配的比例',
      good: w.total > 0 && chunkCover >= 80,
    },
    {
      key: 'write',
      label: '仿写',
      value:
        i.writes.count > 0
          ? `${i.writes.count} 条${i.writes.avgScore != null ? ` · 均分 ${i.writes.avgScore}` : ' · 待批改'}`
          : '0 条',
      level: write,
      detail: '自己写 + AI 批改才算',
      good: i.writes.count > 0 && (i.writes.avgScore ?? 0) >= 75,
    },
    {
      key: 'retell',
      label: '复述',
      value: i.retells.count > 0 ? `${i.retells.count} 条 · ${i.retells.words} 词` : '0 条',
      level: retell,
      detail: '用自己的话把这段讲一遍',
      good: i.retells.count >= 1,
    },
    {
      key: 'memory',
      label: '记忆（接受性）',
      value: w.total > 0 ? `学过 ${w.studied}/${w.total} · 稳定 ${w.stable}` : '—',
      level: memory,
      detail: '只作基础分；产出才是重点',
      good: w.total > 0 && memory >= 70,
    },
    {
      key: 'streak',
      label: '连续天数',
      value: `${i.streak} 天`,
      level: streak,
      detail: '连续有学习记录的天数',
      good: i.streak >= 3,
    },
  ]

  let next: string
  if (w.total === 0) next = '先建生词（选词 / 自动标词），产出才有原料'
  else if (i.chunkStats.total === 0) next = '做一轮「🧩 词块拷打」，才有词块正确率可看'
  else if (i.writes.count === 0) next = '仿写 1 句并让 AI 批改 —— 产出才真正算涨'
  else if (i.retells.count === 0) next = '复述一遍这段（能说出来才算真懂）'
  else if (chunkAcc < 75) next = '搭配正确率还偏低，再来一轮「词块拷打」，专攻错的那几条'
  else if (memory < 60) next = '还有词没学 / 不稳，回「背单词」清一轮到期'
  else next = '词块 · 产出 · 记忆都在线，隔天复习即可 ✅'

  return { score, grade: gradeOf(score), rows, next }
}
