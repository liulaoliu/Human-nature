import { useMemo, useState } from 'react'
import { buildLangPointItem } from '../../../core/goldenExam'
import type { LangPointChoice } from '../../../core/goldenLangPoint'
import { useGoldenImitation } from '../../hooks/useGoldenImitation'
import type { GoldenLangPointApi } from '../../hooks/useGoldenLangPoint'
import GoldenFeedback from './GoldenFeedback'
import GoldenPasteBox from './GoldenPasteBox'

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

/**
 * 多选里的**一个**语言点作答框（自带一份批改实例）。
 *
 * 每个框独立作答 / 批改 / 存记录（`source = goldenSentence` + `sentenceId` + `task.focus`），
 * 互不影响；序号按勾选顺序来。
 */
export default function GoldenLangPointAnswer({
  point,
  index,
  api,
  showZh,
}: {
  point: LangPointChoice
  index: number
  api: GoldenLangPointApi
  showZh: boolean
}) {
  const [paste, setPaste] = useState('')
  const item = useMemo(
    () => (api.sentence ? buildLangPointItem(api.sentence, point) : null),
    [api.sentence, point],
  )
  const imitation = useGoldenImitation({
    current: item,
    articleId: api.articleId,
    articleTitle: api.articleTitle,
    source: 'goldenSentence',
    setWritingHistory: api.setWritingHistory,
    flash: api.flash,
    recordActivity: api.recordActivity,
  })
  if (!imitation.current) return null
  const no = CIRCLED[index] ?? `${index + 1}.`
  const hasAnswer = !!imitation.answer.trim()
  return (
    <div className="golden-imitation">
      <div className="bar golden-plan-bar">
        <b>{no}</b>
        <span className="muted">
          用「{point.en}」{showZh && point.zh ? `（${point.zh}）` : ''}写一句英文
        </span>
        {point.done && <span className="muted">已练过</span>}
      </div>
      <textarea
        className="study-input golden-exam-input"
        rows={2}
        value={imitation.answer}
        onChange={(e) => imitation.setAnswer(e.target.value)}
        placeholder={
          imitation.round > 1 ? `第 2 稿：照着上面的批改意见改，仍然要用 ${point.en}` : `用 ${point.en} 写一句新的英文…`
        }
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {imitation.round > 1 && (
        <div className="golden-note">第 2 稿：改完再提交一次批改，会和首稿分开记一条。</div>
      )}
      <div className="bar">
        <button className="primary" onClick={imitation.grade} disabled={!hasAnswer || imitation.grading}>
          {imitation.grading ? '批改中…' : '提交 AI 批改'}
        </button>
        <button onClick={imitation.copyGradePrompt} disabled={!hasAnswer}>复制批改提示词</button>
        {imitation.canRewrite && <button onClick={imitation.rewrite}>按批改意见再写一稿</button>}
      </div>
      {imitation.error && <div className="golden-bad">{imitation.error}</div>}
      {imitation.feedback && <GoldenFeedback feedback={imitation.feedback} model={imitation.current.model} />}
      <GoldenPasteBox
        label={`应用 AI 批改结果（${no} ${point.en}）`}
        value={paste}
        onChange={setPaste}
        onApply={() => {
          if (imitation.applyGrade(paste)) setPaste('')
        }}
        placeholder='{"scores":[{"dimension":"词块使用","score":45,"max":50}],"issues":[],"polished":"...","summary":"..."}'
      />
    </div>
  )
}
