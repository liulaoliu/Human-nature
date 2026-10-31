import { useMemo, useState } from 'react'
import {
  summarizeWritingErrors,
  writingErrorHeadline,
  type WritingRecommendationGroup,
  type WritingSentenceSummary,
} from '../../../core/writingErrors'
import {
  collectWritingErrorCards,
  dueWritingErrorCards,
  type WritingErrorCard,
} from '../../../core/writingErrorReview'
import type { AnswerEvent } from '../../../core/answerEvents'
import type { WritingRecord } from '../../../core/writing'
import type { GoldenExtraPoint } from '../../../types/document'
import GoldenErrorReview from './GoldenErrorReview'

export interface GoldenErrorsViewProps {
  rows: { article: WritingRecord[]; all: WritingRecord[] }
  articleTitle: string
  onBack: () => void
  /** 把推荐语言点写进本课；由组合根决定当前篇能不能加 */
  onAddPoint?: (rec: WritingRecommendationGroup) => void
  /** 回到某句继续练；找不到就不显示按钮 */
  onOpenSentence?: (sentenceId: string) => void
  /** 答题事件：错因复习的 Leitner 状态从已有 answerEvents 派生 */
  answerEvents?: readonly AnswerEvent[]
  /** 记录一次错因复习（source=golden / kind=error-fix） */
  onReviewAnswer?: (card: WritingErrorCard, correct: boolean) => void
  /** 本课已加入的额外语言点（可移除） */
  extraPoints?: GoldenExtraPoint[]
  onRemovePoint?: (sentenceId: string, en: string) => void
}

type Scope = 'article' | 'all'
type Since = 7 | 30 | 0

function dayLabel(day: string): string {
  return day.slice(5).replace('-', '/')
}

function short(text: string, max = 88): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function sentenceLabel(s: WritingSentenceSummary): string {
  if (s.focus) return `语言点：${s.focus}`
  if (s.sentenceId) return `句子 ${s.sentenceId}`
  return '整课仿写'
}

