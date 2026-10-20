import { joinAnchorAt, nudgeAnchorEdge, splitAnchorSpan } from '../core/anchorEdits'
import type { Chunk, ManualAnchor } from '../core/ports'
import type { CalibrationLedger } from './calibrationLedger'

/**
 * 「手动锚点」的增删改 —— 也就是「这一块的音频对应原文哪几个词」这件事。
 *
 * 从 `state/session.ts` 抽出来的原因：这些方法原来都在 store 里，但**没有一处用到
 * 播放/录音的时序**，全是「找出当前块那条锚点 → 按 core 的规则算出新范围 → 写回账本 →
 * 落盘」。留在 store 里会把它撑到 900 行，也让「撕开时锚点怎么拆」这种规则只能靠读
 * 大文件才看得见。
 *
 * 规则本身仍在 `core/anchorEdits`（纯算术、有测试）；这里只负责「跟账本打交道」：
 * 当前是哪一篇、当前是哪一块、改完记得存。
 */
export interface AnchorEditorHost {
  /** 这一篇的校准账本 */
  cal: CalibrationLedger
  /** 当前文件名（账本的键） */
  fileName(): string
  /** 当前词表（空格切好的） */
  words(): string[]
  /** 当前块（没加载 / 越界时为 null） */
  chunk(): Chunk | null
  /** 当前块在自动对齐结果里的词范围（这块还没锚定时，拿它当起点钉一个） */
  alignedWordRange(chunkIndex: number): [number, number] | null
  /** 改完落盘（账本自己的持久化形状由它决定） */
  persist(): void
}

/** 同一个时刻只留一个锚点：判断两条锚点是不是同一块靠这个容差 */
const SAME_SEC = 1e-6

export class AnchorEditor {
  constructor(private host: AnchorEditorHost) {}

  private list(): ManualAnchor[] {
    return this.host.cal.anchorsOf(this.host.fileName())
  }

  private save(next: ManualAnchor[]): void {
    this.host.cal.setAnchors(this.host.fileName(), next)
    this.host.persist()
  }

  /**
   * 鼠标选字定块：把「当前这一块的音频」绑到原文的 [startWord, endWord) 上。
   * 同时记下这段文字，改文本后靠它在新词表里重新定位。
   * 重选就覆盖（同一时刻只留一个锚点）。
   */
  setWords(startWord: number, endWord: number): boolean {
    const c = this.host.chunk()
    if (!c) return false
    const s = Math.min(startWord, endWord)
    const e = Math.max(startWord, endWord)
    if (e <= s) return false
    const words = this.host.words()
    const kept = this.list().filter((a) => Math.abs(a.atSec - c.start) > SAME_SEC)
    this.save([...kept, { atSec: c.start, startWord: s, endWord: e, text: words.slice(s, e).join(' ') }])
    return true
  }

  /**
   * 微调当前块锚点的开头或结尾。
   * 当前块还没锚定就先按现在的对齐结果钉一个，再挪；夹在相邻锚点之间（规则在 core）。
   */
  nudge(edge: 'start' | 'end', delta: number): boolean {
    const c = this.host.chunk()
    if (!c) return false
    const words = this.host.words()
    const total = words.length
    if (total === 0) return false

    const list = [...this.list()]
    if (!list.some((a) => Math.abs(a.atSec - c.start) < SAME_SEC)) {
      const wr = this.host.alignedWordRange(c.index)
      if (!wr || wr[1] <= wr[0]) return false
      list.push({ atSec: c.start, startWord: wr[0], endWord: wr[1], text: '' })
    }

    const sorted = list.sort((a, b) => a.atSec - b.atSec)
    const pos = sorted.findIndex((a) => Math.abs(a.atSec - c.start) < SAME_SEC)
    const cur = sorted[pos]
    const prev = sorted[pos - 1]
    const next = sorted[pos + 1]
    const moved = nudgeAnchorEdge(cur, edge, delta, prev ? prev.endWord : 0, next ? next.startWord : total)
    sorted[pos] = {
      atSec: cur.atSec,
      startWord: moved.startWord,
      endWord: moved.endWord,
      text: words.slice(moved.startWord, moved.endWord).join(' '),
    }
    this.save(sorted)
    return true
  }

  /** 去掉当前块的锚点（其余锚点不动） */
  clearHere(): boolean {
    const c = this.host.chunk()
    if (!c) return false
    const list = this.list()
    const next = list.filter((a) => Math.abs(a.atSec - c.start) > SAME_SEC)
    if (next.length === list.length) return false
    this.save(next)
    return true
  }

  /** 清掉这一篇全部手动锚点，回到自动估计 */
  clearAll(): boolean {
    const fileName = this.host.fileName()
    if (this.host.cal.anchorsOf(fileName).length === 0) return false
    this.host.cal.clearAnchors(fileName)
    this.host.persist()
    return true
  }

  /** 撕开块时：块起点上那条锚点按刀口比例拆成两个（两半的词都留着） */
  splitAtStart(chunk: Chunk, at: number): boolean {
    const list = this.list()
    const i = list.findIndex((a) => Math.abs(a.atSec - chunk.start) < SAME_SEC)
    if (i < 0) return false
    const halves = splitAnchorSpan(chunk, list[i], this.host.words(), at)
    if (!halves) return false
    const next = [...list]
    next.splice(i, 1, ...halves)
    this.save(next)
    return true
  }

  /** 合并边界时：紧挨着边界前后的两条锚点重新并成一个 */
  joinAcross(boundary: number): boolean {
    const next = joinAnchorAt(this.list(), boundary, this.host.words())
    if (!next) return false
    this.save(next)
    return true
  }
}
