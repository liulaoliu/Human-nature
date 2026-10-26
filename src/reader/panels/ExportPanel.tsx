import { useMemo, useState } from 'react'
import type { ArticleVocabEntry, VocabItem } from '../../types/document'
import { buildHeatmap } from '../../core/activity'
import {
  PRINT_CONTENT_LABEL,
  PRINT_GROUP_LABEL,
  contentKinds,
  planPrint,
  type PrintContent,
  type PrintGroupBy,
  type PrintRow,
  type PrintScope,
} from '../../core/printPlan'

export type { PrintContent, PrintGroupBy }

const SCOPE_LABEL: Record<PrintScope, string> = {
  article: '本篇',
  byArticle: '按文章',
  date: '按日期',
  unprinted: '未打印',
  all: '全部',
}

export interface ExportArticleRef {
  id: string
  title: string
  /** 同一篇的别名（saved.id / sourceKey / 标题），按篇条目可能用其中之一 */
  aliases?: string[]
  /** 这篇正文里出现过的 lemma（老数据兜底） */
  lemmas: Set<string>
}

export interface ExportPanelProps {
  onClose: () => void
  /** 整个词库（含语言点自动收藏的 词组/习语/用法） */
  libraryItems: VocabItem[]
  /** 当前打开的文章 */
  articleTitle: string
  articleWords: VocabItem[]
  /** 当前篇稳定标识（按篇打印 / 编号用） */
  articleId?: string
  /** 当前篇的「已保存」id；没保存时为空（文章包要带正文和 AI 结果，只能从已保存文章导） */
  articleSavedId?: string
  /** 按篇收录音表（有则按篇只读它，不再按正文出现推） */
  articleEntries?: ArticleVocabEntry[]
  /** 已保存文章（按篇导出用） */
  articles: ExportArticleRef[]
  /** 今天的日期键 YYYY-MM-DD */
  todayKey: string
  onPrint: (
    items: VocabItem[],
    title: string,
    numberOf?: (it: VocabItem) => number | null,
    opts?: { groupBy?: PrintGroupBy },
  ) => void
  /** 按行打印（本篇 / 按文章；保留每篇自己的编号） */
  onPrintRows?: (rows: PrintRow[], title: string) => void
  onExportAnki: (items: VocabItem[], name?: string) => void
  onExportWordList: (items: VocabItem[], name?: string, opts?: { includePhrases?: boolean }) => void
  /** 导出文章包（正文 + AI 结果 + 这篇的生词 / 语言点 + 相关学习记录）；导入侧用「合并导入」 */
  onExportArticlePackage?: (ids: string[]) => void
}

/**
 * 打印 / 导出面板：**只负责收集选择 + 渲染**。
 * 「选哪些条目、标题叫什么」全在 `core/printPlan.ts`（纯函数、有单测）。
 */
