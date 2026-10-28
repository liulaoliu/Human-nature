import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  beginExtraRound,
  emptyExtraRound,
  groupEndOf,
  planRetryForgot,
  type ExtraRound,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { useStudyGrading } from './useStudyGrading'
import type { StudySpellingRound } from './useStudySpellingRound'

/**
 * 背单词的「队列时序」：组末拼写、卡间切换、装一轮、收尾重练。
 *
 * 从 `useStudySession`（718 行）抽出来。主 hook 仍持有队列 / 指针 / 计数的状态，
 * 这里只负责**什么时候推进、推进到哪、什么情况下先停下拼写**——这几条规则以前散在
 * `advanceFrom` / `forward` / `ackSpellMiss` / `retryForgot` 里，改组末行为要同时找四处。
 *
 * 不碰词库：拼错入账走 `grading`，换卡 UI 重置走 `resetCardUi`，都仍由主 hook 注入。
 */

type SequenceGrading = Pick<
  ReturnType<typeof useStudyGrading>,
  'resetLedger' | 'getForgotIds'
>

export interface UseStudySequenceParams {
  library: VocabLibrary
  queue: VocabItem[] | null
  setQueue: Dispatch<SetStateAction<VocabItem[] | null>>
  index: number
  setIndex: Dispatch<SetStateAction<number>>
  /** 本轮总数（进度分母）——开始时冻结；加练不撑大它。 */
  roundTotal: number
  setRoundTotal: Dispatch<SetStateAction<number>>
  extraRound: ExtraRound
  setExtraRound: Dispatch<SetStateAction<ExtraRound>>
  setRetrying: Dispatch<SetStateAction<boolean>>
  /** 学习模式每组多少词（0 = 跟随范围）。 */
  effectiveGroupSize: number
  /** 组末拼写状态机（主 hook 创建，onDone 由这里返回的 `finishGroup` 接上）。 */
  spellingRound: StudySpellingRound
  grading: SequenceGrading
  flash: (message: string) => void
  resetCardUi: () => void
}

export function useStudySequence({
  library,
  queue,
  setQueue,
  index,
  setIndex,
  roundTotal,
  setRoundTotal,
  extraRound,
  setExtraRound,
  setRetrying,
  effectiveGroupSize,
  spellingRound,
  grading,
  flash,
  resetCardUi,
}: UseStudySequenceParams) {
  /** 正在拼写测试的这一组的组末下标（拼完把 index 推到这里）。 */
  const pendingGroupEndRef = useRef<number | null>(null)
  /** 当前组在队列里的起点（组完成时前移；重开一轮归零）。 */
  const groupCursorRef = useRef(0)

  const resetSession = useCallback(() => {
    setExtraRound(emptyExtraRound())
    grading.resetLedger()
    setRetrying(false)
    groupCursorRef.current = 0
    pendingGroupEndRef.current = null
    spellingRound.reset()
    resetCardUi()
  }, [resetCardUi, spellingRound, grading.resetLedger, setExtraRound, setRetrying])

  /**
   * 推进到下一张卡：到了「每组 N 词」的组末先停下把本组全部词拼一遍，
   * 拼完才由 `finishGroup` 把指针推到组末（Spec 2026-10-22：学多少拼多少）。
   *
   * 加练 / 重练排在 `roundTotal` 之后的卡不触发组末（它们不是这一组的新内容）。
   */
  const advanceFrom = useCallback(
    (from: number) => {
      if (!queue) return
      if (from < roundTotal) {
        const end = groupEndOf(from, roundTotal, effectiveGroupSize)
        if (from + 1 >= end) {
          pendingGroupEndRef.current = end
          spellingRound.begin(queue.slice(groupCursorRef.current, end))
          return
        }
      }
      resetCardUi()
      setIndex(from + 1)
    },
    [queue, roundTotal, effectiveGroupSize, spellingRound, resetCardUi, setIndex],
  )

  /** 装一轮队列：重置账本 → 队列 → 分母 → 指针归零。 */
  const load = useCallback(
    (items: VocabItem[], opts?: { retrying?: boolean }) => {
      resetSession()
      setQueue(items)
      setExtraRound(beginExtraRound(items.map((it) => it.id)))
      setRoundTotal(items.length)
      setRetrying(!!opts?.retrying)
      setIndex(0)
    },
    [resetSession, setQueue, setExtraRound, setRoundTotal, setRetrying, setIndex],
  )

  /** 回滚到上一个单词（不撤销已评分，只回看/再练）。 */
  const back = useCallback(() => {
    if (!queue || index <= 0) return
    resetCardUi()
    setIndex((i) => Math.max(0, i - 1))
  }, [queue, index, resetCardUi, setIndex])

  /** 切到下一个单词（不评分，只切换）；组末会先做拼写测试。 */
  const forward = useCallback(() => {
    if (spellingRound.test || !queue || index >= queue.length) return
    advanceFrom(index)
  }, [queue, index, spellingRound.test, advanceFrom])

  /** 本组拼写全过：把 index 推到组末（下一组的头），最后一组就进入本轮小结。 */
  const finishGroup = useCallback(() => {
    const end = pendingGroupEndRef.current
    if (end == null) return
    pendingGroupEndRef.current = null
    groupCursorRef.current = end
    resetCardUi()
    setIndex(end)
  }, [resetCardUi, setIndex])

  /** 收尾重练本轮点过「忘记了」的词（每轮只发起一次，已练满 3 次的不再进队）。 */
  const retryForgot = useCallback(() => {
    const ids = new Set(grading.getForgotIds())
    const items = library.items.filter((it) => ids.has(it.id))
    if (!items.length) return
    const plan = planRetryForgot(extraRound, items.map((it) => it.id))
    if (plan.blocked) {
      flash('本轮已经重练过忘记的词了')
      return
    }
    setExtraRound(plan.round)
    if (!plan.ids.length) {
      flash('没有可重练的词')
      return
    }
    const keep = new Set(plan.ids)
    const retryItems = items.filter((it) => keep.has(it.id))
    grading.resetLedger()
    setQueue(retryItems)
    setRoundTotal(retryItems.length)
    setRetrying(true)
    setIndex(0)
    resetCardUi()
  }, [
    library.items,
    extraRound,
    flash,
    resetCardUi,
    grading.resetLedger,
    grading.getForgotIds,
    setExtraRound,
    setQueue,
    setRoundTotal,
    setRetrying,
    setIndex,
  ])

  return {
    load,
    advanceFrom,
    finishGroup,
    back,
    forward,
    retryForgot,
    /** 本轮还能不能点「重练忘记的」（每轮只发起一次）。 */
    canRetryForgot: !extraRound.retried,
  }
}

export type StudySequence = ReturnType<typeof useStudySequence>
