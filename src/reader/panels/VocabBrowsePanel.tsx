import { useEffect, useMemo, useState } from 'react'
import type { ArticleVocabEntry, VocabItem } from '../../types/document'
import type { ReviewGrade, VocabSortBy } from '../../core/vocab'
import { sortItems } from '../../core/vocab'
import { articleEntryViewsFrom } from '../../core/articleVocab'
import type { PrintRow } from '../../core/printPlan'
import {
  browseA4Rows,
  browseVocab,
  type BrowseArticleRef,
  type BrowseKind,
  type BrowseScope,
  type BrowseStatus,
} from '../../core/vocabBrowse'
import VocabList, { type VocabEditPatch } from '../VocabList'

export interface VocabBrowsePanelProps {
  /** 入口决定首屏范围；页面内切换范围属于筛选，不写 URL。 */
  initialScope: 'all' | 'article'
  onClose: () => void

  /** 整个词库 + 按篇收录表 */
  libraryItems: VocabItem[]
  articleEntries: ArticleVocabEntry[]
  /** 当前篇（本篇范围用；没开文章为空串） */
  articleId: string
  articleTitle: string
  /** 已保存文章（选篇用） */
  articles: BrowseArticleRef[]

  /** 本篇编号 / 语境释义（A4 本篇用） */
  articleNums: Map<string, number>
  meaningOf: (word: string) => string | null

  view: 'card' | 'table'
  onViewChange: (view: 'card' | 'table') => void
  sortBy: VocabSortBy
  onSortChange: (v: VocabSortBy) => void

  focusLemma: string | null
  confirmDel: string | null
  onSpeak: (word: string) => void
  onDelete: (id: string) => void
  onReview: (id: string, grade: ReviewGrade) => void
  onEdit: (id: string, patch: VocabEditPatch) => void

  onExportAnki: (items: VocabItem[], name?: string) => void
  onPrint: (items: VocabItem[], title: string) => void
  onPrintRows?: (rows: PrintRow[], title: string) => void
  onExportWrong: (items: VocabItem[]) => void
}

const BROWSE_KIND_LABEL: Record<BrowseKind, string> = { all: '全部', word: '生词', lang: '语言点' }
const BROWSE_STATUS_LABEL: Record<BrowseStatus, string> = {
  all: '全部状态',
  due: '待复习',
  fresh: '新词',
  lapsed: '错过',
  mastered: '已掌握',
}

/**
 * 生词浏览页：全部 / 本篇 / 选篇 + 类型 / 搜索 / 日期（可多选）/ 状态 / 含已掌握。
 *
 * 只负责「收选择 + 渲染」；所有筛选口径在 `core/vocabBrowse.ts`（纯函数、有单测），
 * 本篇的归属仍走 `core/articleVocab.ts` 的 `articleEntryViewsFrom`（和侧栏、打印同一份）。
 *
 * 批量动作（Anki / A4 / 错词）一律作用于**当前筛选结果**，不是整库。
 */
