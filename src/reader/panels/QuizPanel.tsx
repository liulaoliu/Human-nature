import { useEffect, useRef } from 'react'
import { formatAnswerInput, maskAnswer, QUIZ_KIND_LABEL, type QuizQuestion } from '../../core/quiz'
import type { VocabItem } from '../../types/document'
import { fmtDur } from '../format'
import { QUIZ_SCOPE_LABEL, type QuizScope } from './QuizSetupPanel'

export interface QuizResultRow {
  id: string
  itemId: string
  correct: boolean
}

export interface QuizPanelProps {
  /** 当前题；为 null 或 index 越界时显示结算。 */
  question: QuizQuestion | null
  /** 本轮考试范围（页面上给个提示）。 */
  scope: QuizScope
  queueLength: number
  index: number
  seconds: number
  results: QuizResultRow[]
  checked: boolean
  input: string
  result: boolean | null
  /** 整个词库（用于结算页显示错词）。 */
  items: VocabItem[]
  onClose: () => void
  onSpeak: (text: string) => void
  /** 一键尝试唤醒假死的语音（真死需刷新，刷新后可续考）。 */
  onResetSpeech: () => void
  onSubmit: () => void
  onNext: () => void
  onRetryWrong: () => void
  onRestart: () => void
  onSelectOption: (option: string) => void
  onInputChange: (value: string) => void
}

/** 考试答题 + 结算。 */
export default function QuizPanel({
  question,
  scope,
  queueLength,
  index,
  seconds,
  results,
  checked,
  input,
  result,
  items,
  onClose,
  onSpeak,
  onResetSpeech,
  onSubmit,
  onNext,
  onRetryWrong,
  onRestart,
  onSelectOption,
  onInputChange,
}: QuizPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // 换题后把焦点送回输入框（词形辨析是点选项，不聚焦）
  useEffect(() => {
    if (question && question.kind !== 'choice' && question.kind !== 'meaning' && !checked) {
      inputRef.current?.focus()
    }
  }, [question, checked])

  const correct = results.filter((r) => r.correct).length

  return (
    <div className="study quiz">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <span className="muted" title="本轮考试范围">
          范围：{QUIZ_SCOPE_LABEL[scope]}
        </span>
        <span className="muted">
          {Math.min(index + 1, queueLength)} / {queueLength}
        </span>
        <span className="muted study-timer">⏱ {fmtDur(seconds)}</span>
        <span className="muted">
          正确 {correct} / {results.length}
        </span>
        <button
          onClick={() => {
            onResetSpeech()
            if (question && (question.kind === 'listen' || question.kind === 'ear')) {
              onSpeak(question.audioText ?? question.context ?? question.word)
            }
          }}
          title="朗读卡住时点这里尝试唤醒；仍无效就刷新页面（刷新后进度会恢复）"
        >
          🔄 重启语音
        </button>
      </div>

      {question ? (
        <>
          <div className="study-card quiz-card">
            <div className="quiz-kind">{QUIZ_KIND_LABEL[question.kind]}</div>
            {question.kind === 'listen' || question.kind === 'ear' ? (
              <button
                className="primary quiz-play"
                onClick={() => onSpeak(question.audioText ?? question.context ?? question.word)}
                title="再听一遍"
              >
                🔊 {question.kind === 'ear' ? '播放单词' : '播放句子'}
              </button>
            ) : question.kind === 'meaning' ? (
              <div className="study-word quiz-word">
                {question.word}
                <button className="speak" onClick={() => onSpeak(question.word)} title="朗读">
                  🔊
                </button>
              </div>
            ) : (
              <div className={question.kind === 'spell' ? 'study-meaning quiz-prompt' : 'quiz-sentence'}>
                {question.kind === 'spell' ? (
                  <>
                    {question.partOfSpeech && <span className="cell-pos">{question.partOfSpeech} </span>}
                    {question.prompt}
                  </>
                ) : (
                  question.prompt
                )}
              </div>
            )}
            {(question.kind === 'cloze' || question.kind === 'usage' || question.kind === 'listen') &&
              question.meaning && (
                <div className="muted quiz-hint">
                  释义：{question.partOfSpeech ? `${question.partOfSpeech} ` : ''}
                  {question.meaning}
                </div>
              )}
            {(question.kind === 'choice' || question.kind === 'meaning') && question.options ? (
              <div className="quiz-options">
                {question.options.map((opt, i) => (
                  <button
                    key={opt}
                    className={
                      !checked ? '' : opt === question.answer ? 'primary' : opt === input ? 'danger' : ''
                    }
                    disabled={checked}
                    onClick={() => onSelectOption(opt)}
                  >
                    <kbd>{i + 1}</kbd> {opt}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <input
                  className="study-input"
                  autoFocus
                  ref={inputRef}
                  placeholder="输入答案，回车提交 / 下一题"
                  value={input}
                  onChange={(e) => onInputChange(formatAnswerInput(e.target.value, question.answer))}
                  disabled={checked}
                />
                <div className="muted quiz-mask" title="提示：一个下划线=一个字母；空格=一个词">
                  {maskAnswer(question.answer)}
                </div>
              </>
            )}
            {checked && (
              <>
                <div className={'study-result ' + (result ? 'ok' : 'bad')}>
                  {result ? '✔ 正确' : `✘ 正确答案：${question.answer}`}
                </div>
                {question.context && <div className="muted quiz-full">{question.context}</div>}
                {question.translation && <div className="muted quiz-full">{question.translation}</div>}
              </>
            )}
          </div>
          <div className="bar study-actions">
            {!checked ? (
              <button className="primary" onClick={onSubmit}>
                提交（回车）
              </button>
            ) : (
              <button className="primary" onClick={onNext}>
                {index + 1 >= queueLength ? '看结果（回车）' : '下一题（回车）'}
              </button>
            )}
            <button onClick={onClose}>退出</button>
          </div>
        </>
      ) : (
        (() => {
          const total = results.length
          const ok = results.filter((r) => r.correct).length
          const wrongIds = [...new Set(results.filter((r) => !r.correct).map((r) => r.itemId))]
          return (
            <div className="study-done">
              <p>
                考试结束：答对 <b>{ok}</b> / {total}
                {total ? `（正确率 ${Math.round((ok / total) * 100)}%）` : ''}，用时 {fmtDur(seconds)}。
              </p>
              {wrongIds.length > 0 && (
                <div className="quiz-wrong">
                  <div className="muted">错题：</div>
                  {wrongIds.map((id) => {
                    const it = items.find((x) => x.id === id)
                    return it ? (
                      <div key={id}>
                        <b>{it.word}</b>
                        {it.meaning ? ` — ${it.meaning}` : ''}
                      </div>
                    ) : null
                  })}
                </div>
              )}
              <div className="bar">
                {wrongIds.length > 0 && (
                  <button className="primary" onClick={onRetryWrong}>
                    重做错题 {wrongIds.length}
                  </button>
                )}
                <button className={wrongIds.length ? '' : 'primary'} onClick={onRestart}>
                  再来一轮
                </button>
                <button onClick={onClose}>回到阅读</button>
              </div>
            </div>
          )
        })()
      )}
    </div>
  )
}
