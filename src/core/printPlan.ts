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
import type { VocabItem } from '../types/document'
import { filterByKind, kindOf } from './entryKind'
import { dayKeyLocal } from './activity'
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
  /** 这篇正文里出现过的 lemma（用来把「词库里的词」归到这篇） */
  lemmas: Set<string>
}

export interface PrintPlanInput {
  /** 整个词库 */
  libraryItems: VocabItem[]
  /** 当前这篇的条目 */
  articleItems: VocabItem[]
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
  const scope: PrintScope = input.scope === 'article' && !articlePool.length ? 'all' : input.scope

  const dates = new Map<string, number>()
  for (const it of pool) {
    const d = dayOf(it)
    dates.set(d, (dates.get(d) ?? 0) + 1)
  }
  const datesSorted: [string, number][] = [...dates.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  const unprinted = pool.filter((it) => !it.lastPrintedAt)
  const articleCount = new Map(
    input.articles.map((a) => [
      a.id,
      pool.filter((it) => it.source?.fileName === a.id || a.lemmas.has(it.lemma)).length,
    ]),
  )

  let items: VocabItem[]
  if (scope === 'article') items = articlePool
  else if (scope === 'byArticle') {
    const picked = input.articles.filter((a) => input.pickedArticles.has(a.id))
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
    items = out
  } else if (scope === 'date') items = pool.filter((it) => input.pickedDates.has(dayOf(it)))
  else if (scope === 'unprinted') items = unprinted
  else items = pool

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
    title,
    dates: datesSorted,
    articleCount,
    unprinted,
    isArticleOrder: scope === 'article',
    canAct: items.length > 0,
  }
}
