import { renderPrintHTML } from '../../core/exports'
import { groupItems, markPrinted, sortItems } from '../../core/vocab'
import { markArticlePrinted } from '../../core/articleVocab'
import type { VocabItem } from '../../types/document'
import type { PrintRow } from '../../core/printPlan'
import { dayKeyLocal } from '../../core/activity'
import type { ExportParams } from './exportTypes'

/** A4 打印（普通词表 / 按行词表）；成功后可回写打印时间。 */
export function createPrintActions({ library, persist, flash }: ExportParams) {
  /** A4 打印（弹新窗口）。成功后默认给这批词记上打印时间（opts.mark=false 可关掉）。 */
  const doPrint = (
    items: VocabItem[],
    title: string,
    numberOf?: (it: VocabItem) => number | null,
    opts?: { groupBy?: 'alphabet' | 'article' | 'date' | 'status'; mark?: boolean },
  ) => {
    if (!items.length) {
      flash('没有可打印的词')
      return
    }
    const sorted = numberOf
      ? [...items].sort((a, b) => (numberOf(a) ?? 1e9) - (numberOf(b) ?? 1e9))
      : sortItems(items, 'word')
    const groups = numberOf ? [{ key: '', items: sorted }] : groupItems(sorted, opts?.groupBy ?? 'alphabet')
    const day = dayKeyLocal()
    const html = renderPrintHTML({
      title,
      groups,
      subtitle: `${day} · ${items.length} 词`,
      numberOf,
    })
    const win = window.open('', '_blank')
    if (!win) {
      flash('弹窗被拦截，允许后重试')
      return
    }
    win.document.write(html)
    win.document.close()
    // 打印成功即记录时间，下次「只打未打印」可据此跳过。
    if (opts?.mark !== false) {
      persist(markPrinted(library, items.map((it) => it.id)))
    }
  }

  /**
   * 按「行」打印（每行自带篇 / 篇内编号）。同一词在不同篇各打一次，
   * 打印时间也记回各自的按篇条目，不再拿全库 lastPrintedAt 统一刷。
   */
  const doPrintRows = (rows: PrintRow[], title: string, opts?: { mark?: boolean }) => {
    if (!rows.length) {
      flash('没有可打印的词')
      return
    }
    // 同一篇的行放一组（篇内编号已由 planPrint 算好）；只有一篇时不加小标题
    const distinct = new Set(rows.map((r) => r.articleId).filter(Boolean))
    const rowGroups: { key: string; rows: PrintRow[] }[] = []
    if (distinct.size <= 1) rowGroups.push({ key: '', rows })
    else {
      const byArticle = new Map<string, PrintRow[]>()
      for (const row of rows) {
        const key = row.articleId || ''
        const list = byArticle.get(key)
        if (list) list.push(row)
        else byArticle.set(key, [row])
      }
      for (const list of byArticle.values()) {
        const name = list[0]?.articleTitle || list[0]?.articleId || '未分类'
        rowGroups.push({ key: `${name}（${list.length}）`, rows: list })
      }
    }

    const day = dayKeyLocal()
    const html = renderPrintHTML({
      title,
      groups: [],
      rowGroups,
      subtitle: `${day} · ${rows.length} 词`,
    })
    const win = window.open('', '_blank')
    if (!win) {
      flash('弹窗被拦截，允许后重试')
      return
    }
    win.document.write(html)
    win.document.close()
    if (opts?.mark !== false) {
      let lib = library
      const globalIds: string[] = []
      const byArticle = new Map<string, string[]>()
      for (const row of rows) {
        if (row.articleId) {
          const list = byArticle.get(row.articleId)
          if (list) list.push(row.item.lemma)
          else byArticle.set(row.articleId, [row.item.lemma])
        } else {
          globalIds.push(row.item.id)
        }
      }
      for (const [articleId, lemmas] of byArticle) lib = markArticlePrinted(lib, articleId, lemmas)
      if (globalIds.length) lib = markPrinted(lib, globalIds)
      persist(lib)
    }
  }

  return { doPrint, doPrintRows }
}
