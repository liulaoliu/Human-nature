/**
 * 打印 / 导出的**选片计划**（纯函数）：把「内容 + 范围 + 分组」算成「要打哪些条目、标题叫什么」。
 *
 * 为什么从 ExportPanel 里抽出来：面板原本内联了 150 行领域判断（按日期筛、未打印筛、
 * 多选文章归并、标题拼接……）。这类逻辑放进组件有三宗罪：
 *   1. 测不了（要挂 React / DOM 才能验）；
 *   2. 和别的视图（侧栏「A4（本篇）」/ Anki 按钮）各写一份，规矩会漂；
 *   3. 组件越来越胖。
 * 现在面板只负责「收集用户选择 + 渲染」，判断全在这里，单测覆盖。
 */
import type { ArticleVocabEntry, VocabItem } from '../types/document'
import { filterByKind, kindOf } from './entryKind'
import { dayKeyLocal } from './activity'
import { articleEntryViewsFrom } from './articleVocab'
import { resolveArticleMeaning } from './articleMeaning'
import type { VocabKind } from '../types/document'

/** 分组方式（与打印模板一致）。 */
export type PrintGroupBy = 'alphabet' | 'article' | 'date' | 'status'
/** 内容口径：只打单词 / 只要语言点 / 全都要。 */
export type PrintContent = 'all' | 'word' | 'phrases' | 'usage'
/** 范围口径。 */
export type PrintScope = 'article' | 'byArticle' | 'date' | 'unprinted' | 'all'

export const PRINT_GROUP_LABEL: Record<PrintGroupBy, string> = {
  alphabet: '按字母',
  article: '按文章',
  date: '按加入日期',
  status: '按状态',
}

export const PRINT_CONTENT_LABEL: Record<PrintContent, string> = {
  all: '全部',
  word: '单词',
  phrases: '词组 / 习语',
  usage: '用法笔记',
}

/** 「内容」→ 要保留的类型（null = 不过滤）。 */
export function contentKinds(c: PrintContent): VocabKind[] | null {
  if (c === 'word') return ['word']
  if (c === 'phrases') return ['phrase', 'idiom']
  if (c === 'usage') return ['usage']
  return null
}

/** 一篇可参与「按文章」导出的文章。 */
export interface PrintArticleRef {
  id: string
  title: string
  /** 同一篇文章的其他键（如保存 id / 书内 key），按篇条目可能用其中之一 */
  aliases?: string[]
  /** 老字段：正文里出现过的 lemma；没有按篇条目时兜底用 */
  lemmas?: Set<string>
}

/** 打印/导出的一行：同一词条在不同篇可以有不同编号，所以不能再只传 VocabItem。 */
export interface PrintRow {
  item: VocabItem
  /** 这一行属于哪篇（全局范围可能为空） */
  articleId: string
  articleTitle: string
  /** 本篇编号（全局范围 / 语言点为空） */
  number: number | null
  /** 这一篇语境下的释义（没有则用 item.meaning） */
  meaning?: string | null
}

export interface PrintPlanInput {
  /** 整个词库 */
  libraryItems: VocabItem[]
  /** 当前这篇的条目 */
  articleItems: VocabItem[]
  /** 当前这篇的稳定标识 */
  articleId?: string
  /** 按篇收录表（不传 = 老测试兼容，按 source/lemmas 兜底） */
  articleEntries?: ArticleVocabEntry[]
  /** 当前这篇的标题（空则用兜底名） */
  articleTitle: string
  articles: PrintArticleRef[]
  pickedArticles: Set<string>
  pickedDates: Set<string>
  content: PrintContent
  scope: PrintScope
}

export interface PrintPlan {
  /** 每个「内容」口径有多少条（面板上直接显示，免得用户猜） */
  contentCounts: Record<PrintContent, number>
  /** 内容过滤后的全库 / 本篇 */
  pool: VocabItem[]
  articlePool: VocabItem[]
  /** 最终要处理的条目 */
  items: VocabItem[]
  /** 最终要处理的「行」：带篇名与篇内编号，按文章范围时允许跨篇重复 */
  rows: PrintRow[]
  title: string
  /** 有内容的日期（倒序，带条数）——热力图与日期列表用 */
  dates: [string, number][]
  /** 每篇的条数（「按文章」列表用） */
  articleCount: Map<string, number>
  unprinted: VocabItem[]
  /** 本篇按正文顺序编号（不分组） */
  isArticleOrder: boolean
  canAct: boolean
}

const dayOf = (it: VocabItem) => dayKeyLocal(new Date(it.createdAt))

/**
 * 算出这次要打什么。**纯函数**：给同样的输入永远同样的输出（面板可以随便重渲染）。
 * `scope === 'article'` 但本篇过滤后为空时，自动降级到 `all`（否则会卡在一个空范围上）。
 */
