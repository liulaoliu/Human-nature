/**
 * 手动撕开 / 合并块：在 VAD 切块结果上再叠一层手动边界。
 *
 * 从 `state/session.ts` 抽出来的原因：这段有**一条容易踩的性能规则**——
 * 新增刀口走「在现有块上套 edits」的快路径（长音频重跑 VAD 要 350ms，连撕十几刀就是几秒），
 * 而合并/撤销必须完整重跑 VAD（见 `rederiveFromEdits` 的注释）。这类取舍和
 * 「加载音频、录音、导航」混在一起很容易被后来人改坏。
 *
 * 边界按**音频时间**记（和锚点一样），所以换「切块」档位后仍认。
 */
import { applyChunkEdits, MIN_PIECE_SEC } from '../core/chunkEdits'
import { addSplit, editCount, mergeAt, type ChunkEditLog } from '../core/chunkEditLog'
import type { Chunk, Granularity } from '../core/ports'
import type { CalibrationLedger } from './calibrationLedger'
import type { AnchorEditor } from './anchorEditor'
import type { SessionState } from './sessionConfig'

/** 块编辑需要的宿主能力 */
export interface ChunkEditHost {
  state(): SessionState
  chunk(): Chunk | null
  cal: CalibrationLedger
  anchors: AnchorEditor
  /** 跑 VAD + 套手动撕合，得到某档粒度下的完整块表 */
  deriveAt(g: Granularity, fileName?: string): Chunk[]
  /** 重算对齐结果与计数（store 的 realign） */
  realign(patch?: Partial<SessionState>): void
}

export class ChunkEditor {
  constructor(private host: ChunkEditHost) {}

  /** 这一篇记过的撕/合（账本形状 → core 认的 `ChunkEditLog`） */
  private editLog(): ChunkEditLog {
    return {
      splits: this.host.cal.splitsOf(this.host.state().fileName),
      merges: this.host.cal.mergesOf(this.host.state().fileName),
    }
  }

  private applyEditLog(log: ChunkEditLog): void {
    const fileName = this.host.state().fileName
    this.host.cal.setSplits(fileName, log.splits)
    this.host.cal.setMerges(fileName, log.merges)
  }

  /** 重跑 VAD + 手动撕合，然后把 current 夹进新块数里，再重算对齐 */
  rederive(patch: Partial<SessionState> = {}): void {
    const g = patch.granularity ?? this.host.state().granularity
    const chunks = this.host.deriveAt(g)
    const current = Math.min(patch.current ?? this.host.state().current, Math.max(0, chunks.length - 1))
    this.host.realign({ ...patch, chunks, current })
  }

  /**
   * 在第 t 秒把当前块撕成两段。t 会被夹进当前块、并离两端留出最小片段。
   * 如果当前块有手动锚点，锚点按刀口比例一分为二 —— 不拆的话后半块会显示出
   * 下一块的文字，更乱；拆开后用户可以再各自微调。
   */
  splitCurrent(t: number): void {
    const c = this.host.chunk()
    if (!c) return
    const lo = c.start + MIN_PIECE_SEC
    const hi = c.end - MIN_PIECE_SEC
    if (hi <= lo) return
    const at = Math.min(Math.max(t, lo), hi)
    const fileName = this.host.state().fileName

    // 「撕 = 抵消合并」「同一刀口不重复记」都在 core/chunkEditLog（有测试）
    const next = addSplit(this.editLog(), at)
    if (!next) return
    this.applyEditLog(next)

    this.host.anchors.splitAtStart(c, at)
    this.host.cal.persist(fileName)
    this.rederiveFromEdits()
  }

  /**
   * 把一次手动切分（撕/合）应用到**现有**块上，不重跑 VAD。
   *
   * `applyChunkEdits` 对已经存在的边界是幂等的（切点正好落在已有边界上时，
   * 两侧都不满足最小片段、不产生新切点），所以在「已经切好的块」上重复套用安全。
   */
  private applyEditsToCurrent(): Chunk[] {
    const fileName = this.host.state().fileName
    return applyChunkEdits(
      this.host.state().chunks,
      this.host.cal.splitsOf(fileName),
      this.host.cal.mergesOf(fileName),
    )
  }

  /**
   * 「撕开」之后的重算：块 = 现有块 + 刀口，然后重跑对齐。
   *
   * 只在**新增刀口**时能用这个快路径。**合并/撤销不行**：把一条 split 从列表里
   * 删掉，并不会让已经切开的两半重新合上（`applyChunkEdits` 只负责加切点、
   * 和删「起点等于某时间」的边界，而撤销之后那条边界已经不在切点列表里了）。
   * 所以 merge/reset 仍走完整重算 —— 它们是低频的纠错操作，代价可以接受。
   */
  private rederiveFromEdits(): void {
    const chunks = this.applyEditsToCurrent()
    this.host.realign({
      chunks,
      current: Math.min(this.host.state().current, Math.max(0, chunks.length - 1)),
    })
  }

  /** 把当前块和下一块合并（等于删掉两条之间的边界）。可以拿来撤销一次撕开 */
  mergeCurrentWithNext(): void {
    const c = this.host.chunk()
    const next = this.host.state().chunks[this.host.state().current + 1]
    if (!c || !next) return
    const boundary = next.start
    const fileName = this.host.state().fileName

    // 「合并 = 撤销撕开」的规则在 core/chunkEditLog（有测试）
    this.applyEditLog(mergeAt(this.editLog(), boundary))
    this.host.anchors.joinAcross(boundary)
    this.host.cal.persist(fileName)
    this.rederive() // 撤销要真正合上两半，必须从 VAD 结果重算（见 rederiveFromEdits）
  }

  /** 清掉这一篇全部手动撕/合，回到纯 VAD 切块（这个必须重跑 VAD：要把刀口全丢掉） */
  reset(): void {
    const fileName = this.host.state().fileName
    if (editCount(this.editLog()) === 0) return
    this.host.cal.clearEdits(fileName)
    this.host.cal.persist(fileName)
    this.rederive()
  }
}
