import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProductionPrompt, ProductionSettings } from '../../core/production'
import { pairYogurtTexts, type YogurtPair } from '../../core/productionPrompts'
import { remapYogurtPrompts, yogurtPairsOf } from '../../core/productionYogurt'

export interface UseProductionYogurtPairsParams {
  settings: ProductionSettings
  prompts: ProductionPrompt[]
  index: number
  setPrompts: Dispatch<SetStateAction<ProductionPrompt[]>>
  setIndex: Dispatch<SetStateAction<number>>
}

/**
 * 风味酸奶的逐句对子：拆句预览、对齐编辑、中途改断句。
 *
 * 对子本身是「选草料」与「挤奶」共用的状态，所以放在会话层，不放某个视图的 useState：
 * 拷打页左侧的断句列表直接读会话里的 prompts（`sessionPairs`），
 * 打开编辑器时再从会话拷一份草稿（`beginEdit`），改完 `apply` 才写回会话。
 *
 * 为什么写回要点名 `remapYogurtPrompts`：断句一变 prompt 数组就变了，
 * 但「当前是第几题」必须跟人走，不能因为合并一句话就被打回第一题。
 */
export function useProductionYogurtPairs({
  settings,
  prompts,
  index,
  setPrompts,
  setIndex,
}: UseProductionYogurtPairsParams) {
  const [pairs, setPairs] = useState<YogurtPair[] | null>(null)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')

  const sessionPairs = useMemo(() => yogurtPairsOf(prompts), [prompts])

  const reset = useCallback(() => {
    setPairs(null)
    setWarning('')
    setError('')
  }, [])

  /** 按设置里的两段原文重新拆句（「预览配对」）；返回是否拆出来了。 */
  const preview = useCallback(() => {
    const result = pairYogurtTexts(settings.sourceText, settings.referenceText, settings.yogurtSplit)
    if (!result) {
      setError('两边都要有内容，才能拆句')
      return false
    }
    setPairs(result.pairs)
    setWarning(result.warning)
    setError('')
    return true
  }, [settings.sourceText, settings.referenceText, settings.yogurtSplit])

  /** 打开编辑器：先拷一份会话里现在的断句，改坏了可以直接放弃。 */
  const beginEdit = useCallback(() => {
    setPairs(yogurtPairsOf(prompts))
    setWarning('')
    setError('')
  }, [prompts])

  const updatePair = useCallback((at: number, patch: Partial<YogurtPair>) => {
    setPairs((prev) => prev?.map((pair, i) => (i === at ? { ...pair, ...patch } : pair)) ?? null)
  }, [])

  const movePair = useCallback((at: number, delta: number) => {
    setPairs((prev) => {
      if (!prev) return prev
      const to = at + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[at], next[to]] = [next[to] as YogurtPair, next[at] as YogurtPair]
      return next
    })
  }, [])

  const deletePair = useCallback((at: number) => {
    setPairs((prev) => prev?.filter((_, i) => i !== at) ?? null)
  }, [])

  const mergeNextPair = useCallback((at: number) => {
    setPairs((prev) => {
      if (!prev || at + 1 >= prev.length) return prev
      const current = prev[at]
      const nextPair = prev[at + 1]
      if (!current || !nextPair) return prev
      const next = [...prev]
      next[at] = {
        source: `${current.source} ${nextPair.source}`.trim(),
        reference: `${current.reference} ${nextPair.reference}`.trim(),
      }
      next.splice(at + 1, 1)
      return next
    })
  }, [])

  const splitPair = useCallback((at: number) => {
    setPairs((prev) => {
      const pair = prev?.[at]
      if (!prev || !pair) return prev
      const result = pairYogurtTexts(pair.source, pair.reference, 'sentence')
      if (!result || (result.sourceCount <= 1 && result.referenceCount <= 1)) return prev
      const next = [...prev]
      next.splice(at, 1, ...result.pairs)
      return next
    })
  }, [])

  const addPair = useCallback(() => {
    setPairs((prev) => [...(prev ?? []), { source: '', reference: '' }])
  }, [])

  /** 把编辑结果写回会话；返回是否写回成功（失败时保留草稿并显示 error）。 */
  const apply = useCallback(() => {
    if (!pairs) return false
    const result = remapYogurtPrompts(prompts, index, pairs, {
      direction: settings.yogurtDirection,
      paragraph: settings.yogurtParagraph,
      warning,
    })
    if (!result) {
      setError('至少保留一对有内容的原文 / 参考译文')
      return false
    }
    setPrompts(result.prompts)
    setIndex(result.index)
    setWarning(result.warning)
    setError('')
    return true
  }, [pairs, prompts, index, warning, settings.yogurtDirection, settings.yogurtParagraph, setPrompts, setIndex])

  return {
    /** 编辑中的草稿（null = 还没拆句） */
    pairs,
    setPairs,
    warning,
    error,
    sessionPairs,
    preview,
    beginEdit,
    updatePair,
    movePair,
    deletePair,
    mergeNextPair,
    splitPair,
    addPair,
    apply,
    reset,
  }
}
