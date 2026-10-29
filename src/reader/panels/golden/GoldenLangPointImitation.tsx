import { useState } from 'react'
import type { GoldenLangPointApi } from '../../hooks/useGoldenLangPoint'
import { useLocalStorageState } from '../../hooks/useLocalStorageState'
import GoldenFeedback from './GoldenFeedback'
import GoldenPasteBox from './GoldenPasteBox'
import { langPointKey } from '../../../core/goldenLangPoint'

/**
 * 本句的「语言点造句」：整句仿写之外的额外练习，只要求用上一个词块。
 *
 * 可选、不阻塞「下一句」；记录进 writingHistory（source = goldenSentence + focus），
 * 不影响句子的掌握进度。中文显示走本机偏好 `reader:goldenLangZh`（默认开）。
 */
export default function GoldenLangPointImitation({ langPoint }: { langPoint: GoldenLangPointApi }) {
  const [showZh, setShowZh] = useLocalStorageState<boolean>('reader:goldenLangZh', true)
  const [paste, setPaste] = useState('')
  const { choices, active, select, imitation } = langPoint
  const current = imitation.current
  if (!choices.length || !current) return null

  const hasAnswer = !!imitation.answer.trim()
  const pickedKey = active ? langPointKey(active) : ''

  return (
    <div className="golden-imitation">
      <div className="golden-preview">
        <div className="bar golden-plan-bar">
          <b>还是单独练一个语言点？</b>
          <span className="muted">本句 {choices.length} 个</span>
          <button
            onClick={() => setShowZh((v) => !v)}
            title={showZh ? '隐藏中文释义' : '显示中文释义'}
            aria-pressed={showZh}
          >
            {showZh ? '中 / EN' : 'EN'}
          </button>
        </div>
        <div className="golden-bank">
          {choices.map((c) => {
            const on = langPointKey(c.en) === pickedKey
            return (
              <button
                key={c.en}
                className={on ? 'primary' : ''}
                onClick={() => select(c.en)}
                aria-pressed={on}
                title={showZh && c.zh ? c.zh : c.en}
              >
                {showZh && c.zh ? `${c.en} — ${c.zh}` : c.en}
                {c.done ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
        <div className="muted">
          必须自然用上「{active}」，可以换主语或场景，不要照抄原句；不练也能直接下一句。
        </div>
      </div>

      <textarea
        className="study-input golden-exam-input"
        rows={3}
        value={imitation.answer}
        onChange={(e) => imitation.setAnswer(e.target.value)}
        placeholder={`用 ${active} 写一句新的英文…`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      <div className="bar">
        <button className="primary" onClick={imitation.grade} disabled={!hasAnswer || imitation.grading}>
          {imitation.grading ? '批改中…' : '提交 AI 批改'}
        </button>
        <button onClick={imitation.copyGradePrompt} disabled={!hasAnswer}>复制批改提示词</button>
      </div>

      {imitation.error && <div className="golden-bad">{imitation.error}</div>}
      {imitation.feedback && <GoldenFeedback feedback={imitation.feedback} model={current.model} />}

      <GoldenPasteBox
        label="应用 AI 批改结果（语言点造句）"
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
