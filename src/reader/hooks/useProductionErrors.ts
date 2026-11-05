import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { AnswerEvent } from '../../core/answerEvents'
import type { WritingRecord } from '../../core/writing'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import { syncWritingErrorProgress } from '../../core/writingErrorProgress'
import { collectWritingErrorCards } from '../../core/writingErrorReview'

export interface UseProductionErrorsParams {
  records: readonly WritingRecord[]
  writingErrorProgress?: readonly WritingErrorProgress[]
  setWritingErrorProgress?: Dispatch<SetStateAction<WritingErrorProgress[]>>
  answerEvents?: readonly AnswerEvent[]
  now?: () => Date
}

/**
 * 产出批改也进错因复习：must-fix 错因补 `writing_error_progress` 一行，
 * 和仿写 / 金句课共用同一套复习卡，不再散落在产出历史里。
 */
export function useProductionErrors({
  records,
  writingErrorProgress = [],
  setWritingErrorProgress,
  answerEvents = [],
  now = () => new Date(),
}: UseProductionErrorsParams): void {
  const cards = useMemo(() => collectWritingErrorCards(records, { scope: 'all' }), [records])

  useEffect(() => {
    if (!setWritingErrorProgress || !cards.length) return
    const { next, added, changed } = syncWritingErrorProgress(
      writingErrorProgress,
      cards,
      now().toISOString(),
      answerEvents,
    )
    if (added || changed) setWritingErrorProgress(next)
  }, [cards, writingErrorProgress, setWritingErrorProgress, answerEvents, now])
}
