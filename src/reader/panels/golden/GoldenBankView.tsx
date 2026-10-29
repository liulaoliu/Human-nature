import { useMemo, useState } from 'react'
import { GOLDEN_TARGET_KIND_LABEL } from '../../../core/golden'
import { filterGoldenBank, type GoldenBankKind, type GoldenBankStatus } from '../../../core/goldenBank'
import type { GoldenBankViewProps } from './types'

export default function GoldenBankView({
  rows,
  onBack,
  onExportMarkdown,
  onExportAnki,
  onPrint,
}: GoldenBankViewProps) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GoldenBankStatus>('all')
  const [kind, setKind] = useState<GoldenBankKind>('all')
  const filtered = useMemo(() => filterGoldenBank(rows, { query, status, kind }), [rows, query, status, kind])
  /** 类型按钮上的计数：按当前搜索/状态算，避免点了没结果 */
  const kindCounts = useMemo(() => {
    const base = filterGoldenBank(rows, { query, status })
    const out = new Map<GoldenBankKind, number>()
    out.set('all', base.length)
    for (const r of base) {
      const kinds = new Set(r.targets.map((t) => t.kind))
      for (const k of kinds) out.set(k, (out.get(k) ?? 0) + 1)
    }
    return out
  }, [rows, query, status])
  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 课程页</button>
        <b>全库金句本</b>
        <span className="muted">{filtered.length}/{rows.length} 句</span>
        {onExportMarkdown && <button onClick={onExportMarkdown}>导出 Markdown</button>}
        {onExportAnki && <button onClick={onExportAnki}>导出 Anki</button>}
        {onPrint && <button onClick={onPrint}>打印金句本</button>}
      </div>
      <div className="bar golden-modes">
        <input
          className="golden-bank-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索英文 / 中文 / 句型 / 词块"
        />
        {(['all', 'todo', 'mastered', 'due'] as const).map((k) => (
          <button key={k} className={status === k ? 'primary' : ''} onClick={() => setStatus(k)}>
            {k === 'all' ? '全部' : k === 'todo' ? '待掌握' : k === 'mastered' ? '已掌握' : '待回顾'}
          </button>
        ))}
      </div>
      <div className="bar golden-modes">
        <span className="muted">类型</span>
        {(['all', 'pattern', 'tense', 'collocation', 'idiom', 'usage', 'word'] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? 'primary' : ''}
            onClick={() => setKind(k)}
            title={k === 'all' ? '不按学习点类型筛' : `只看含「${GOLDEN_TARGET_KIND_LABEL[k]}」学习点的金句`}
          >
            {k === 'all' ? '全部类型' : GOLDEN_TARGET_KIND_LABEL[k]}
            <span className="muted"> {kindCounts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="golden-bank-list">
        {filtered.map((r) => (
          <div className="golden-bank-row" key={`${r.articleId}|${r.sentenceId}`}>
            <div className="golden-bank-head">
              <b>{r.articleTitle}</b>
              <span className="muted">{r.sentenceId}</span>
              {r.due && <span className="golden-bank-due">待回顾</span>}
              {r.mastered && <span className="golden-good">已掌握</span>}
            </div>
            <div className="golden-en">{r.text}</div>
            {r.zh && <div className="muted">{r.zh}</div>}
            {r.pattern && <div className="golden-note">句型：{r.pattern}</div>}
            {r.tense && <div className="golden-note">时态：{r.tense}</div>}
            <div className="golden-targets">
              {r.targets.map((t, i) => (
                <span className="golden-target" key={i}>
                  <b>{GOLDEN_TARGET_KIND_LABEL[t.kind]}</b> {t.en}{t.zh ? ` — ${t.zh}` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
        {!filtered.length && <div className="muted">没有匹配的金句。</div>}
      </div>
    </div>
  )
}
