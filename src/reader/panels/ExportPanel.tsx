import { useMemo, useState } from 'react'
import type { VocabItem, VocabKind } from '../../types/document'
import { buildHeatmap } from '../../core/activity'
import { dayKeyLocal } from '../../core/activity'
import { filterByKind } from '../../core/vocab'

export type PrintGroup = 'alphabet' | 'article' | 'date' | 'status'

/** 打印/导出的「内容」：只要单词、只要词组习语、只要用法笔记，或全部。 */
export type PrintContent = 'all' | 'word' | 'phrases' | 'usage'

const CONTENT_LABEL: Record<PrintContent, string> = {
  all: '全部',
  word: '单词',
  phrases: '词组 / 习语',
  usage: '用法笔记',
}

/** 「内容」→ 要保留的词条类型（null = 不过滤）。 */
function contentKinds(c: PrintContent): VocabKind[] | null {
  if (c === 'word') return ['word']
  if (c === 'phrases') return ['phrase', 'idiom']
  if (c === 'usage') return ['usage']
  return null
}

export interface ExportArticleRef {
  id: string
  title: string
  /** 这篇正文里出现过的 lemma（用来把「词库里的词」归到这篇） */
  lemmas: Set<string>
}

export interface ExportPanelProps {
  onClose: () => void
  /** 整个词库（含语言点自动收藏的 词组/习语/用法） */
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
  onExportWordList: (items: VocabItem[], name?: string, opts?: { includePhrases?: boolean }) => void
}

const day = (it: VocabItem) => dayKeyLocal(new Date(it.createdAt))

type Scope = 'article' | 'byArticle' | 'date' | 'unprinted' | 'all'

