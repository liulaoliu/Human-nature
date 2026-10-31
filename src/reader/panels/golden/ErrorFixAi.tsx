import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { errorFixExamItem, type WritingErrorCard } from '../../../core/writingErrorReview'
import type { ActivityCat } from '../../../core/activity'
import type { WritingRecord } from '../../../core/writing'
import { useGoldenImitation } from '../../hooks/useGoldenImitation'
import GoldenAttemptsPager from './GoldenAttemptsPager'
import GoldenFeedback from './GoldenFeedback'
import GoldenPasteBox from './GoldenPasteBox'

/**
 * 错因复习里的 AI 批改：复用单句仿写的批改/解析/存历史链路。
 *
 * 和仿写一样写进 `WritingRecord`（source='goldenError'），所以学习历史、备份、
 * 导出都能直接回看；它只做更细的批改，不改变本地检查决定的复习间隔。
 */
export default function ErrorFixAi({
  card,
  answer,
  articleTitle,
  writingHistory,
  setWritingHistory,
  flash,
  recordActivity,
}: {
  card: WritingErrorCard
  answer: string
  articleTitle?: string
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}) {
  const [paste, setPaste] = useState('')
  const current = useMemo(() => errorFixExamItem(card), [card])
  const imitation = useGoldenImitation({
    current,
    articleId: card.articleId,
    articleTitle: articleTitle ?? card.articleTitle ?? '',
    source: 'goldenError',
    setWritingHistory,
    writingHistory,
    flash,
    recordActivity,
  })
  const hasAnswer = !!answer.trim()
  const feedback = imitation.viewing?.feedback ?? imitation.feedback

  return (
    <div className="golden-error-ai">
      <div className="golden-note">
        错因订正也可以交给 AI 细看；批改记录会进「学习历史」，不改变本地判定的复习间隔。
      </div>
      <div className="bar">
        <button
          type="button"
          className="primary"
          onClick={() => void imitation.grade(answer)}
          disabled={!hasAnswer || imitation.grading}
        >
          {imitation.grading ? 'AI 批改中…' : 'AI 批改（记入学习历史）'}
        </button>
        <button type="button" onClick={() => void imitation.copyGradePrompt(answer)} disabled={!hasAnswer}>
          复制批改提示词
        </button>
      </div>
      {imitation.error && <div className="golden-bad">{imitation.error}</div>}
      <GoldenAttemptsPager imitation={imitation} />
      {imitation.viewing && <div className="golden-note">当时的订正：{imitation.viewing.text}</div>}
      {feedback && <GoldenFeedback feedback={feedback} model={current.model} />}
      <GoldenPasteBox
        label="应用 AI 批改结果（错因订正）"
        value={paste}
        onChange={setPaste}
        onApply={() => {
          if (imitation.applyGrade(paste, answer)) setPaste('')
        }}
        placeholder='{"scores":[{"dimension":"错因修正","score":100,"max":100}],"issues":[],"polished":"...","summary":"..."}'
        defaultOpen={false}
      />
    </div>
  )
}
