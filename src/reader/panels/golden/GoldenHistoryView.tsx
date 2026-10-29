import { useMemo, useState } from 'react'
import GoldenFeedback from './GoldenFeedback'
import { writingRecordLabel, type WritingRecord } from '../../../core/writing'

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
}: {
  /** `article` = 本篇，`all` = 全库（已按来源筛过，都是金句课记录） */
  rows: { article: WritingRecord[]; all: WritingRecord[] }
  articleTitle?: string
  onBack: () => void
  /** 打印当前范围（A4）；没注入就不显示按钮 */
  onPrint?: (rows: WritingRecord[], title: string) => void
}) {
  const [scope, setScope] = useState<Scope>('article')
  const [focus, setFocus] = useState('')
  const [pickedIndex, setPickedIndex] = useState<number | null>(null)

  const scoped = useMemo(
    () => [...(scope === 'all' ? rows.all : rows.article)].sort((a, b) => b.at.localeCompare(a.at)),
    [rows, scope],
  )
  /** 当前范围里出现过的语言点（带条数）；没练过语言点时为空 */
  const focuses = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of scoped) {
      const f = r.task?.focus?.trim()
      if (f) map.set(f, (map.get(f) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [scoped])
  const activeFocus = focus && focuses.some(([f]) => f === focus) ? focus : ''
  const list = activeFocus ? scoped.filter((r) => (r.task?.focus ?? '').trim() === activeFocus) : scoped

  const picked = pickedIndex !== null ? list[pickedIndex] : null
  if (picked) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={() => setPickedIndex(null)}>← 历史列表</button>
          <button
            onClick={() => setPickedIndex((i) => Math.max(0, (i ?? 0) - 1))}
            disabled={(pickedIndex ?? 0) <= 0}
            title="看更早一条"
          >
            ◀ 上一条
          </button>
          <span className="muted">
            第 {(pickedIndex ?? 0) + 1}/{list.length} 条 · {new Date(picked.at).toLocaleString()}
          </span>
          <button
            onClick={() => setPickedIndex((i) => Math.min(list.length - 1, (i ?? 0) + 1))}
            disabled={(pickedIndex ?? 0) >= list.length - 1}
            title="看更新一条"
          >
            下一条 ▶
          </button>
          <b>{writingRecordLabel(picked)}</b>
          {picked.articleTitle && <span className="muted">{picked.articleTitle}</span>}
          <button onClick={onBack}>课程页</button>
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
        <div className="bt-history-list">
          {list.map((rec, i) => (
            <button
              key={`${rec.at}-${i}`}
              className="bt-history-row"
              onClick={() => setPickedIndex(i)}
              title={hoverSummary(rec, i)}
            >
              <span className="muted">{new Date(rec.at).toLocaleString()}</span>
              <span className="ellipsis">{writingRecordLabel(rec)}</span>
              <span className="muted ellipsis">
                {scope === 'all' ? rec.articleTitle || rec.articleId : rec.task?.task || rec.model}
              </span>
              <b>{rec.feedback.max > 0 ? `${rec.feedback.total}/${rec.feedback.max}` : '—'}</b>
            </button>
          ))}
        </div>
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
