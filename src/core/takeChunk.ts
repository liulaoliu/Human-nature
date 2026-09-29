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
