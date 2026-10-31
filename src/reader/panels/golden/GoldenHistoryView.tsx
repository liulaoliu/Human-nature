import { useMemo, useState } from 'react'
import GoldenFeedback from './GoldenFeedback'
import WritingHoverCard, { hoverDataFromRecord, recordKeyOf } from './WritingHoverCard'
import {
  historyPage,
  WRITING_HISTORY_PAGE,
  writingRecordLabel,
  type WritingRecord,
} from '../../../core/writing'

type Scope = 'article' | 'all'

/** 悬浮时给一行摘要（原生 title）：够看出是哪次、写了什么、AI 怎么评。 */
function hoverSummary(rec: WritingRecord, index: number): string {
  const parts = [
    `第 ${index + 1} 次 · ${writingRecordLabel(rec)}`,
    rec.articleTitle || rec.articleId,
    rec.text ? `作答：${rec.text}` : '',
    rec.feedback.max > 0 ? `评分：${rec.feedback.total}/${rec.feedback.max}` : '',
    rec.feedback.summary ? `总评：${rec.feedback.summary}` : '',
  ].filter(Boolean)
  return parts.join('\n').slice(0, 500)
}

/**
 * D老师小课堂的「学习历史」：单句仿写 / 语言点造句 / 整课考试 + 当时的 AI 批改。
 *
 * - 默认只看**本篇**，可切「全部」跨篇回看
 * - 可按**语言点**筛（`task.focus`），选项来自当前范围里出现过的 focus
 * - 列表行悬浮显示摘要；点开详情后可以 ◀ 上一条 / 下一条 ▶ 连续翻
 *
 * 过滤规则在 `useGoldenFeature`（`isGoldenWritingRecord` + 本篇 id）；这里只切范围/语言点、不重算归属。
 */
