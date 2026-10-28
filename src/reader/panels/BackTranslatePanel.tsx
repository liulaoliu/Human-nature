import { useState } from 'react'
import {
  compareToReference,
  diffWords,
  type BackTranslationFeedback,
  type BackTranslationRecord,
} from '../../core/backTranslate'
import type { useBackTranslate } from '../hooks/useBackTranslate'

type BackApi = ReturnType<typeof useBackTranslate>

function FeedbackView({
  feedback,
  answer,
  reference,
}: {
  feedback: BackTranslationFeedback
  answer: string
  reference: string
}) {
  const [diffOpen, setDiffOpen] = useState(false)
  const closeness = compareToReference(answer, reference)
  const deductIssues = feedback.issues.filter((i) => i.deduct)
  const notes = feedback.issues.filter((i) => !i.deduct)
  const parts = diffOpen ? diffWords(answer, reference) : []

  return (
    <div className="bt-feedback">
      {feedback.max > 0 && (
        <div className="bt-score">
          <b>
            {feedback.total}/{feedback.max}
          </b>
          {feedback.scores.map((s) => (
            <span key={s.dimension}>
              {s.dimension} {s.score}/{s.max}
              {s.comment ? `（${s.comment}）` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="bt-closeness">
        {closeness.exact ? (
          <b className="ok">✅ 和原文一字不差</b>
        ) : (
          <>
            <span className="muted">
              和原文词级重合 {Math.round(closeness.ratio * 100)}%（只作参考，不是分数）
            </span>
            <button onClick={() => setDiffOpen((v) => !v)}>
              {diffOpen ? '收起逐词对照' : '逐词对照'}
            </button>
          </>
        )}
      </div>

      {diffOpen && (
        <div className="bt-diff" aria-label="你的答案与原文的逐词对照">
          {parts.map((p, i) => (
            <span key={i} className={`bt-diff-${p.kind}`}>
              {p.text}{' '}
            </span>
          ))}
          <div className="muted">橙色 = 原文有、你没写；红色 = 你写了、原文没有。</div>
        </div>
      )}

      <div className="bt-compare">
        <div>
          <span className="muted">你的答案</span>
          <div className="bt-line">{answer}</div>
        </div>
        <div>
          <span className="muted">原文（一种写法，不是唯一答案）</span>
          <div className="bt-line">{reference}</div>
        </div>
      </div>

      <div className="bt-issues">
        <b>扣分问题</b>
        {deductIssues.length ? (
          <ul>
            {deductIssues.map((is, i) => (
              <li key={i}>
                <span className="bad">{is.original || '（见建议）'}</span> → <span className="ok">{is.suggestion}</span>
                {is.reason ? `（${is.reason}）` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted">没有发现扣分问题。</div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="bt-notes">
          <b>专名提示（不计分）</b>
          <ul>
            {notes.map((is, i) => (
              <li key={i}>
                {is.original ? <span className="bad">{is.original}</span> : null}
                {is.original ? ' → ' : ''}
                <span className="ok">{is.suggestion}</span>
                {is.reason ? `（${is.reason}）` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.polished && (
        <div className="bt-polished">
          <b>改写示范：</b>
          {feedback.polished}
        </div>
      )}
      {feedback.alternatives.length > 0 && (
        <div className="bt-alts">
          <b>也可以这样写：</b>
          {feedback.alternatives.map((a, i) => (
            <div key={i}>{a}</div>
          ))}
        </div>
      )}
      {feedback.summary && <div className="muted">{feedback.summary}</div>}
    </div>
  )
}

/**
 * 回译训练面板。
 *
 * 提交前只显示中文，不显示原句；批改后才给原文对照和逐词 diff。
 * 历史默认看本篇，也可切到全部存档（跨文章回看）。
 */
export default function BackTranslatePanel({ api }: { api: BackApi }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyScope, setHistoryScope] = useState<'article' | 'all'>('article')
  const [viewing, setViewing] = useState<BackTranslationRecord | null>(null)
  /** 「震你一下」按句记住；换句自动收起，避免下一句一进来就看到原文。 */
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  const originalOpen = !!api.current && revealedFor === api.current.id

  const listed = historyScope === 'article' ? api.articleHistory : api.history
  const showHistory = historyOpen || !api.current

  return (
    <div className="study back-translate">
      <div className="bar study-bar">
        <button onClick={api.close}>结束（Esc）</button>
        <span className="muted">回译训练</span>
        {api.queueLength > 0 && (
          <span className="muted">
            第 {api.position} / {api.queueLength} 句
          </span>
        )}
        <button onClick={api.prev} disabled={!api.canPrev || api.grading}>
          上一句
        </button>
        <button onClick={api.next} disabled={!api.canNext || api.grading}>
          下一句
        </button>
        <button onClick={() => setHistoryOpen((v) => !v)}>历史（{api.articleHistory.length}）</button>
      </div>

      {!api.current ? (
        <div className="bt-empty muted">
          {api.history.length
            ? '当前没有可回译的句子；下面是历史存档，随时可以回看。'
            : '这篇没有带译文的句子。先回正文点「全文翻译」，再回来。'}
        </div>
      ) : (
        <>
          <div className="bt-prompt">
            {api.articleTitle && <div className="muted">{api.articleTitle}</div>}
            {api.contextZh && <div className="bt-context">上一句：{api.contextZh}</div>}
            <div className="bt-source-row">
              <span className="muted">把下面这句中文译回英文：</span>
              <button
                type="button"
                className={'bt-reveal' + (originalOpen ? ' on' : '')}
                aria-pressed={originalOpen}
                onClick={() => setRevealedFor(originalOpen ? null : (api.current?.id ?? null))}
              >
                震你一下
              </button>
            </div>
            <div className="bt-source">{api.sourceZh}</div>
            {originalOpen && (
              <div className="bt-original">
                <span className="muted">原文：</span>
                {api.reference}
              </div>
            )}
            <textarea
              className="study-input bt-answer"
              rows={4}
              value={api.answer}
              disabled={api.grading}
              placeholder="在这里写英文；写完点「AI 批改」（Ctrl/⌘ + Enter）"
              onChange={(e) => api.setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void api.grade()
                }
              }}
            />
            <div className="bar bt-actions">
              {api.grading ? (
                <>
                  <button className="danger" onClick={api.cancelGrade}>
                    取消批改
                  </button>
                  <span className="muted">AI 批改中…</span>
                </>
              ) : (
                <button className="primary" onClick={() => void api.grade()} disabled={!api.answer.trim()}>
                  {api.configured === false ? '复制批改提示词' : 'AI 批改'}
                </button>
              )}
              <button onClick={() => void api.copyPrompt()} disabled={api.grading || !api.sourceZh}>
                复制提示词
              </button>
            </div>
            {api.configured === false && !api.feedback && (
              <div className="muted bt-hint">
                本机没配 AI key：点上面的按钮复制提示词，交给网页版 AI，再把返回的 JSON 粘到下面。
              </div>
            )}
            {api.manualOpen && (
              <div className="bt-manual">
                <div className="muted">AI 返回的 JSON：</div>
                <textarea
                  className="study-input"
                  rows={6}
                  value={api.manualText}
                  onChange={(e) => api.setManualText(e.target.value)}
                  placeholder='{"scores":[...],"issues":[...],"polished":"...","summary":"..."}'
                />
                <div className="bar">
                  <button className="primary" onClick={api.applyManual} disabled={!api.manualText.trim()}>
                    应用批改
                  </button>
                  <button onClick={() => api.setManualOpen(false)}>收起</button>
                </div>
              </div>
            )}
            {api.error && <div className="bt-error">{api.error}</div>}
          </div>

          {api.feedback && (
            <>
              <FeedbackView feedback={api.feedback} answer={api.gradedAnswer} reference={api.reference} />
              <div className="bar bt-actions">
                <button onClick={api.retry}>重写这句</button>
                <button className="primary" onClick={api.next} disabled={!api.canNext}>
                  下一句
                </button>
              </div>
            </>
          )}
        </>
      )}

      {showHistory && (
        <div className="bt-history">
          <div className="bar">
            <b>回译存档</b>
            <button onClick={() => setHistoryScope('article')} className={historyScope === 'article' ? 'primary' : ''}>
              本篇（{api.articleHistory.length}）
            </button>
            <button onClick={() => setHistoryScope('all')} className={historyScope === 'all' ? 'primary' : ''}>
              全部（{api.history.length}）
            </button>
          </div>
          {listed.length ? (
            <div className="bt-history-list">
              {listed.map((rec) => (
                <button
                  key={rec.id}
                  className="bt-history-row"
                  onClick={() => {
                    setViewing(rec)
                    api.loadHistory(rec)
                  }}
                  title="点开看当时的完整批改"
                >
                  <span className="muted">{new Date(rec.at).toLocaleString()}</span>
                  <span className="ellipsis">{rec.sourceZh}</span>
                  <span className="muted ellipsis">
                    {historyScope === 'all' ? rec.articleTitle || rec.articleId : rec.answer}
                  </span>
                  <b>{rec.feedback.max > 0 ? `${rec.feedback.total}/${rec.feedback.max}` : '—'}</b>
                </button>
              ))}
            </div>
          ) : (
            <div className="muted">
              {historyScope === 'article' && api.history.length > 0
                ? '本篇还没有存档；点「全部」看其它文章。'
                : '还没有存档；批改一次就会自动留下。'}
            </div>
          )}

          {viewing && (
            <div className="bt-viewing">
              <div className="bar">
                <b>存档详情</b>
                <span className="muted">{new Date(viewing.at).toLocaleString()}</span>
                {viewing.articleTitle && <span className="muted">{viewing.articleTitle}</span>}
                <button onClick={() => setViewing(null)}>收起</button>
              </div>
              <div className="bt-source">{viewing.sourceZh}</div>
              <FeedbackView feedback={viewing.feedback} answer={viewing.answer} reference={viewing.reference} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
