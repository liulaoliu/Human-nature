/**
 * 学习记录「重建并核对」的对账逻辑。
 *
 * 服务端 `POST /api/store/learning/rebuild-derived` 会用答题事件（append-only 事实来源）
 * 重建派生聚合（活动热力图 / 题型统计），然后把重建结果返回给前端；
 * 这里负责把它和**本地这份记录**比一遍，告诉用户差在哪。
 *
 * 只比派生聚合，不比整份记录：
 * - 事件是事实来源，`activity` / `kindStats` 才是可能算错、需要重建的东西；
 * - 拿 `practice` / `mistakes` 去比，只会把「本地还没同步」误报成「对不上」，反而吓人。
 *
 * 纯函数，不碰 IO。
 */
import { ACTIVITY_CATS, ACTIVITY_LABEL, type ActivityCat } from './activity'
import type { KindStats, LearningData } from './learning'

/** 一行对账结果（某一类活动，或题型统计的题量/答对）。 */
export interface LearningCheckRow {
  /** 稳定标识（`activity:vocab` / `kind:total` / `kind:correct`），渲染与测试都靠它 */
  key: string
  label: string
  local: number
  server: number
  /** server − local；0 = 一致 */
  diff: number
}

export interface LearningCheckResult {
  rows: LearningCheckRow[]
  /** 只放不一致的行（界面只报这些） */
  mismatched: LearningCheckRow[]
  matched: boolean
  localActivityTotal: number
  serverActivityTotal: number
}

/** 各类活动的总量（本地口径）。 */
export function sumActivityCats(list: LearningData['activity']): Record<ActivityCat, number> {
  const out = Object.fromEntries(ACTIVITY_CATS.map((c) => [c, 0])) as Record<ActivityCat, number>
  for (const day of list) {
    if (!day || !day.counts) continue
    for (const cat of ACTIVITY_CATS) {
      const n = Number(day.counts[cat])
      if (Number.isFinite(n) && n > 0) out[cat] += n
    }
  }
  return out
}

/** 题型统计的总题量与总答对（所有文章相加）。 */
export function sumKindStats(stats: KindStats): { total: number; correct: number } {
  let total = 0
  let correct = 0
  for (const byKind of Object.values(stats ?? {})) {
    if (!byKind || typeof byKind !== 'object') continue
    for (const stat of Object.values(byKind)) {
      const t = Number(stat?.total)
      const c = Number(stat?.correct)
      if (Number.isFinite(t) && t > 0) total += t
      if (Number.isFinite(c) && c > 0) correct += c
    }
  }
  return { total, correct }
}

function row(key: string, label: string, local: number, server: number): LearningCheckRow {
  return { key, label, local, server, diff: server - local }
}

/**
 * 把「本地记录」与「服务端重建后的记录」的派生聚合对一遍。
 * 两条数据都可能是坏输入（本地缓存过期、服务端老库），所以只认数字，不信任形状。
 */
export function compareDerived(local: LearningData, server: LearningData): LearningCheckResult {
  const localCats = sumActivityCats(local?.activity ?? [])
  const serverCats = sumActivityCats(server?.activity ?? [])
  const rows: LearningCheckRow[] = ACTIVITY_CATS.map((cat) =>
    row(`activity:${cat}`, `活动·${ACTIVITY_LABEL[cat]}`, localCats[cat], serverCats[cat]),
  )

  const localKind = sumKindStats(local?.kindStats ?? {})
  const serverKind = sumKindStats(server?.kindStats ?? {})
  rows.push(row('kind:total', '题型·题量', localKind.total, serverKind.total))
  rows.push(row('kind:correct', '题型·答对', localKind.correct, serverKind.correct))

  const mismatched = rows.filter((r) => r.diff !== 0)
  return {
    rows,
    mismatched,
    matched: mismatched.length === 0,
    localActivityTotal: ACTIVITY_CATS.reduce((s, c) => s + localCats[c], 0),
    serverActivityTotal: ACTIVITY_CATS.reduce((s, c) => s + serverCats[c], 0),
  }
}

/** 一句话结论（给 toast / 面板用）。最多列 3 项差异，剩下的折成「等 N 项」。 */
export function describeLearningCheck(result: LearningCheckResult): string {
  if (result.matched) {
    return `核对一致：活动 ${result.serverActivityTotal} 次 · 答题 ${result.rows.find((r) => r.key === 'kind:total')?.server ?? 0} 道`
  }
  const shown = result.mismatched
    .slice(0, 3)
    .map((r) => `${r.label} 本地 ${r.local} / 服务端 ${r.server}`)
    .join('，')
  const rest = result.mismatched.length - 3
  return `核对发现 ${result.mismatched.length} 项不一致：${shown}${rest > 0 ? `，另 ${rest} 项` : ''}`
}
