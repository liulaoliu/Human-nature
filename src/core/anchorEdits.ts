import type { Chunk, ManualAnchor } from './ports'

/**
 * 手动锚点（「这块音频读的是原文这几个词」）在编辑动作里怎么跟着变。
 *
 * 三条规则都是纯算术，但从前提上决定「界面上的绿线画在哪」：
 * - 撕开一块 → 锚点按刀口比例一分为二（不分的话后半块会显示下一块的文字）
 * - 合并两块 → 边界上的锚点并回前一个（不然会留下一个对着不存在边界的锚点）
 * - 微调起点/终点 → 夹在相邻锚点之间，保证词范围有序不重叠
 *
 * 从 `state/session.ts` 抽出来单独测：这些边界条件（范围不足 2 词、
 * 刀口贴着块首、相邻锚点只差 1 词）在界面上很难复现。
 */

/** 两个锚点算「同一个位置」的时间容差（秒）——和 chunkEdits 的刀口容差同一量级 */
const SAME_AT_SEC = 1e-6

/** 锚点在「at 秒」这一刀上拆成两半。词数不足 2 个（拆了也是空的）时返回 null */
export function splitAnchorSpan(
  chunk: Chunk,
  anchor: ManualAnchor,
  words: string[],
  at: number,
): [ManualAnchor, ManualAnchor] | null {
  if (anchor.endWord - anchor.startWord < 2) return null
  const ratio = (at - chunk.start) / Math.max(1e-6, chunk.end - chunk.start)
  const mid = Math.min(
    anchor.endWord - 1,
    Math.max(anchor.startWord + 1, Math.round(anchor.startWord + (anchor.endWord - anchor.startWord) * ratio)),
  )
  return [
    {
      atSec: chunk.start,
      startWord: anchor.startWord,
      endWord: mid,
      text: words.slice(anchor.startWord, mid).join(' '),
    },
    {
      atSec: at,
      startWord: mid,
      endWord: anchor.endWord,
      text: words.slice(mid, anchor.endWord).join(' '),
    },
  ]
}

/**
 * 合并边界时把「正好落在边界上」的锚点并进前一个锚点。
 * 边界上没有锚点 → null（调用方不用改）；边界上是第一个锚点 → 直接去掉它。
 */
export function joinAnchorAt(
  list: ManualAnchor[],
  boundary: number,
  words: string[],
): ManualAnchor[] | null {
  const atBoundary = list.find((a) => Math.abs(a.atSec - boundary) < SAME_AT_SEC)
  if (!atBoundary) return null
  const before = list
    .filter((a) => a.atSec < boundary - SAME_AT_SEC)
    .sort((x, y) => y.atSec - x.atSec)[0]
  let next = list.filter((a) => a !== atBoundary)
  if (before) {
    const end = Math.max(before.endWord, atBoundary.endWord)
    const merged: ManualAnchor = {
      ...before,
      endWord: end,
      text: words.slice(before.startWord, end).join(' '),
    }
    next = next.map((a) => (a === before ? merged : a))
  }
  return next
}

/**
 * 微调锚点的起点或终点：挪 delta 个词，但不许越过相邻锚点，也不许把范围压成空。
 * `prevEnd` 是前一个锚点的终点（没有就 0），`nextStart` 是后一个的起点（没有就总词数）。
 */
export function nudgeAnchorEdge(
  span: { startWord: number; endWord: number },
  edge: 'start' | 'end',
  delta: number,
  prevEnd: number,
  nextStart: number,
): { startWord: number; endWord: number } {
  if (edge === 'start') {
    return {
      startWord: Math.max(prevEnd, Math.min(span.startWord + delta, span.endWord - 1)),
      endWord: span.endWord,
    }
  }
  return {
    startWord: span.startWord,
    endWord: Math.min(nextStart, Math.max(span.endWord + delta, span.startWord + 1)),
  }
}
