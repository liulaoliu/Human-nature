import { useState } from 'react'
import type { GoldenImitationApi } from '../../hooks/useGoldenImitation'
import GoldenAttemptsPager from './GoldenAttemptsPager'
import GoldenFeedback from './GoldenFeedback'
import GoldenPasteBox from './GoldenPasteBox'

/**
 * 每句遣词造句走完后的单句仿写：用当前句的句型/中文提示写一句新的，
 * 批改口径与整课考试完全一致；不写就过不去，但 AI 不可用时可粘贴结果。
 */
export default function GoldenSentenceImitation({
  imitation,
  nextLabel,
  onNext,
}: {
  imitation: GoldenImitationApi
  nextLabel: string
  onNext: () => void
}) {
  const [paste, setPaste] = useState('')
  const current = imitation.current
  const hasAnswer = !!imitation.answer.trim()

  if (!current) {
    return (
      <div className="golden-preview">
        <div className="muted">本句没有可迁移的句型，直接进入下一步。</div>
        <div className="bar">
          <button className="primary" onClick={onNext}>{nextLabel}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="golden-imitation">
      <div className="golden-preview">
        <div className="muted">
          本句流程已走完。现在换一个主语或场景，用同一句型仿写一句英文；不要照抄范句。
        </div>
        <div className="golden-en golden-exam-task">{current.task}</div>
        {current.structure && <div className="golden-note">目标结构：{current.structure}</div>}
        {current.mustUse.length > 0 && (
          <div className="golden-note">必须用上：{current.mustUse.join('、')}</div>
        )}
      </div>

      <textarea
        className="study-input golden-exam-input"
        rows={4}
        value={imitation.answer}
        onChange={(e) => imitation.setAnswer(e.target.value)}
        placeholder={imitation.round > 1 ? '第 2 稿：照着上面的批改意见改…' : '写一句新的英文句子…'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      {imitation.round > 1 && (
        <div className="golden-note">第 2 稿：改完再提交一次批改，会和首稿分开记一条。</div>
      )}

      <div className="bar">
        <button className="primary" onClick={() => void imitation.grade()} disabled={!hasAnswer || imitation.grading}>
          {imitation.grading ? '批改中…' : '提交 AI 批改'}
        </button>
        <button onClick={() => void imitation.copyGradePrompt()} disabled={!hasAnswer}>复制批改提示词</button>
        {imitation.canRewrite && <button onClick={imitation.rewrite}>按批改意见再写一稿</button>}
        <button className="primary" onClick={onNext} disabled={!hasAnswer}>
          {nextLabel}
        </button>
      </div>

      {imitation.error && <div className="golden-bad">{imitation.error}</div>}
      <GoldenAttemptsPager imitation={imitation} />
      {imitation.viewing && <div className="golden-note">当时的作答：{imitation.viewing.text}</div>}
      {(imitation.viewing?.feedback ?? imitation.feedback) && (
        <GoldenFeedback feedback={imitation.viewing?.feedback ?? imitation.feedback!} model={current.model} />
      )}

      <GoldenPasteBox
        label="应用 AI 批改结果（JSON）"
        value={paste}
        onChange={setPaste}
        onApply={() => {
          if (imitation.applyGrade(paste)) setPaste('')
        }}
        placeholder='{"scores":[{"dimension":"结构运用","score":30,"max":35}],"issues":[],"polished":"...","summary":"..."}'
      />
    </div>
  )
}