export function planPrint(input: PrintPlanInput): PrintPlan {
  const kinds = contentKinds(input.content)
  const contentCounts: Record<PrintContent, number> = { all: input.libraryItems.length, word: 0, phrases: 0, usage: 0 }
  for (const it of input.libraryItems) {
    const k = kindOf(it)
    if (k === 'word') contentCounts.word++
    else if (k === 'usage') contentCounts.usage++
    else contentCounts.phrases++
  }
  const pool = filterByKind(input.libraryItems, kinds)
  const articlePool = filterByKind(input.articleItems, kinds)
  // 本篇就是本篇：没词就空着，绝不降级成「全库」（否则新文章会白捡总词库的词）。
  const scope: PrintScope = input.scope

  const dates = new Map<string, number>()
  for (const it of pool) {
    const d = dayOf(it)
    dates.set(d, (dates.get(d) ?? 0) + 1)
  }
  const datesSorted: [string, number][] = [...dates.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  const unprinted = pool.filter((it) => !it.lastPrintedAt)
  const articleTitleById = new Map<string, string>()
  for (const a of input.articles) {
    articleTitleById.set(a.id, a.title)
    for (const alias of a.aliases ?? []) articleTitleById.set(alias, a.title)
  }

  /** 某篇的行：按篇条目顺序、篇内 1..n；同一词在别的篇可以再出现一次。 */
  const rowsForArticle = (a: PrintArticleRef): PrintRow[] => {
    const ids = new Set([a.id, ...(a.aliases ?? [])])
    const rows: PrintRow[] = []
    if (input.articleEntries !== undefined) {
      const views = articleEntryViewsFrom(input.libraryItems, input.articleEntries, ids, {
        includeLang: true,
        includeMastered: false,
      })
      let wordNo = 0
      for (const { entry, item } of views) {
        if (kinds && !kinds.includes(kindOf(item))) continue
        const resolved = resolveArticleMeaning(item, entry, entry.articleId, entry.sentenceId)
        const isWord = kindOf(item) === 'word'
        if (isWord) wordNo += 1
        rows.push({
          item,
          articleId: entry.articleId,
          articleTitle: a.title,
          number: isWord ? wordNo : null,
          meaning: resolved?.text ?? null,
        })
      }
      return rows
    }
    // 老测试 / 老调用方：没有按篇表时退回 source + 正文 lemma
    const seen = new Set<string>()
    let wordNo = 0
    for (const item of pool) {
      if (seen.has(item.lemma)) continue
      if (item.source?.fileName === a.id || a.lemmas?.has(item.lemma)) {
        seen.add(item.lemma)
        const isWord = kindOf(item) === 'word'
        if (isWord) wordNo += 1
        rows.push({ item, articleId: a.id, articleTitle: a.title, number: isWord ? wordNo : null })
      }
    }
    return rows
  }

  const rowsForItems = (items: VocabItem[]): PrintRow[] =>
    items.map((item) => {
      const articleId = item.source?.fileName ?? ''
      return {
        item,
        articleId,
        articleTitle: articleTitleById.get(articleId) ?? (articleId || input.articleTitle || '未分类'),
        number: null,
      }
    })

  let rows: PrintRow[]
  if (scope === 'article') {
    const articleId = input.articleId ?? ''
    const currentEntries = new Map(
      (input.articleEntries ?? [])
        .filter((e) => !articleId || e.articleId === articleId)
        .map((e) => [e.lemma, e]),
    )
    rows = articlePool.map((item) => {
      const entry = currentEntries.get(item.lemma)
      const resolved = entry ? resolveArticleMeaning(item, entry, entry.articleId, entry.sentenceId) : null
      return {
        item,
        articleId,
        articleTitle: input.articleTitle || '本篇',
        number: null,
        meaning: resolved?.text ?? null,
      }
    })
    let wordNo = 0
    for (const row of rows) {
      if (kindOf(row.item) === 'word') row.number = ++wordNo
    }
  } else if (scope === 'byArticle') {
    const picked = input.articles.filter((a) => input.pickedArticles.has(a.id))
    rows = picked.flatMap((a) => rowsForArticle(a))
  } else if (scope === 'date') rows = rowsForItems(pool.filter((it) => input.pickedDates.has(dayOf(it))))
  else if (scope === 'unprinted') rows = rowsForItems(unprinted)
  else rows = rowsForItems(pool)

  const items = rows.map((r) => r.item)
  const articleCount = new Map(input.articles.map((a) => [a.id, rowsForArticle(a).length]))

  const base = input.content === 'phrases' ? '词组习语表' : input.content === 'usage' ? '用法笔记' : '词表'
  let title: string
  if (scope === 'article') title = input.content === 'all' ? input.articleTitle || '本篇生词' : `${input.articleTitle || '本篇'}·${base}`
  else if (scope === 'byArticle') {
    const names = input.articles.filter((a) => input.pickedArticles.has(a.id)).map((a) => a.title)
    title = names.length === 1 ? `${base}-${names[0]}` : `${base}-${names.length}篇`
  } else if (scope === 'date') {
    const ds = [...input.pickedDates].sort()
    title = ds.length === 1 ? `${base}-新增-${ds[0]}` : `${base}-新增-${ds.length}天`
  } else if (scope === 'unprinted') title = `全部${input.content === 'all' ? '生词' : PRINT_CONTENT_LABEL[input.content]}（未打印）`
  else title = `全部${input.content === 'all' ? '生词' : PRINT_CONTENT_LABEL[input.content]}`

  return {
    contentCounts,
    pool,
    articlePool,
    items,
    rows,
    title,
    dates: datesSorted,
    articleCount,
    unprinted,
    isArticleOrder: scope === 'article' || scope === 'byArticle',
    canAct: rows.length > 0,
  }
}
