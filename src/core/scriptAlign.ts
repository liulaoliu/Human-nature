import {
  alignTextToChunks,
  alignTextToChunksWithAnchors,
  resolveAnchors,
  type AlignedChunk,
  type ResolvedAnchor,
} from './alignText'
import type { Chunk, ManualAnchor } from './ports'

/**
 * 「这篇原文该怎么摊到这些块上」的选择规则。
 *
 * `alignText.ts` 只管算法本身（按比例摊 / 按锚点摊），但**什么时候用哪种**
 * 一直是埋在 `state/session.ts` 里的 if/else：有手动锚点就用锚点、否则跳过
 * 正文之前的引子块再按比例摊。这条规则改错，界面就会「高亮整篇错位」，
 * 所以挪出来当纯函数，单独测。
 */

/** 原文按空格切词（和 `alignText` 内部同一套口径：trim 后按空白切） */
export function scriptWords(script: string): string[] {
  return script.trim() ? script.trim().split(/\s+/).filter(Boolean) : []
}

export interface ScriptLayout {
  script: string
  chunks: Chunk[]
  /** 这一篇的手动锚点（鼠标选字定下来的） */
  anchors?: ManualAnchor[]
  /** 正文从第几块开始（音频前面常有文本里没有的引子） */
  textStartChunk?: number
  /** 词窗整体平移多少个词 */
  offsetWords?: number
}

/**
 * 把原文摊到各块上。
 *
 * - 有手动锚点 → 以锚点为准，`textStartChunk` / `offsetWords` 让位（锚点比估的准）；
 * - 没锚点 → 前 `textStartChunk` 块留空，剩下的按块时长比例摊，再整体平移 `offsetWords`。
 *
 * 两条路都保证「拼起来 = 原文词序」，一个词不丢不重。
 */
export function alignScript(layout: ScriptLayout): AlignedChunk[] {
  const { script, chunks } = layout
  const anchors = layout.anchors ?? []
  if (!script.trim()) return []
  if (anchors.length > 0) return alignTextToChunksWithAnchors(script, chunks, anchors)

  // 音频前面可能有文本里没有的引子（播报员的开场之类），
  // 那样第一句正文其实出现在第 k 块。标了就从第 k 块开始摊词，
  // 前面的块空着 —— 词一个不丢，而且摊的区间更贴近真实朗读区间。
  const n = chunks.length
  const skip = n === 0 ? 0 : Math.min(Math.max(layout.textStartChunk ?? 0, 0), n - 1)
  const head: AlignedChunk[] = chunks.slice(0, skip).map((c) => ({
    index: c.index,
    text: '',
    wordRange: [0, 0] as [number, number],
  }))
  return [...head, ...alignTextToChunks(script, chunks.slice(skip), layout.offsetWords ?? 0)]
}

/**
 * 锚点 → 「哪一块对应哪几个词」。界面用它在原文上标开头/结尾。
 * 没锚点、没块、没文本时都是空数组（界面按「未锚定」显示）。
 */
export function resolveScriptAnchors(layout: ScriptLayout): ResolvedAnchor[] {
  const anchors = layout.anchors ?? []
  if (anchors.length === 0 || layout.chunks.length === 0) return []
  const words = scriptWords(layout.script)
  if (words.length === 0) return []
  return resolveAnchors(words, layout.chunks, anchors)
}
