import { useMemo, useState } from 'react'
import type { VocabItem } from '../../types/document'

export type PrintGroup = 'alphabet' | 'article' | 'date' | 'status'

export interface ExportArticleRef {
  id: string
  title: string
  /** 这篇正文里出现过的 lemma（用来把「词库里的词」归到这篇） */
  lemmas: Set<string>
}

export interface ExportPanelProps {
  onClose: () => void
  /** 整个词库 */
  libraryItems: VocabItem[]
  /** 当前打开的文章 */
  articleTitle: string
  articleWords: VocabItem[]
  /** 已保存文章（按篇导出用） */
  articles: ExportArticleRef[]
  /** 今天的日期键 YYYY-MM-DD */
  todayKey: string
  onPrint: (
    items: VocabItem[],
    title: string,
    numberOf?: (it: VocabItem) => number | null,
    opts?: { groupBy?: PrintGroup },
  ) => void
  onExportAnki: (items: VocabItem[], name?: string) => void
  onExportWordList: (items: VocabItem[], name?: string) => void
}

const day = (it: VocabItem) => it.createdAt.slice(0, 10)

/**
 * 打印 / 导出面板：按**篇**、按**具体日期**、未打印或全部，选好范围与分组，
 * 再决定 A4 打印 / Anki CSV / TXT。省得在一堆按钮里猜哪个是哪个。
 */
export default function ExportPanel({
  onClose,
  libraryItems,
  articleTitle,
  articleWords,
  articles,
  todayKey,
  onPrint,
  onExportAnki,
  onExportWordList,
}: ExportPanelProps) {
  const [scope, setScope] = useState<'article' | 'byArticle' | 'date' | 'unprinted' | 'all'>(
    articleWords.length ? 'article' : 'all',
  )
  const [articleId, setArticleId] = useState(articles[0]?.id ?? '')
  const [dateKey, setDateKey] = useState(todayKey)
  const [group, setGroup] = useState<PrintGroup>('alphabet')

  /** 词库里出现过的日期（倒序）。 */
  const dates = useMemo(() => {
    const set = new Set<string>()
    for (const it of libraryItems) {
      const d = day(it)
      if (d) set.add(d)
    }
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [libraryItems])

  const unprintedCount = useMemo(() => libraryItems.filter((it) => !it.lastPrintedAt).length, [libraryItems])

  const title = useMemo(() => {
    if (scope === 'article') return articleTitle || '本篇生词'
    if (scope === 'byArticle') return `词表-${articles.find((a) => a.id === articleId)?.title ?? '未知篇'}`
    if (scope === 'date') return `词表-新增-${dateKey}`
    if (scope === 'unprinted') return '全部生词（未打印）'
    return '全部生词'
  }, [scope, articleTitle, articles, articleId, dateKey])

  const items = useMemo(() => {
    if (scope === 'article') return articleWords
    if (scope === 'byArticle') {
      const a = articles.find((x) => x.id === articleId)
      if (!a) return []
      return libraryItems.filter((it) => it.source?.fileName === a.id || a.lemmas.has(it.lemma))
    }
    if (scope === 'date') return libraryItems.filter((it) => day(it) === dateKey)
    if (scope === 'unprinted') return libraryItems.filter((it) => !it.lastPrintedAt)
    return libraryItems
  }, [scope, articleWords, articles, articleId, dateKey, libraryItems])

  // 本篇打印仍按「正文出现顺序」编号；其余按所选分组
  const isArticleOrder = scope === 'article'
  const groupLabel = isArticleOrder ? '按正文顺序编号' : ''
  const canAct = items.length > 0

  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>🖨 打印 / 导出生词</b>
          <span className="muted">将处理 {items.length} 个词</span>
          <button onClick={onClose}>关闭</button>
        </div>

        <div className="exsec">
          <b>范围</b>
          <div className="exrow">
            <label className="check-inline">
              <input type="radio" checked={scope === 'article'} onChange={() => setScope('article')} disabled={!articleWords.length} />
              本篇（{articleWords.length}）
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'byArticle'} onChange={() => setScope('byArticle')} disabled={!articles.length} />
              按文章
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'date'} onChange={() => setScope('date')} disabled={!dates.length} />
              按日期
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'unprinted'} onChange={() => setScope('unprinted')} disabled={!unprintedCount} />
              未打印（{unprintedCount}）
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
              全部（{libraryItems.length}）
            </label>
          </div>
          {scope === 'byArticle' && (
            <select value={articleId} onChange={(e) => setArticleId(e.target.value)}>
              {articles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          )}
          {scope === 'date' && (
            <select value={dateKey} onChange={(e) => setDateKey(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}（{libraryItems.filter((it) => day(it) === d).length} 词）
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="exsec">
          <b>分组</b>
          <div className="exrow">
            {isArticleOrder ? (
              <span className="muted">本篇按正文出现顺序编号（不分组）</span>
            ) : (
              <select value={group} onChange={(e) => setGroup(e.target.value as PrintGroup)}>
                <option value="alphabet">按字母</option>
                <option value="article">按文章</option>
                <option value="date">按加入日期</option>
                <option value="status">按状态</option>
              </select>
            )}
          </div>
        </div>

        <div className="exsec">
          <b>动作</b>
          <div className="exrow">
            <button
              className="primary"
              disabled={!canAct}
              onClick={() => onPrint(items, title, undefined, { groupBy: isArticleOrder ? undefined : group })}
              title={isArticleOrder ? '按正文顺序打印 A4' : `按「${groupLabel || '所选分组'}」打印 A4`}
            >
              🖨 A4 打印
            </button>
            <button disabled={!canAct} onClick={() => onExportAnki(items, title)} title="导出 Anki 可导入的 CSV">
              📦 Anki CSV
            </button>
            <button disabled={!canAct} onClick={() => onExportWordList(items, title)} title="导出纯单词表 TXT（每行一个）">
              📄 单词表 TXT
            </button>
          </div>
          <div className="muted extip">
            打印后会记「已打印」，勾「未打印」可只打新词；导出文件名会带上范围名（如「词表-新增-2026-10-15-vocab-anki.csv」）。
          </div>
        </div>
      </div>
    </div>
  )
}
