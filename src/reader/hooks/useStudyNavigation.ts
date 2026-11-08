import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { VocabItem } from '../../types/document'

export interface UseStudyNavigationParams {
  queue: VocabItem[] | null
  index: number
  /** 拼写判错还没确认：此时锁住退出 / 上一个 / 下一个。 */
  spellMiss: unknown
  flash: (message: string) => void
  setQueue: Dispatch<SetStateAction<VocabItem[] | null>>
  resetCardUi: () => void
  setIndex: Dispatch<SetStateAction<number>>
  backStep: () => void
  forwardStep: () => void
  recordUnknown: (item: VocabItem) => void
  /** 会话真的关掉之后（恢复被挂起的拷打用）；被拼写判定拦住时不调。 */
  onClosed?: () => void
}

/**
 * 卡片导航：退出 / 上一个 / 下一个 + 拼错未确认时的锁。
 *
 * 「标不认识」也在这里：按「忘记」重置 SRS、打标签、直接跳到下一张；
 * 本轮不重排、不增加本轮总数（与评分是两条显式动作）。
 */
export function useStudyNavigation({
  queue,
  index,
  spellMiss,
  flash,
  setQueue,
  resetCardUi,
  setIndex,
  backStep,
  forwardStep,
  recordUnknown,
  onClosed,
}: UseStudyNavigationParams) {
  const close = useCallback(() => {
    // 拼错后必须先确认「判为不认识」，不给直接退出把这次判罚吞掉
    if (spellMiss) {
      flash('拼错了：先确认「从头重学」，再退出')
      return
    }
    setQueue(null)
    // 从拷打「从头重学」进来的：这里就是用户点的「结束」，恢复原来那一轮
    onClosed?.()
  }, [spellMiss, flash, setQueue, onClosed])

  const back = useCallback(() => {
    if (!spellMiss) backStep()
  }, [spellMiss, backStep])

  const forward = useCallback(() => {
    if (!spellMiss) forwardStep()
  }, [spellMiss, forwardStep])

  const markUnknown = useCallback(() => {
    if (!queue) return
    const queued = queue[index]
    if (!queued) return
    recordUnknown(queued)
    resetCardUi()
    setIndex((i) => i + 1)
  }, [queue, index, recordUnknown, resetCardUi, setIndex])

  return { close, back, forward, markUnknown }
}
