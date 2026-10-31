import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  summarizeWritingErrors,
  writingErrorHeadline,
  type WritingErrorExample,
  type WritingRecommendationGroup,
  type WritingSentenceSummary,
} from '../../../core/writingErrors'
import {
  collectWritingErrorCards,
  type WritingErrorCard,
} from '../../../core/writingErrorReview'
import {
  dueCardsFromProgress,
  type WritingErrorProgress,
} from '../../../core/writingErrorProgress'
import type { WritingRecord } from '../../../core/writing'
import { writingRecordKey } from '../../../core/writing'
import type { ActivityCat } from '../../../core/activity'
import type { GoldenExtraPoint } from '../../../types/document'
import GoldenErrorReview from './GoldenErrorReview'
import GoldenRecordDrawer from './GoldenRecordDrawer'
import WritingHoverCard, { hoverDataFromRecord } from './WritingHoverCard'

export interface GoldenErrorsViewProps {
  rows: { article: WritingRecord[]; all: WritingRecord[] }
  articleTitle: string
  onBack: () => void
  /** 把推荐语言点写进本课；由组合根决定当前篇能不能加 */
  onAddPoint?: (rec: WritingRecommendationGroup) => void
  /** 回到某句继续练；找不到就不显示按钮 */
  onOpenSentence?: (sentenceId: string) => void
  /** 跳到历史详情（recordKey + 当时范围）；没有路由就不显示「历史」按钮 */
  onOpenHistory?: (recordKey: string, scope: Scope) => void
  /** 错因复习的耐久状态；没有行 = 现在到期 */
  writingErrorProgress?: readonly WritingErrorProgress[]
  /** 从 URL 带进来的范围（返回详情时保持本篇/全库） */
  initialScope?: Scope
  /** 切本篇/全库时同步 URL；没路由就不传 */
  onScopeChange?: (scope: Scope) => void
  /** 记录一次错因复习（source=golden / kind=error-fix） */
  onReviewAnswer?: (card: WritingErrorCard, correct: boolean) => void
  onPauseReview?: (card: WritingErrorCard) => void
  onResumeReview?: (card: WritingErrorCard) => void
  /** 错因订正 AI 批改写进 writingHistory；不传就隐藏 AI 入口 */
  setWritingHistory?: Dispatch<SetStateAction<WritingRecord[]>>
  flash?: (message: string) => void
  recordActivity?: (cat: ActivityCat, n?: number) => void
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
  onOpenHistory,
  writingErrorProgress,
  initialScope = 'article',
  onScopeChange,
  onReviewAnswer,
  onPauseReview,
  onResumeReview,
  setWritingHistory,
  flash,
  recordActivity,
  extraPoints,
  onRemovePoint,
}: GoldenErrorsViewProps) {
  const [scope, setScope] = useState<Scope>(initialScope)
  const [since, setSince] = useState<Since>(30)
  const [sessionCards, setSessionCards] = useState<WritingErrorCard[] | null>(null)
  const [drawerRecord, setDrawerRecord] = useState<WritingRecord | null>(null)
  const articleId = rows.article[0]?.articleId
  const recordByKey = useMemo(() => {
    const map = new Map<string, WritingRecord>()
    for (const rec of [...rows.article, ...rows.all]) map.set(rec.recordKey || writingRecordKey(rec), rec)
    return map
  }, [rows.article, rows.all])
  const data = useMemo(
    () =>
      summarizeWritingErrors(scope === 'article' ? rows.article : rows.all, {
        scope,
        ...(scope === 'article' && articleId ? { articleId } : {}),
        ...(since ? { sinceDays: since } : {}),
      }),
    [rows.article, rows.all, scope, since, articleId],
  )
  const allCards = useMemo(() => {
    const query = {
      scope,
      ...(scope === 'article' && articleId ? { articleId } : {}),
      ...(since ? { sinceDays: since } : {}),
    }
    return collectWritingErrorCards(scope === 'article' ? rows.article : rows.all, query)
  }, [scope, articleId, since, rows.article, rows.all])
  const progressById = useMemo(
    () => new Map((writingErrorProgress ?? []).map((p) => [p.id, p])),
    [writingErrorProgress],
  )
  const dueCards = useMemo(
    () => (onReviewAnswer ? dueCardsFromProgress(allCards, writingErrorProgress ?? [], new Date()) : []),
    [onReviewAnswer, allCards, writingErrorProgress],
  )
  const pausedCards = useMemo(
    () =>
      allCards.filter((card) => {
        const status = progressById.get(card.id)?.status
        return status === 'paused' || status === 'mastered'
      }),
    [allCards, progressById],
  )
  const topRules = data.byRule.filter((r) => r.mustFix > 0).slice(0, 8)
  const recurring = data.sentences.filter((s) => s.attempts.length >= 2).slice(0, 6)
  const recommendations = data.recommendations.slice(0, 8)
  const maxTrend = Math.max(1, ...data.series.map((p) => p.mustFix))

  const hoverForExample = (ex: WritingErrorExample) => {
    const rec = recordByKey.get(ex.recordKey)
    return {
      ...(rec ? hoverDataFromRecord(rec) : { title: ex.articleTitle || '批改记录', at: ex.at, text: ex.text }),
      original: ex.original,
      suggestion: ex.suggestion,
      ...(ex.reason ? { reason: ex.reason } : {}),
    }
  }
  const drawerForExample = (ex: WritingErrorExample): WritingRecord | null =>
    recordByKey.get(ex.recordKey) ?? null

  if (sessionCards) {
    return (
      <GoldenErrorReview
        cards={sessionCards}
        writingErrorProgress={writingErrorProgress}
        writingHistory={rows.all}
        setWritingHistory={setWritingHistory}
        flash={flash}
        recordActivity={recordActivity}
        onAnswer={(card, correct) => onReviewAnswer?.(card, correct)}
        onPause={onPauseReview}
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
        <button
          className={scope === 'article' ? 'primary' : ''}
          onClick={() => {
            setScope('article')
            onScopeChange?.('article')
          }}
        >
          本篇
        </button>
        <button
          className={scope === 'all' ? 'primary' : ''}
          onClick={() => {
            setScope('all')
            onScopeChange?.('all')
          }}
        >
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

      {pausedCards.length > 0 && (
        <section className="golden-errors-sec">
          <h3>已暂停 / 已掌握</h3>
          <div className="golden-errors-list">
            {pausedCards.map((card) => {
              const status = progressById.get(card.id)?.status
              return (
                <div className="golden-errors-row" key={card.id}>
                  <div className="golden-errors-head">
                    <b>{card.original || card.suggestion}</b>
                    <span className="golden-chip">{status === 'mastered' ? '已掌握' : '已暂停'}</span>
                    {onResumeReview && (
                      <button className="golden-errors-mini" onClick={() => onResumeReview(card)}>
                        恢复
                      </button>
                    )}
                  </div>
                  <div className="muted">
                    {card.original ? `原句：${card.text}` : card.text}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
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
            {topRules.map((r) => {
              const ex = r.examples[0]
              const rec = ex ? drawerForExample(ex) : null
              return (
                <WritingHoverCard key={r.rule} data={ex ? hoverForExample(ex) : { title: r.label }}>
                  <div className="golden-errors-row">
                    <div className="golden-errors-head">
                      <b>{r.label}</b>
                      <span className="golden-chip">{r.mustFix} 次</span>
                      <span className="muted">
                        {r.records} 次批改 · {r.articles} 篇
                      </span>
                      {rec && (
                        <>
                          <button className="golden-errors-mini" onClick={() => setDrawerRecord(rec)}>
                            看批改
                          </button>
                          {onOpenHistory && (
                            <button
                              className="golden-errors-mini"
                              onClick={() =>
                                onOpenHistory(rec.recordKey || writingRecordKey(rec), scope)
                              }
                            >
                              历史 ↗
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {ex && (
                      <div className="golden-errors-example">
                        <span className="bad">{short(ex.original) || '（缺词）'}</span>
                        {' → '}
                        <span className="good">{short(ex.suggestion)}</span>
                      </div>
                    )}
                  </div>
                </WritingHoverCard>
              )
            })}
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
            {recurring.map((s) => {
              const latest = s.attempts[s.attempts.length - 1]
              const rec = latest ? recordByKey.get(latest.recordKey) ?? null : null
              const at = s.lastAt
              return (
                <WritingHoverCard
                  key={`${s.articleId}:${s.sentenceId ?? s.examId ?? ''}:${s.focus ?? ''}`}
                  data={
                    rec
                      ? hoverDataFromRecord(rec)
                      : { title: sentenceLabel(s), at }
                  }
                >
                  <div className="golden-errors-row">
                    <div className="golden-errors-head">
                      <b>{sentenceLabel(s)}</b>
                      <span className="golden-chip">{s.attempts.length} 次</span>
                      <span className="muted">
                        {s.attempts[0]?.percent ?? '—'} → {s.lastPercent ?? '—'} 分
                        {s.bestPercent !== null ? ` · 最高 ${s.bestPercent}` : ''}
                      </span>
                      {rec && (
                        <>
                          <button className="golden-errors-mini" onClick={() => setDrawerRecord(rec)}>
                            看批改
                          </button>
                          {onOpenHistory && (
                            <button
                              className="golden-errors-mini"
                              onClick={() =>
                                onOpenHistory(rec.recordKey || writingRecordKey(rec), scope)
                              }
                            >
                              历史 ↗
                            </button>
                          )}
                        </>
                      )}
                      {onOpenSentence && s.sentenceId && (
                        <button
                          className="golden-errors-mini"
                          onClick={() => onOpenSentence(s.sentenceId!)}
                        >
                          去练
                        </button>
                      )}
                    </div>
                    {s.topRules.length > 0 && (
                      <div className="muted">
                        常错：
                        {s.topRules
                          .map((r) => data.byRule.find((x) => x.rule === r)?.label ?? r)
                          .join('、')}
                      </div>
                    )}
                  </div>
                </WritingHoverCard>
              )
            })}
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
              <div className="golden-errors-row" key={`${rec.kind}:${rec.articleId}:${rec.sentenceId ?? ''}:${rec.focus ?? ''}:${rec.pointKey}`}>
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

      <GoldenRecordDrawer
        record={drawerRecord}
        onClose={() => setDrawerRecord(null)}
        onOpenHistory={
          drawerRecord && onOpenHistory
            ? () => onOpenHistory(drawerRecord.recordKey || writingRecordKey(drawerRecord), scope)
            : undefined
        }
      />
    </div>
  )
}
