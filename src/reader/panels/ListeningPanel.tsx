import { isListeningCorrect, type ListeningQuestion, type ListeningResult } from '../../core/listening'

export interface ListeningPanelProps {
  questions: ListeningQuestion[]
  /** 每题作答：qid → 选项 / 文本。 */
  answers: Record<string, string>
  submitted: boolean
  result: ListeningResult | null
  /** 是否只做错题（用于标签）。 */
  onlyWrong: boolean
  /** 是否正在朗读全文。 */
  readingAll: boolean
  /** 全文原文（提交后「显示原文」用）；无文章为 null。 */
  transcript: string | null
  onClose: () => void
  onToggleRead: () => void
  /** 一键尝试唤醒假死的语音。 */
  onResetSpeech: () => void
  /** 朗读状态（合成中 / 朗读中）。 */
  ttsState: 'idle' | 'loading' | 'playing'
  onAnswer: (id: string, value: string) => void
  onSubmit: () => void
  onRetryWrong: () => void
  onShowAll: () => void
  onRegenerate: () => void
}

/** 听力理解：AI 严格 JSON 出题 + 本地判分，纯展示 + 回调。 */
export default function ListeningPanel({
  questions,
  answers,
  submitted,
  result,
  onlyWrong,
  readingAll,
  transcript,
  onClose,
  onToggleRead,
  onResetSpeech,
  ttsState,
  onAnswer,
  onSubmit,
  onRetryWrong,
  onShowAll,
  onRegenerate,
}: ListeningPanelProps) {
  return (
    <div className="study listen">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <button
          className={readingAll ? 'danger' : ''}
          onClick={onToggleRead}
          title="朗读整篇（练习听力）"
        >
          {readingAll ? '⏹ 停止' : ttsState === 'loading' ? '🔊 合成中…' : '🔊 播放全文'}
        </button>
        <button
          onClick={onResetSpeech}
          title="朗读卡住时点这里尝试唤醒；仍无效就刷新页面"
        >
          🔄 重启语音
        </button>
        <span className="muted">
          共 {questions.length} 题{onlyWrong ? '（只做错题）' : ''}
        </span>
        {submitted && result && (
          <span className="muted">
            得分 {result.correct}/{result.total}（{Math.round(result.score * 100)}%）
          </span>
        )}
      </div>

      <div className="listen-list">
        {questions.map((q, qi) => {
          const got = answers[q.id] ?? ''
          const ok = submitted && isListeningCorrect(q, got)
          return (
            <div className="listen-q" key={q.id}>
              <div className="listen-stem">
                {qi + 1}. {q.stem}
              </div>
              {q.type === 'mcq' && q.options ? (
                <div className="listen-opts">
                  {q.options.map((opt) => {
                    const chosen = got === opt
                    const cls =
                      (chosen ? 'primary' : '') +
                      (submitted && opt === q.answer ? ' ok' : '') +
                      (submitted && chosen && opt !== q.answer ? ' bad' : '')
                    return (
                      <button key={opt} className={cls} disabled={submitted} onClick={() => onAnswer(q.id, opt)}>
                        {opt}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <input
                  className="study-input listen-input"
                  disabled={submitted}
                  placeholder={q.type === 'gap' ? '填空' : '简答'}
                  value={got}
                  onChange={(e) => onAnswer(q.id, e.target.value)}
                />
              )}
              {submitted && (
                <div className={'listen-feedback ' + (ok ? 'ok' : 'bad')}>
                  {ok ? '✔ 正确' : `✘ 正确答案：${q.answer}`}
                  {q.explanation ? `　${q.explanation}` : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="bar study-actions">
        {!submitted ? (
          <button className="primary" onClick={onSubmit}>
            提交判分
          </button>
        ) : (
          <>
            {result && result.correct < result.total && (
              <button className="primary" onClick={onRetryWrong}>
                重做错题 {result.total - result.correct}
              </button>
            )}
            <button onClick={onShowAll}>重做全部</button>
          </>
        )}
        <button onClick={onRegenerate}>重新出题</button>
      </div>

      {submitted && transcript && (
        <details className="listen-transcript">
          <summary>显示原文</summary>
          <div>{transcript}</div>
        </details>
      )}
    </div>
  )
}
