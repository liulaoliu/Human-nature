import { useCallback, useRef, useState } from 'react'
import type { ProductionPrompt } from '../../core/production'
import type { ProductionAttemptSnapshot } from './useProductionAttempt'

export interface UseProductionJumpParams {
  prompts: ProductionPrompt[]
  index: number
  setIndex: (next: number) => void
  /** 当前题的作答快照：跳走之前存一份。 */
  snapshot: () => ProductionAttemptSnapshot
  /** 跳回来时还原那一份。 */
  restore: (snapshot: ProductionAttemptSnapshot) => void
  /** 没有快照（第一次进这题）就清空。 */
  resetAttempt: () => void
  /** 正在批改时不许跳，免得半路的反馈落到别的题上。 */
  grading: boolean
}

/**
 * 快照和已交标记都按「这句原文」记，不按题号 id —— 题号是位置，改完断句就错位了。
 *
 * 原文完全一样时（重复句、模板句）再加一个「同文里的第几个」后缀，
 * 否则两句会共用同一份快照，跳来跳去把答案写串。
 * 界面标「已交」必须用同一个键，所以导出。
 */
export function productionPromptKey(prompts: ProductionPrompt[], at: number): string {
  const prompt = prompts[at]
  if (!prompt) return ''
  const zh = prompt.zh
  let nth = 0
  for (let i = 0; i < at; i++) {
    if (prompts[i]?.zh === zh) nth++
  }
  return nth ? `${zh}\u0000${nth}` : zh
}

/**
 * 断句列表点选跳题。
 *
 * 两件事放在这里，因为它们都只跟「按题号横向移动」有关：
 * 1. 每题留一份作答快照——跳到第 5 句、再跳回第 2 句，写了一半的答案还在；
 * 2. 记下哪些题已经交过——状态标记不能再用「在第几题之前」推断，跳着做之后那个判断就错了。
 */
export function useProductionJump({
  prompts,
  index,
  setIndex,
  snapshot,
  restore,
  resetAttempt,
  grading,
}: UseProductionJumpParams) {
  const cacheRef = useRef(new Map<string, ProductionAttemptSnapshot>())
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(() => new Set<string>())

  const markDone = useCallback((key: string) => {
    if (!key) return
    setDoneIds((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])

  const jumpTo = useCallback(
    (next: number) => {
      if (grading || next === index) return
      const target = prompts[next]
      if (!target) return
      if (prompts[index]) cacheRef.current.set(productionPromptKey(prompts, index), snapshot())
      setIndex(next)
      const cached = cacheRef.current.get(productionPromptKey(prompts, next))
      if (cached) restore(cached)
      else resetAttempt()
    },
    [grading, index, prompts, setIndex, snapshot, restore, resetAttempt],
  )

  /** 新一组开始：快照和已交标记都是这一组的，别带进下一组。 */
  const clear = useCallback(() => {
    cacheRef.current.clear()
    setDoneIds(new Set<string>())
  }, [])

  return { doneIds, markDone, jumpTo, clear }
}