export default function ExportPanel({
  onClose,
  libraryItems,
  articleTitle,
  articleWords,
  articleId,
  articleSavedId,
  articleEntries,
  articles,
  todayKey,
  onPrint,
  onPrintRows,
  onExportAnki,
  onExportWordList,
  onExportArticlePackage,
}: ExportPanelProps) {
  const [scope, setScope] = useState<PrintScope>('article')
  const [content, setContent] = useState<PrintContent>('all')
  const [pickedArticles, setPickedArticles] = useState<Set<string>>(() => new Set(articles.map((a) => a.id)))
  const [pickedDates, setPickedDates] = useState<Set<string>>(() => new Set([todayKey]))
  const [group, setGroup] = useState<PrintGroupBy>('alphabet')

  /** 选片计划（纯计算，见 core/printPlan） */
  const plan = useMemo(
    () =>
      planPrint({
        libraryItems,
        articleItems: articleWords,
        articleId,
        articleEntries,
        articleTitle,
        articles,
        pickedArticles,
        pickedDates,
        content,
        scope,
      }),
    [libraryItems, articleWords, articleId, articleEntries, articleTitle, articles, pickedArticles, pickedDates, content, scope],
  )
  const { contentCounts, pool, articlePool, items, rows, title, dates, articleCount, unprinted, isArticleOrder, canAct } = plan
  const effectiveScope: PrintScope = scope

  /** 文章包只能按篇导：范围选「本篇」或「按文章」，且当前篇已保存 */
  const packageIds =
    effectiveScope === 'article'
      ? articleSavedId
        ? [articleSavedId]
        : []
      : effectiveScope === 'byArticle'
        ? articles.filter((a) => pickedArticles.has(a.id)).map((a) => a.id)
        : []
  const canPackage = packageIds.length > 0 && !!onExportArticlePackage
  const packageHint = !onExportArticlePackage
    ? undefined
    : effectiveScope !== 'article' && effectiveScope !== 'byArticle'
      ? '文章包只能按篇导：范围选「本篇」或「按文章」'
      : effectiveScope === 'article' && !articleSavedId
        ? '本篇还没保存：先点「保存」再导出（文章包要带正文和 AI 结果）'
        : '完整文章（正文 + AI 翻译 / 语法 / 语言点）+ 这篇的生词与语言点 + 相关学习记录；另一台电脑用「合并导入」'

  /** 新增生词的热力图（近 13 周；只用于按日期选范围） */
  const dateCount = useMemo(() => new Map(dates), [dates])
  const dateHeat = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [d, n] of dates) counts[d] = n
    return buildHeatmap(counts, 13)
  }, [dates])
  const dateKinds = contentKinds(content)

  const toggleIn = (set: Set<string>, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>🖨 打印 / 导出</b>
          <span className="muted">
            将处理 {rows.length} 条（{SCOPE_LABEL[effectiveScope]}）
          </span>
          <button onClick={onClose}>关闭</button>
        </div>

        <div className="exsec">
          <b>内容</b>
          <div className="exrow">
            {(Object.keys(PRINT_CONTENT_LABEL) as PrintContent[]).map((c) => (
              <label className="check-inline" key={c}>
                <input type="radio" checked={content === c} onChange={() => setContent(c)} />
                {PRINT_CONTENT_LABEL[c]}
                <span className="muted">{contentCounts[c]}</span>
              </label>
            ))}
            <span className="muted">共 {pool.length} 条</span>
          </div>
        </div>

        <div className="exsec">
          <b>范围</b>
          <div className="exrow">
            <label className="check-inline">
              <input type="radio" checked={effectiveScope === 'article'} onChange={() => setScope('article')} disabled={!articlePool.length} />
              本篇（{articlePool.length}）
            </label>
            <label className="check-inline">
              <input type="radio" checked={effectiveScope === 'byArticle'} onChange={() => setScope('byArticle')} disabled={!articles.length} />
              按文章（可多选）
            </label>
            <label className="check-inline">
              <input type="radio" checked={effectiveScope === 'date'} onChange={() => setScope('date')} disabled={!dates.length} />
              按日期（可多选）
            </label>
            <label className="check-inline">
              <input type="radio" checked={effectiveScope === 'unprinted'} onChange={() => setScope('unprinted')} disabled={!unprinted.length} />
              未打印（{unprinted.length}）
            </label>
            <label className="check-inline">
              <input type="radio" checked={effectiveScope === 'all'} onChange={() => setScope('all')} />
              全部（{pool.length}）
            </label>
          </div>

          {effectiveScope === 'byArticle' && (
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

          {effectiveScope === 'date' && (
            <div className="expick">
              <div className="exrow">
                <span className="muted">已选 {pickedDates.size} 天</span>
                <button onClick={() => setPickedDates(new Set(dates.map(([d]) => d)))}>全选</button>
                <button onClick={() => setPickedDates(new Set())}>清空</button>
              </div>

              {/* 热力图选日：点格子加/减；只允许点「有内容」的天 */}
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
                        const usable = !cell.future && (dateCount.get(cell.key) ?? 0) > 0
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
                                  ? `${cell.key}：${cell.count} 条（点击${on ? '移出' : '加入'}）`
                                  : `${cell.key}：没有内容`
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
                  <span className="heat-cell lv2" /> <span className="heat-cell lv3" /> <span className="heat-cell lv4" />{' '}
                  多（点格子选日期）
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
                        <span className="muted"> {dateCount.get(d) ?? 0} 条</span>
                        <button
                          onClick={() => setPickedDates((s) => toggleIn(s, d))}
                          title="移出这一天"
                          aria-label={`移出 ${d}`}
                        >
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
                    <span className="muted">{n} 条</span>
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
              <span className="muted">按本篇加入顺序编号（语言点不编号，不分组）</span>
            ) : (
              <select value={group} onChange={(e) => setGroup(e.target.value as PrintGroupBy)}>
                {(Object.keys(PRINT_GROUP_LABEL) as PrintGroupBy[]).map((g) => (
                  <option key={g} value={g}>
                    {PRINT_GROUP_LABEL[g]}
                  </option>
                ))}
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
              onClick={() => {
                if (isArticleOrder && onPrintRows) onPrintRows(rows, title)
                else onPrint(items, title, undefined, { groupBy: isArticleOrder ? undefined : group })
              }}
              title={isArticleOrder ? '按本篇加入顺序打印 A4' : '按所选分组打印 A4'}
            >
              🖨 A4 打印
            </button>
            <button disabled={!canAct} onClick={() => onExportAnki(items, title)} title="导出 Anki 可导入的 CSV">
              📦 Anki CSV
            </button>
            <button
              disabled={!canAct || content === 'usage'}
              onClick={() => onExportWordList(items, title, { includePhrases: content === 'phrases' })}
              title={
                content === 'usage'
                  ? '用法笔记是中文说明，导不出「每行一个单词」的词表'
                  : '导出纯单词表 TXT（每行一个；选「词组 / 习语」时会连词组一起导）'
              }
            >
              📄 单词表 TXT
            </button>
            <button
              disabled={!canPackage}
              onClick={() => onExportArticlePackage?.(packageIds)}
              title={packageHint}
            >
              🗂 文章包 JSON
            </button>
          </div>
          <div className="expick-title">
            打印 / 导出标题：<b>{title}</b>
          </div>
          <div className="muted extip">
            按文章 / 日期可**勾选多个**；同一词在不同篇各算一条（各打各的编号）。打印后会按篇记「已打印」，选「未打印」可只打新的。
            词组 / 习语 / 用法是语言点里**自动收藏**进来的，跟生词一起进词库{dateKinds ? '（当前内容口径）' : ''}。
            <br />
            文章包 = 单篇 / 多篇的完整迁移：正文、AI 结果、生词与语言点、这篇的学习记录（练习 / 错题 / 写作 / 回译 / 复述 / 读完）。
            活动热力图、学习时长是全局统计，不随单篇走；整库搬家用侧栏「导出全部」。
          </div>
        </div>
      </div>
    </div>
  )
}
