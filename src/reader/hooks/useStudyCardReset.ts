import { useCallback, useRef } from 'react'

export interface StudyCardResetParams {
  /** 卡面开关：翻面 / 输入 / 已检查 / 门禁 / 押后的评分。 */
  resetFlags: () => void
  setEditOpen: (open: boolean) => void
  setDraft: (draft: null) => void
  setDelArmed: (armed: boolean) => void
}

/**
 * 换卡时统一清掉卡片级状态：卡面开关、编辑草稿、拼写判错、学习四选项、复习三键。
 *
 * 三个子状态的 reset 由各自的 hook 稍后注册（这里用 ref 存引用），
 * 所以 `resetCardUi` 的引用保持稳定，可以安全地放进其它 hook 的依赖数组。
 */
export function useStudyCardReset({
  resetFlags,
  setEditOpen,
  setDraft,
  setDelArmed,
}: StudyCardResetParams) {
  const spellGateReset = useRef<() => void>(() => {})
  const learnReset = useRef<() => void>(() => {})
  const reviewReset = useRef<() => void>(() => {})

  const resetCardUi = useCallback(() => {
    resetFlags()
    setEditOpen(false)
    setDraft(null)
    setDelArmed(false)
    spellGateReset.current()
    learnReset.current()
    reviewReset.current()
    // 四个 setter 都是 useState 的 setter，引用恒定；列全依赖后不再需要豁免。
  }, [resetFlags, setEditOpen, setDraft, setDelArmed])

  return {
    resetCardUi,
    /** 子 hook 每次渲染把最新的 reset 注册进来；换卡时统一调用。 */
    registerSpellGateReset: (fn: () => void) => {
      spellGateReset.current = fn
    },
    registerLearnReset: (fn: () => void) => {
      learnReset.current = fn
    },
    registerReviewReset: (fn: () => void) => {
      reviewReset.current = fn
    },
  }
}