export default function VocabBrowsePanel({
  initialScope,
  onClose,
  libraryItems,
  articleEntries,
  articleId,
  articleTitle,
  articles,
  articleNums,
  meaningOf,
  view,
  onViewChange,
  sortBy,
  onSortChange,
  focusLemma,
  confirmDel,
  onSpeak,
  onDelete,
  onReview,
  onEdit,
  onExportAnki,
  onPrint,
  onPrintRows,
  onExportWrong,
}: VocabBrowsePanelProps) {
  const [scope, setScope] = useState<BrowseScope>(initialScope)
  const [kind, setKind] = useState<BrowseKind>('all')
  const [query, setQuery] = useState('')
  /** 选中的入库日；空集合 = 全部日期（默认） */
  const [pickedDays, setPickedDays] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<BrowseStatus>('all')
  /** 全部默认含已掌握；本篇 / 选篇默认不含（和侧栏、打印一致）。 */
  const [includeMastered, setIncludeMastered] = useState(initialScope === 'all')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(articles.map((a) => a.id)))

  // 入口不同（/p/browse vs /p/browse-article）时重置首屏范围；筛选词保留。
  // 深链接 /p/browse-article 但文章还没加载（或没有文章）时先退回「全部」，别停在空界面。
  useEffect(() => {
    const next = initialScope === 'article' && !articleId ? 'all' : initialScope
    setScope(next)
    setIncludeMastered(next === 'all')
  }, [initialScope, articleId])

  // 已保存文章晚到（或刚保存一篇）时，选篇默认全选；用户清空过则不再硬塞。
  useEffect(() => {
    setPicked((prev) => (prev.size || !articles.length ? prev : new Set(articles.map((a) => a.id))))
  }, [articles])

  /** 浏览页和「选篇 A4」共用同一份筛选输入，避免两套口径。 */
  const browseInput = useMemo(
    () => ({
      items: libraryItems,
      scope,
      articleId,
      articleEntries,
      articles,
      pickedArticleIds: picked,
      kind,
      query,
      days: pickedDays,
      status,
      includeMastered,
    }),
    [libraryItems, scope, articleId, articleEntries, articles, picked, kind, query, pickedDays, status, includeMastered],
  )

  const result = useMemo(() => browseVocab(browseInput), [browseInput])

  /** 排序放组件（`sortItems` 是 core 的纯函数）；筛选结果本身不排序。 */
  const sorted = useMemo(() => sortItems(result.items, sortBy), [result.items, sortBy])

  /**
   * 本篇列表 / 导出的释义优先用「这篇语境下的意思」（和侧栏、A4 一致）。
   * 只换展示对象，不参与筛选：搜索 / 计数仍按词条本身的口径，避免两套结果。
   */
  const viewItems = useMemo(() => {
    if (scope !== 'article') return sorted
    return sorted.map((item) => {
      const meaning = meaningOf(item.word)
      return meaning && meaning !== item.meaning ? { ...item, meaning } : item
    })
  }, [sorted, scope, meaningOf])

  /** 本篇总数（范围选择器上显示，和侧栏「生词本 · 本篇」同口径：不含已掌握）。 */
  const articleTotal = useMemo(
    () =>
      articleId
        ? articleEntryViewsFrom(libraryItems, articleEntries, [articleId], { includeLang: true }).length
        : 0,
    [libraryItems, articleEntries, articleId],
  )

  // 换了范围后，原先选中的日期可能已经没内容了 → 只留还有内容的；全没了就回到「全部日期」。
  useEffect(() => {
    if (!pickedDays.size) return
    const avail = new Set(result.days.map(([d]) => d))
    const next = new Set([...pickedDays].filter((d) => avail.has(d)))
    if (next.size !== pickedDays.size) setPickedDays(next)
  }, [pickedDays, result.days])

  const title =
    scope === 'all' ? '全部生词' : scope === 'article' ? '本篇生词' : `所选 ${picked.size} 篇生词`

  const changeScope = (next: BrowseScope) => {
    setScope(next)
    setIncludeMastered(next === 'all')
  }

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resetFilters = () => {
    setKind('all')
    setQuery('')
    setPickedDays(new Set())
    setStatus('all')
    setIncludeMastered(scope === 'all')
    if (scope === 'picked') setPicked(new Set(articles.map((a) => a.id)))
  }

  /**
   * A4：
   *   - 本篇：用正文编号 + 本篇语境释义；
   *   - 选篇：按篇出行（同一词可跨篇重复），各篇编号，并让 `doPrintRows` 记按篇打印时间；
   *   - 全部：普通词表。
   */
  const doA4 = () => {
    if (!sorted.length) return
    if (scope === 'picked' && onPrintRows) {
      const rows = browseA4Rows(browseInput)
      if (rows.length) {
        onPrintRows(rows, title)
        return
      }
    }
    if (scope === 'article' && onPrintRows) {
      const rows: PrintRow[] = viewItems.map((item) => ({
        item,
        articleId,
        articleTitle: articleTitle || '本篇',
        number: articleNums.get(item.lemma) ?? null,
        meaning: meaningOf(item.word),
      }))
      onPrintRows(rows, '本篇生词')
      return
    }
    onPrint(viewItems, title)
  }

  const masteredFiltered = scope === 'all' ? !includeMastered : includeMastered
  const hasFilter =
    kind !== 'all' ||
    query.trim() !== '' ||
    pickedDays.size > 0 ||
    status !== 'all' ||
    (masteredFiltered && result.scopeCount > 0)

  return (
    <div className="all-vocab vocab-browse">
      <div className="vb-bar">
        <div className="bar">
          <b>{title}</b>
          <span className="muted">
            {sorted.length} / {result.scopeCount} 条
          </span>

          <label className="check-inline" title="全部 / 当前文章 / 勾选几篇">
            范围
            <select value={scope} onChange={(e) => changeScope(e.target.value as BrowseScope)}>
              <option value="all">全部（{libraryItems.length}）</option>
              <option value="article" disabled={!articleId}>
                本篇（{articleTotal}）
              </option>
              <option value="picked" disabled={!articles.length}>
                按文章（{picked.size} 篇）
              </option>
            </select>
          </label>

          <label className="check-inline" title="生词 = 普通单词；语言点 = 词组 / 习语 / 用法">
            类型
            <select value={kind} onChange={(e) => setKind(e.target.value as BrowseKind)}>
              {(Object.keys(BROWSE_KIND_LABEL) as BrowseKind[]).map((k) => (
                <option key={k} value={k}>
                  {BROWSE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>

          <input
            type="search"
            aria-label="搜索生词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜词 / 释义 / 笔记"
          />

          <div className="check-inline vb-day-filter" title="按入库日（04:00 结算），可多选">
            <span>日期</span>
            <details className="vb-days" data-testid="vb-days">
              <summary>{pickedDays.size ? `${pickedDays.size} 天` : '全部'}</summary>
              <div className="vb-day-list">
                <div className="exrow">
                  <button type="button" onClick={() => setPickedDays(new Set())}>
                    全部日期
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickedDays(new Set(result.days.map(([d]) => d)))}
                  >
                    全选
                  </button>
                </div>
                <div className="exlist">
                  {result.days.map(([d, n]) => (
                    <label className="check-inline" key={d}>
                      <input
                        type="checkbox"
                        checked={pickedDays.has(d)}
                        onChange={() =>
                          setPickedDays((prev) => {
                            const next = new Set(prev)
                            if (next.has(d)) next.delete(d)
                            else next.add(d)
                            return next
                          })
                        }
                      />
                      <span>{d}</span>
                      <span className="muted">{n}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </div>

          <label className="check-inline" title="待复习 = 已到期；新词 = 没排期、没重学；错过 = 评过「忘记了」">
            状态
            <select value={status} onChange={(e) => setStatus(e.target.value as BrowseStatus)}>
              {(Object.keys(BROWSE_STATUS_LABEL) as BrowseStatus[]).map((s) => (
                <option key={s} value={s}>
                  {BROWSE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="check-inline" title="本篇 / 选篇默认不含已掌握；要一起看就勾上">
            <input
              type="checkbox"
              checked={includeMastered}
              disabled={status === 'mastered'}
              onChange={(e) => setIncludeMastered(e.target.checked)}
            />
            含已掌握
          </label>

          <select value={sortBy} onChange={(e) => onSortChange(e.target.value as VocabSortBy)} title="排序方式">
            <option value="updatedAt">最近改动</option>
            <option value="createdAt">加入时间</option>
            <option value="due">到期时间</option>
            <option value="word">字母</option>
          </select>

          <span className="view-toggle">
            <button className={view === 'card' ? 'primary' : ''} onClick={() => onViewChange('card')}>
              卡片
            </button>
            <button className={view === 'table' ? 'primary' : ''} onClick={() => onViewChange('table')}>
              表格
            </button>
          </span>

          <button className="primary" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="bar">
          <button onClick={() => onExportAnki(viewItems, title)} disabled={!sorted.length} title="导出当前筛选结果">
            📦 Anki CSV
          </button>
          <button onClick={doA4} disabled={!sorted.length} title="打印当前筛选结果">
            🖨 A4 打印
          </button>
          <button
            onClick={() => onExportWrong(viewItems)}
            disabled={!sorted.some((it) => (it.reviewState.lapses ?? 0) > 0)}
            title="导出当前筛选结果里出错过的词"
          >
            导出错词
          </button>
          {scope === 'picked' && <span className="muted">已选 {picked.size} 篇</span>}
        </div>

        {scope === 'picked' && (
          <div className="exlist vb-picked">
            {articles.length ? (
              articles.map((a) => (
                <label className="check-inline" key={a.id}>
                  <input type="checkbox" checked={picked.has(a.id)} onChange={() => togglePicked(a.id)} />
                  <span className="ellipsis" title={a.title}>
                    {a.title}
                  </span>
                  <span className="muted">{result.articleCounts.get(a.id) ?? 0}</span>
                </label>
              ))
            ) : (
              <span className="muted">还没有已保存的文章</span>
            )}
          </div>
        )}
      </div>

      {sorted.length ? (
        <VocabList
          items={viewItems}
          view={view}
          focusLemma={focusLemma}
          confirmDel={confirmDel}
          onSpeak={onSpeak}
          onDelete={onDelete}
          onReview={onReview}
          onEdit={onEdit}
          showSource
          pageSize={200}
          numberOf={scope === 'article' ? (it) => articleNums.get(it.lemma) ?? null : undefined}
        />
      ) : (
        <div className="muted vb-empty">
          没有符合条件的生词
          {hasFilter && (
            <button onClick={resetFilters} title="清空类型 / 搜索 / 日期 / 含已掌握">
              清空筛选
            </button>
          )}
        </div>
      )}
    </div>
  )
}
