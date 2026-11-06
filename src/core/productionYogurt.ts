import type { ProductionDirection, ProductionPrompt } from './production'
import { buildYogurtPromptsFromPairs, type YogurtPair } from './productionPrompts'

/**
 * 风味酸奶的「逐句对子」与会话里 prompt 数组之间的换算。
 *
 * 会话一开始把对子编译成 prompts（`buildYogurtPromptsFromPairs`），此后界面只认 prompts。
 * 但断句是**可以随时改的**（做了一半发现这句应该拆开 / 两句该并成一句），
 * 改完就得重新编译 prompts，同时尽量把「当前这题」留在原处，别让进度乱跳。
 */

export const YOGURT_PROMPT_PREFIX = 'yogurt-'
export const YOGURT_PARAGRAPH_ID = 'yogurt-paragraph'

/** 逐句那一题（整段连写不算对子）。 */
export function isYogurtPairPrompt(prompt: ProductionPrompt): boolean {
  return prompt.id.startsWith(YOGURT_PROMPT_PREFIX) && prompt.id !== YOGURT_PARAGRAPH_ID
}

/** 从会话 prompts 反推逐句对子；整段连写那一题不在里面。 */
export function yogurtPairsOf(prompts: readonly ProductionPrompt[]): YogurtPair[] {
  return prompts
    .filter(isYogurtPairPrompt)
    .map((prompt) => ({ source: prompt.zh, reference: prompt.reference ?? '' }))
}

/** 比对用的键：只忽略首尾和连续空白；标点改动仍算不同一句。 */
export function yogurtTextKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export interface YogurtRemapOptions {
  direction?: ProductionDirection
  paragraph?: boolean
  warning?: string
}

export interface YogurtRemapResult {
  prompts: ProductionPrompt[]
  /** 改完断句后停在第几题：仍然停在同一句上；那句被合并 / 删掉就退到原位置 */
  index: number
  warning: string
}

/**
 * 中途改断句：按新的对子重编译 prompts，并尽量保住当前题号。
 *
 * 定位顺序：先按「当前这题的原文」找同一句 → 找不到（被合并 / 删掉 / 改写了）就退到原下标，
 * 再夹到合法范围。返回 null 表示一对有内容的都没有，界面不该应用这次修改。
 */
export function remapYogurtPrompts(
  oldPrompts: readonly ProductionPrompt[],
  index: number,
  pairs: readonly YogurtPair[],
  { direction = 'zh-en', paragraph = false, warning = '' }: YogurtRemapOptions = {},
): YogurtRemapResult | null {
  const built = buildYogurtPromptsFromPairs(pairs, direction, warning, paragraph)
  if (!built) return null
  const prompts = built.prompts
  const current = oldPrompts[index]
  let next = index
  if (current) {
    if (current.id === YOGURT_PARAGRAPH_ID) {
      const at = prompts.findIndex((prompt) => prompt.id === YOGURT_PARAGRAPH_ID)
      if (at >= 0) next = at
    } else {
      const key = yogurtTextKey(current.zh)
      const at = prompts.findIndex(
        (prompt) => isYogurtPairPrompt(prompt) && yogurtTextKey(prompt.zh) === key,
      )
      if (at >= 0) next = at
    }
  }
  const safe = Math.max(0, Math.min(prompts.length - 1, next))
  return { prompts, index: safe, warning: built.warning }
}