export default function GoldenErrorsView({
  rows,
  articleTitle,
  onBack,
  onAddPoint,
  onOpenSentence,
  answerEvents,
  onReviewAnswer,
  extraPoints,
  onRemovePoint,
}: GoldenErrorsViewProps) {
  const [scope, setScope] = useState<Scope>('article')
  const [since, setSince] = useState<Since>(30)
  const [sessionCards, setSessionCards] = useState<WritingErrorCard[] | null>(null)
  const articleId = rows.article[0]?.articleId
  const data = useMemo(
    () =>
      summarizeWritingErrors(scope === 'article' ? rows.article : rows.all, {
        scope,
        ...(scope === 'article' && articleId ? { articleId } : {}),
        ...(since ? { sinceDays: since } : {}),
      }),
    [rows.article, rows.all, scope, since, articleId],
  )
  const dueCards = useMemo(() => {
    if (!onReviewAnswer) return []
    const query = {
      scope,
      ...(scope === 'article' && articleId ? { articleId } : {}),
      ...(since ? { sinceDays: since } : {}),
    }
    const cards = collectWritingErrorCards(scope === 'article' ? rows.article : rows.all, query)
    return dueWritingErrorCards(cards, answerEvents ?? [], new Date())
  }, [onReviewAnswer, scope, articleId, since, rows.article, rows.all, answerEvents])
  const topRules = data.byRule.filter((r) => r.mustFix > 0).slice(0, 8)
  const recurring = data.sentences.filter((s) => s.attempts.length >= 2).slice(0, 6)
  const recommendations = data.recommendations.slice(0, 8)
  const maxTrend = Math.max(1, ...data.series.map((p) => p.mustFix))

  if (sessionCards) {
    return (
      <GoldenErrorReview
        cards={sessionCards}
        onAnswer={(card, correct) => onReviewAnswer?.(card, correct)}
        onBack={() => setSessionCards(null)}
      />
    )
  }

  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 返回</button>
        <b>错因复盘</b>
        <span className="muted">{articleTitle}</span>
      </div>

      <div className="bar golden-plan-bar">
        <button className={scope === 'article' ? 'primary' : ''} onClick={() => setScope('article')}>
          本篇
        </button>
        <button className={scope === 'all' ? 'primary' : ''} onClick={() => setScope('all')}>
          全库
        </button>
        <select
          aria-label="时间范围"
          value={since}
          onChange={(e) => setSince(Number(e.target.value) as Since)}
        >
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={0}>全部</option>
        </select>
        <span className="muted">{writingErrorHeadline(data)}</span>
      </div>

      <div className="golden-kpis">
        <span>批改 <b>{data.analyzedRecords}</b> 次</span>
        <span>平均分 <b>{data.averageScore ?? '—'}</b></span>
        <span>硬错 <b>{data.mustFix}</b> 条</span>
        <span>提升项 <b>{data.improvement}</b> 条</span>
      </div>

      {data.totalRecords > data.analyzedRecords && (
        <div className="muted">
          还有 {data.totalRecords - data.analyzedRecords} 条旧批改未分析：运行
          <code> npm run backfill:writing </code>一次性回填。
        </div>
      )}

      {onReviewAnswer && (
        <div className="bar golden-plan-bar">
          <button
            className="primary"
            onClick={() => setSessionCards(dueCards)}
            disabled={!dueCards.length}
            title="按 1 / 3 / 7 / 14 / 30 / 60 天复习；答错明天再来"
          >
            🧠 现在考我（{dueCards.length} 张到期）
          </button>
          <span className="muted">
            {dueCards.length ? '只考 must-fix 错因；先看答案也算一次错' : '今天没有到期错因'}
          </span>
        </div>
      )}

      {!data.analyzedRecords && (
        <div className="golden-summary">
          这个范围还没有 v2 批改记录。先在单句仿写 / 整课考试里交一稿，AI 批改后就会出现在这里。
        </div>
      )}

      <section className="golden-errors-sec">
        <h3>最常错的规则</h3>
        {topRules.length ? (
          <div className="golden-errors-list">
            {topRules.map((r) => (
              <div className="golden-errors-row" key={r.rule}>
                <div className="golden-errors-head">
                  <b>{r.label}</b>
                  <span className="golden-chip">{r.mustFix} 次</span>
                  <span className="muted">
                    {r.records} 次批改 · {r.articles} 篇
                  </span>
                </div>
                {r.examples[0] && (
                  <div className="golden-errors-example">
                    <span className="bad">{short(r.examples[0].original) || '（缺词）'}</span>
                    {' → '}
                    <span className="good">{short(r.examples[0].suggestion)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">没有硬错。继续练“更地道”的提升项就好。</div>
        )}
      </section>

      <section className="golden-errors-sec">
        <h3>最近 {data.trendDays} 天硬错</h3>
        <div className="golden-error-trend" role="img" aria-label="最近硬错趋势">
          {data.series.map((p) => (
            <span
              key={p.day}
              className="golden-error-bar"
              style={{ height: `${Math.round((p.mustFix / maxTrend) * 100)}%` }}
              title={`${p.day}：${p.mustFix} 条硬错，共 ${p.count} 条 issue`}
            >
              {p.mustFix > 0 && <i>{p.mustFix}</i>}
              <small>{dayLabel(p.day)}</small>
            </span>
          ))}
        </div>
      </section>

      <section className="golden-errors-sec">
        <h3>反复练的句子</h3>
        {recurring.length ? (
          <div className="golden-errors-list">
            {recurring.map((s) => (
              <div className="golden-errors-row" key={`${s.articleId}:${s.sentenceId ?? s.examId ?? ''}:${s.focus ?? ''}`}>
                <div className="golden-errors-head">
                  <b>{sentenceLabel(s)}</b>
                  <span className="golden-chip">{s.attempts.length} 次</span>
                  <span className="muted">
                    {s.attempts[0]?.percent ?? '—'} → {s.lastPercent ?? '—'} 分
                    {s.bestPercent !== null ? ` · 最高 ${s.bestPercent}` : ''}
                  </span>
                  {onOpenSentence && s.sentenceId && (
                    <button className="golden-errors-mini" onClick={() => onOpenSentence(s.sentenceId!)}>
                      去练
                    </button>
                  )}
                </div>
                {s.topRules.length > 0 && (
                  <div className="muted">常错：{s.topRules.map((r) => data.byRule.find((x) => x.rule === r)?.label ?? r).join('、')}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">还没有同一句练两次以上的记录。</div>
        )}
      </section>

      <section className="golden-errors-sec">
        <h3>AI 推荐语言点</h3>
        {recommendations.length ? (
          <div className="golden-errors-list">
            {recommendations.map((rec) => (
              <div className="golden-errors-row" key={`${rec.kind}:${rec.pointKey}`}>
                <div className="golden-errors-head">
                  <b>{rec.point}</b>
                  {rec.zh && <span className="muted">{rec.zh}</span>}
                  <span className="golden-chip">{rec.kind}</span>
                  {rec.count > 1 && <span className="golden-chip">{rec.count} 次</span>}
                  {onAddPoint && rec.kind !== 'grammar' && rec.sentenceId && (
                    <button className="golden-errors-mini" onClick={() => onAddPoint(rec)}>
                      加入本课
                    </button>
                  )}
                </div>
                <div className="muted">{rec.why}</div>
                {rec.example && <div className="golden-errors-example">{rec.example}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">AI 还没有给推荐。重新批改一次（v2 契约）后会带上 0–3 条。</div>
        )}
      </section>

      {extraPoints && extraPoints.length > 0 && (
        <section className="golden-errors-sec">
          <h3>本课加练语言点</h3>
          <div className="golden-errors-list">
            {extraPoints.map((p) => (
              <div className="golden-errors-row" key={`${p.sentenceId}:${p.en}`}>
                <div className="golden-errors-head">
                  <b>{p.en}</b>
                  {p.zh && <span className="muted">{p.zh}</span>}
                  <span className="golden-chip">{p.kind}</span>
                  {onRemovePoint && (
                    <button
                      className="golden-errors-mini"
                      onClick={() => onRemovePoint(p.sentenceId, p.en)}
                    >
                      移除
                    </button>
                  )}
                </div>
                <div className="muted">已进入「语言点造句」的可选项，不影响本句填空 / 拼句进度。</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