export default function GoldenHistoryView({
  rows,
  articleTitle,
  onBack,
  onPrint,
  focusRecordKey,
  initialScope = 'article',
  onOpenRecord,
  onCloseDetail,
  backLabel = '课程页',
}: {
  /** `article` = 本篇，`all` = 全库（已按来源筛过，都是金句课记录） */
  rows: { article: WritingRecord[]; all: WritingRecord[] }
  articleTitle?: string
  onBack: () => void
  /** 打印当前范围（A4）；没注入就不显示按钮 */
  onPrint?: (rows: WritingRecord[], title: string) => void
  /** URL 指定的记录；按 recordKey，不按时间/下标 */
  focusRecordKey?: string
  initialScope?: Scope
  /** 有它时，点记录/翻页都交给路由；没有则退回组件内部选择 */
  onOpenRecord?: (recordKey: string, scope: Scope) => void
  /** 详情 → 历史列表；有路由时由外层 replace URL */
  onCloseDetail?: () => void
  /** 返回按钮文案：从错因点进来是「错因复盘」 */
  backLabel?: string
}) {
  const [scope, setScope] = useState<Scope>(initialScope)
  const [focus, setFocus] = useState('')
  const [pickedIndex, setPickedIndex] = useState<number | null>(null)
  /** 渲染分页：默认只看最近一页，别一次画几千行 DOM（记录本身一条都不删） */
  const [shown, setShown] = useState(WRITING_HISTORY_PAGE)

  const scoped = useMemo(
    () => [...(scope === 'all' ? rows.all : rows.article)].sort((a, b) => b.at.localeCompare(a.at)),
    [rows, scope],
  )
  /** 当前范围里出现过的语言点（带条数）；没练过语言点时为空 */
  const focuses = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of scoped) {
      // 错因订正的 focus 是「错因：原片段 → 改法」，不是语言点，别塞进筛选下拉。
      if (r.source === 'goldenError') continue
      const f = r.task?.focus?.trim()
      if (f) map.set(f, (map.get(f) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [scoped])
  const activeFocus = focus && focuses.some(([f]) => f === focus) ? focus : ''
  const list = activeFocus ? scoped.filter((r) => (r.task?.focus ?? '').trim() === activeFocus) : scoped
  // 换范围 / 换语言点就回到第一页（渲染期重置：比 effect 少一帧，也不会把用户的「显示更多」吞掉）
  const pageKey = `${scope}|${activeFocus}`
  const [pageFor, setPageFor] = useState(pageKey)
  if (pageFor !== pageKey) {
    setPageFor(pageKey)
    setShown(WRITING_HISTORY_PAGE)
  }
  const page = historyPage(list, shown)
  const focusIndex = focusRecordKey ? list.findIndex((r) => recordKeyOf(r) === focusRecordKey) : -1
  const effectiveIndex = focusIndex >= 0 ? focusIndex : pickedIndex
  const picked = effectiveIndex !== null ? list[effectiveIndex] : null
  const missingFocus = !!focusRecordKey && focusIndex < 0

  const step = (delta: number) => {
    if (effectiveIndex === null) return
    const next = Math.max(0, Math.min(list.length - 1, effectiveIndex + delta))
    if (next === effectiveIndex) return
    if (onOpenRecord) onOpenRecord(recordKeyOf(list[next]), scope)
    else setPickedIndex(next)
  }
  const closeDetail = () => {
    if (onCloseDetail) onCloseDetail()
    else setPickedIndex(null)
  }
  if (picked) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={closeDetail}>← 历史列表</button>
          <button
            onClick={() => step(-1)}
            disabled={(effectiveIndex ?? 0) <= 0}
            title="看更早一条"
          >
            ◀ 上一条
          </button>
          <span className="muted">
            第 {(effectiveIndex ?? 0) + 1}/{list.length} 条 · {new Date(picked.at).toLocaleString()}
          </span>
          <button
            onClick={() => step(1)}
            disabled={(effectiveIndex ?? 0) >= list.length - 1}
            title="看更新一条"
          >
            下一条 ▶
          </button>
          <b>{writingRecordLabel(picked)}</b>
          {picked.articleTitle && <span className="muted">{picked.articleTitle}</span>}
          <button onClick={onBack}>← {backLabel}</button>
        </div>
        {picked.text && <div className="bt-source">{picked.text}</div>}
        <GoldenFeedback feedback={picked.feedback} model={picked.task?.model || picked.model} />
      </div>
    )
  }

  const title = scope === 'article' ? `${articleTitle || '本篇'} · 学习历史` : '金句课学习历史'
  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 课程页</button>
        <b>学习历史</b>
        <button onClick={() => setScope('article')} className={scope === 'article' ? 'primary' : ''}>
          本篇（{rows.article.length}）
        </button>
        <button onClick={() => setScope('all')} className={scope === 'all' ? 'primary' : ''}>
          全部（{rows.all.length}）
        </button>
        {focuses.length > 0 && (
          <select
            value={activeFocus}
            onChange={(e) => setFocus(e.target.value)}
            title="按语言点筛选"
            aria-label="按语言点筛选"
          >
            <option value="">语言点：全部</option>
            {focuses.map(([f, n]) => (
              <option key={f} value={f}>
                {f}（{n}）
              </option>
            ))}
          </select>
        )}
        {onPrint && list.length > 0 && (
          <button onClick={() => onPrint(list, title)} title="打印当前范围的学习历史（A4）">
            打印
          </button>
        )}
        <span className="muted">
          {activeFocus ? `语言点「${activeFocus}」· ${list.length} 条` : scope === 'article' ? articleTitle : '所有做过的金句课仿写 / 考试'}
        </span>
      </div>
      {list.length ? (
        <>
          {missingFocus && (
            <div className="golden-summary">
              这条批改记录已归档或不在当前范围；可以回错因复盘重新选一条。
            </div>
          )}
          <div className="bt-history-list">
          {page.rows.map((rec, i) => (
            <WritingHoverCard key={recordKeyOf(rec)} data={hoverDataFromRecord(rec, i)}>
              <button
                className="bt-history-row"
                onClick={() =>
                  onOpenRecord ? onOpenRecord(recordKeyOf(rec), scope) : setPickedIndex(i)
                }
                aria-label={hoverSummary(rec, i)}
              >
                <span className="muted">{new Date(rec.at).toLocaleString()}</span>
                <span className="ellipsis">{writingRecordLabel(rec)}</span>
                <span className="muted ellipsis">
                  {scope === 'all' ? rec.articleTitle || rec.articleId : rec.task?.task || rec.model}
                </span>
                <b>{rec.feedback.max > 0 ? `${rec.feedback.total}/${rec.feedback.max}` : '—'}</b>
              </button>
            </WritingHoverCard>
          ))}
          {page.rest > 0 && (
            <button
              className="bt-history-row"
              onClick={() => setShown(page.next)}
              title="记录一条都没删，只是先渲染最近这些；点这里继续往前看"
            >
              <span className="muted">显示更多（还有 {page.rest} 条）</span>
            </button>
          )}
        </div>
        </>
      ) : (
        <div className="muted">
          {activeFocus
            ? '这个语言点还没有批改记录。'
            : scope === 'article'
              ? '本篇还没有记录：做完一句仿写或整课考试，批改会自动留在这里。'
              : '还没有任何金句课批改记录。'}
        </div>
      )}
    </div>
  )
}
