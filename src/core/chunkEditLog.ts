/**
 * 手动撕开 / 合并块的「账本」—— 这一篇记过哪些刀口、哪些合并。
 *
 * 两条规则以前埋在 `state/session.ts` 里，靠两行 `filter` 表达，改错了不会报错，
 * 只会「撕开后合并合不上」或「切分计数虚高」：
 *
 *   1. **撕开 = 抵消合并**：一刀正好落在以前某次合并的边界上，就把那条 merge 删掉；
 *   2. **合并 = 撤销撕开**：边界如果是撕开产生的，只删那条 split，**不记 merge**
 *      （否则合并次数虚高，还可能把不相干的块误合）。
 *
 * 时间容差 0.02s：交互是毫秒级的，两次点击很难完全同值。
 */

/** 判定「同一个刀口」的容差（秒） */
export const SAME_EDIT_SEC = 0.02

export interface ChunkEditLog {
  /** 撕开的刀口（音频时间秒） */
  splits: number[]
  /** 合并过的边界（音频时间秒） */
  merges: number[]
}

const near = (a: number, b: number) => Math.abs(a - b) <= SAME_EDIT_SEC

/** 这里有没有记过刀口 / 合并（`resetChunkEdits` 判断「要不要重算」用） */
export function editCount(log: ChunkEditLog): number {
  return log.splits.length + log.merges.length
}

/**
 * 在 `at` 撕一刀。
 * 返回 `null` 表示这条边界已经有了（重复点不重复记）。
 */
export function addSplit(log: ChunkEditLog, at: number): ChunkEditLog | null {
  if (log.splits.some((s) => near(s, at))) return null
  return {
    splits: [...log.splits, at],
    // 这一刀如果正好是以前某次合并的边界，撕开就等于撤销那次合并
    merges: log.merges.filter((m) => !near(m, at)),
  }
}

/**
 * 把 `boundary` 这条边界合并掉（等于删掉两条之间的切分）。
 *
 * 如果它本来是撕开产生的，合并就是**撤销那次撕开**：只删 split、不再记 merge。
 * 这样「撕开 → 合并」能干净回到原样（`chunkEditCount` 归零，界面不会一直挂着
 * 「已手动切分」）。
 *
 * 已知边界情况（保持现状，先记着）：合并 → 撕开 → 再合并，最后一刀被当成「撤销撕开」，
 * 不记 merge，块又会按 VAD 边界裂开。要修得让 store 知道「这条边界是不是 VAD 本来就有的」，
 * 得动 `applyChunkEdits` 的口径，收益不值当 —— 见 TODO「观察项」。
 */
export function mergeAt(log: ChunkEditLog, boundary: number): ChunkEditLog {
  const wasSplit = log.splits.some((s) => near(s, boundary))
  const splits = log.splits.filter((s) => !near(s, boundary))
  const merges = log.merges.filter((m) => !near(m, boundary))
  return { splits, merges: wasSplit ? merges : [...merges, boundary] }
}
