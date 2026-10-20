import type { Chunk, Take } from './ports'

/**
 * 录音应该挂在哪一块上。
 *
 * **块号是会变的**：换「切块」档位、手动撕开/合并都会重排块号，所以拿块号存录音
 * 迟早会串——录音还挂在「第 10 块」，实际第 10 块已经是另一段话了，
 * A/B 对比会放出别的段的音。所以新记录同时存**音频时间**，按时间找块。
 *
 * 规则：录音的**起点**落在哪一块，就挂哪一块（拆开长块时等于留在前半块，
 * 后半块需要重新录 —— 符合「每块只留最新一条」的本意）。
 *
 * 老记录没有 `startSec`，只能沿用存下来的块号，并夹进当前合法范围。
 */
export function resolveTakeChunk(take: Take, chunks: Chunk[]): number {
  if (chunks.length === 0) return 0
  const t = take.startSec
  if (typeof t === 'number' && Number.isFinite(t)) {
    for (let i = 0; i < chunks.length; i++) {
      if (t < chunks[i].end) return i
    }
    return chunks.length - 1 // 在最后一块之后：取最后一块
  }
  return Math.min(Math.max(Math.round(take.chunkIndex), 0), chunks.length - 1)
}

/** 块号变了之后，把每条录音按音频时间重新落到块上（没变的那条原样返回，省一次无谓更新） */
export function remapTakes(takes: Take[], chunks: Chunk[]): Take[] {
  if (takes.length === 0) return takes
  return takes.map((t) => {
    const idx = resolveTakeChunk(t, chunks)
    return t.chunkIndex === idx ? t : { ...t, chunkIndex: idx }
  })
}

/**
 * 每块只留最新一条。
 *
 * 同一块只保留最新的一条，够「复读」用就行；老版本给同一块堆了好几条时，
 * 多余的会在加载时清掉。返回按创建时间升序（列表里第 1 条是最早的）。
 */
export function latestTakePerChunk(takes: Take[]): Take[] {
  const latest = new Map<number, Take>()
  for (const t of takes) {
    const prev = latest.get(t.chunkIndex)
    if (!prev || t.createdAt >= prev.createdAt) latest.set(t.chunkIndex, t)
  }
  return [...latest.values()].sort((a, b) => a.createdAt - b.createdAt)
}