/**
 * 打印 / 导出面板：按**篇**（可多选）、按**具体日期**（可多选）、未打印或全部，
 * 选好范围与分组，再决定 A4 打印 / Anki CSV / TXT。
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
  const [scopeState, setScope] = useState<Scope>(articleWords.length ? 'article' : 'all')
  const [content, setContent] = useState<PrintContent>('all')
  const [pickedArticles, setPickedArticles] = useState<Set<string>>(() => new Set(articles.map((a) => a.id)))
  const [pickedDates, setPickedDates] = useState<Set<string>>(() => new Set([todayKey]))
  const [group, setGroup] = useState<PrintGroup>('alphabet')

  /** 按「内容」筛过的工作集：后面所有范围/分组/导出都基于它（打印选项因此完全复用）。 */
  const kinds = contentKinds(content)
  const pool = useMemo(() => filterByKind(libraryItems, kinds), [libraryItems, kinds])
  const articlePool = useMemo(() => filterByKind(articleWords, kinds), [articleWords, kinds])
  // 换「内容」后本篇可能一条都没有：那时自动回落到「全部」，别卡在一个空范围上
  const scope: Scope = scopeState === 'article' && !articlePool.length ? 'all' : scopeState

  /** 词库里出现过的日期（倒序，带当天条数）。 */
  const dates = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of pool) {
      const d = day(it)
      if (d) m.set(d, (m.get(d) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [pool])
  /** 日期 → 当天新增词数（热力图 + 回显用）。 */
  const dateCount = useMemo(() => new Map(dates), [dates])
  const hasWordsOn = (d: string) => (dateCount.get(d) ?? 0) > 0
  /** 新增生词的热力图（近 13 周；只用于按日期选范围）。 */
  const dateHeat = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [d, n] of dates) counts[d] = n
    return buildHeatmap(counts, 13)
  }, [dates])

  const articleCount = useMemo(
    () => new Map(articles.map((a) => [a.id, pool.filter((it) => it.source?.fileName === a.id || a.lemmas.has(it.lemma)).length])),
    [articles, pool],
  )

  const unprinted = useMemo(() => pool.filter((it) => !it.lastPrintedAt), [pool])

  const items = useMemo(() => {
    if (scope === 'article') return articlePool
    if (scope === 'byArticle') {
      const picked = articles.filter((a) => pickedArticles.has(a.id))
      const out: VocabItem[] = []
      const seen = new Set<string>()
      for (const a of picked) {
        for (const it of pool) {
          if (seen.has(it.id)) continue
          if (it.source?.fileName === a.id || a.lemmas.has(it.lemma)) {
            seen.add(it.id)
            out.push(it)
          }
        }
      }
      return out
    }
    if (scope === 'date') return pool.filter((it) => pickedDates.has(day(it)))
    if (scope === 'unprinted') return unprinted
    return pool
  }, [scope, articlePool, articles, pickedArticles, pickedDates, pool, unprinted])

  const title = useMemo(() => {
    const name = content === 'phrases' ? '词组习语表' : content === 'usage' ? '用法笔记' : '词表'
    if (scope === 'article') return content === 'all' ? articleTitle || '本篇生词' : `${articleTitle || '本篇'}·${name}`
    if (scope === 'byArticle') {
      const names = articles.filter((a) => pickedArticles.has(a.id)).map((a) => a.title)
      return names.length === 1 ? `${name}-${names[0]}` : `${name}-${names.length}篇`
    }
    if (scope === 'date') {
      const ds = [...pickedDates].sort()
      return ds.length === 1 ? `${name}-新增-${ds[0]}` : `${name}-新增-${ds.length}天`
    }
    if (scope === 'unprinted') return `全部${content === 'all' ? '生词' : CONTENT_LABEL[content]}（未打印）`
    return `全部${content === 'all' ? '生词' : CONTENT_LABEL[content]}`
  }, [scope, content, articleTitle, articles, pickedArticles, pickedDates])

  const toggleIn = (set: Set<string>, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  const isArticleOrder = scope === 'article'
  const canAct = items.length > 0

  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>🖨 打印 / 导出</b>
          <span className="muted">将处理 {items.length} 条</span>
          <button onClick={onClose}>关闭</button>
        </div>

        <div className="exsec">
          <b>内容</b>
          <div className="exrow">
            {(['all', 'word', 'phrases', 'usage'] as PrintContent[]).map((c) => (
              <label className="check-inline" key={c} title={c === 'phrases' ? '语言点里收藏的词组与习语' : c === 'usage' ? '语言点里收藏的用法笔记（中文）' : undefined}>
                <input type="radio" checked={content === c} onChange={() => setContent(c)} />
                {CONTENT_LABEL[c]}
              </label>
            ))}
            <span className="muted">共 {pool.length} 条</span>
          </div>
        </div>

        <div className="exsec">
          <b>范围</b>
          <div className="exrow">
            <label className="check-inline">
              <input type="radio" checked={scope === 'article'} onChange={() => setScope('article')} disabled={!articlePool.length} />
              本篇（{articlePool.length}）
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'byArticle'} onChange={() => setScope('byArticle')} disabled={!articles.length} />
              按文章（可多选）
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'date'} onChange={() => setScope('date')} disabled={!dates.length} />
              按日期（可多选）
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'unprinted'} onChange={() => setScope('unprinted')} disabled={!unprinted.length} />
              未打印（{unprinted.length}）
            </label>
            <label className="check-inline">
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
              全部（{pool.length}）
            </label>
          </div>

          {scope === 'byArticle' && (
            <div className="expick">
              <div className="exrow">
                <span className="muted">已选 {pickedArticles.size} 篇</span>
                <button onClick={() => setPickedArticles(new Set(articles.map((a) => a.id)))}>全选</button>
                <button onClick={() => setPickedArticles(new Set())}>清空</button>
              </div>
              <div className="exlist">
                {articles.map((a) => (
                  <label className="check-inline" key={a.id}>
                    <input
                      type="checkbox"
                      checked={pickedArticles.has(a.id)}
                      onChange={() => setPickedArticles((s) => toggleIn(s, a.id))}
                    />
                    <span className="ellipsis" title={a.title}>
                      {a.title}
                    </span>
                    <span className="muted">{articleCount.get(a.id) ?? 0}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {scope === 'date' && (
            <div className="expick">
              <div className="exrow">
                <span className="muted">已选 {pickedDates.size} 天</span>
                <button onClick={() => setPickedDates(new Set(dates.filter(([d]) => hasWordsOn(d)).map(([d]) => d)))}>
                  全选
                </button>
                <button onClick={() => setPickedDates(new Set())}>清空</button>
              </div>

              {/* 热力图选日：点格子加/减；只允许点「有新增生词」的天 */}
              <div className="exheat">
                <div className="heat">
                  <div className="heat-months">
                    {dateHeat.monthLabels.map((m) => (
                      <span key={`${m.col}-${m.label}`} style={{ gridColumn: m.col + 1 }}>
                        {m.label}月
                      </span>
                    ))}
                  </div>
                  <div className="heat-grid">
                    {dateHeat.cells.map((col, ci) =>
                      col.map((cell, ri) => {
                        const on = pickedDates.has(cell.key)
                        const usable = !cell.future && hasWordsOn(cell.key)
                        return (
                          <span
                            key={`${ci}-${ri}`}
                            className={
                              'heat-cell' +
                              (cell.future ? ' future' : ' lv' + cell.level) +
                              (on ? ' on' : '') +
                              (usable ? ' act' : '')
                            }
                            title={
                              cell.future
                                ? ''
                                : usable
                                  ? `${cell.key}：新增 ${cell.count} 词（点击${on ? '移出' : '加入'}）`
                                  : `${cell.key}：没有新增生词`
                            }
                            onClick={usable ? () => setPickedDates((s) => toggleIn(s, cell.key)) : undefined}
                          />
                        )
                      }),
                    )}
                  </div>
                </div>
                <div className="muted heat-legend">
                  少 <span className="heat-cell lv0" /> <span className="heat-cell lv1" />{' '}
                  <span className="heat-cell lv2" /> <span className="heat-cell lv3" />{' '}
                  <span className="heat-cell lv4" /> 多（点格子选日期）
                </div>
              </div>

              {/* 选了哪些天 —— 热力图日期不明显，这里明确列出来（可单条移除） */}
              {pickedDates.size > 0 && (
                <div className="expicked">
                  {[...pickedDates]
                    .sort()
                    .reverse()
                    .map((d) => (
                      <span className="expick-chip" key={d}>
                        {d}
                        <span className="muted"> {dateCount.get(d) ?? 0} 词</span>
                        <button onClick={() => setPickedDates((s) => toggleIn(s, d))} title="移出这一天">
                          ×
                        </button>
                      </span>
                    ))}
                </div>
              )}

              <div className="exlist">
                {dates.map(([d, n]) => (
                  <label className="check-inline" key={d}>
                    <input
                      type="checkbox"
                      checked={pickedDates.has(d)}
                      onChange={() => setPickedDates((s) => toggleIn(s, d))}
                    />
                    <span>{d}</span>
                    <span className="muted">{n} 词</span>
                  </label>
                ))}
              </div>
            </div>
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
              title={isArticleOrder ? '按正文顺序打印 A4' : '按所选分组打印 A4'}
            >
              🖨 A4 打印
            </button>
            <button disabled={!canAct} onClick={() => onExportAnki(items, title)} title="导出 Anki 可导入的 CSV">
              📦 Anki CSV
            </button>
            <button
              disabled={!canAct || content === 'usage'}
              onClick={() =>
                onExportWordList(items, title, { includePhrases: content === 'phrases' })
              }
              title={
                content === 'usage'
                  ? '用法笔记是中文说明，导不出「每行一个单词」的词表'
                  : '导出纯单词表 TXT（每行一个；选「词组 / 习语」时会连词组一起导）'
              }
            >
              📄 单词表 TXT
            </button>
          </div>
          <div className="muted extip">
            按文章/日期可**勾选多个**（同一条只算一次）。打印后会记「已打印」，选「未打印」可只打新的。
            词组/习语/用法是语言点里**自动收藏**进来的，跟生词一起进词库。
          </div>
        </div>
      </div>
    </div>
  )
}
