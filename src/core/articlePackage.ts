/**
 * 文章包（单篇 / 多篇）导出：把选中的文章连同**它生成的内容**打成一个 JSON。
 *
 * 与整库备份的区别（见 docs/STORAGE.md §五）：
 *   - 整库备份 = 换电脑 / 全量还原，词库、全部文章、全局统计一起走；
 *   - 文章包 = 只搬这一篇：正文 + AI 结果（翻译 / 语法 / 语言点 / 生词 / 搭配）+
 *     这篇的词条与按篇收录 + 能归属到这篇的学习记录。
 * 另一台电脑用「合并导入」并进来（词库按 lemma 去重、记录按 id / 天去重）。
 *
 * 口径（谁是事实来源谁负责算）：
 *   - 正文与 AI 结果都在 `SavedArticle.sentences`，整篇带上，不另做一份；
 *   - 词条 / 按篇收录 / 句子原文共享表从 `library` 按文章归属键过滤；
 *   - 学习记录只带**能归属到这一篇**的：练习、错题、读完、写作、回译、复述、略读、答题事件。
 *     活动热力图 / 学习时长 / 选词会话是按天的全局统计，不进单篇包（合并会重复累加）。
 */
import type { SavedArticle, VocabLibrary } from '../types/document'
import type { AnswerEvent } from './answerEvents'
import type { GoldenDrillRecord } from './goldenProgress'
import type { BackTranslationRecord } from './backTranslate'
import type { ReadDone } from './goals'
import type { RetellRecord } from './learning'
import type { MistakeEntry } from './mistakes'
import type { PracticeRecord } from './practice'
import { sentenceTextKey } from './vocab/sentenceTexts'
import type { WritingRecord } from './writing'

/** 文章包的文件标记：导入侧据此拒绝「覆盖导入」，避免把整库清成只剩这一篇。 */
export const ARTICLE_PACKAGE_FORMAT = 'xueba-article-package'

/** 能按篇归属、随文章包一起走的学习记录。 */
export interface ArticlePackageLearning {
  practice?: PracticeRecord[]
  mistakes?: MistakeEntry[]
  readDone?: ReadDone[]
  writingHistory?: WritingRecord[]
  backTranslations?: BackTranslationRecord[]
  retells?: RetellRecord[]
  /** 略读过的文章标识 */
  skimmed?: string[]
  answerEvents?: AnswerEvent[]
  /** D老师小课堂：这篇的逐句进度 */
  goldenDrills?: GoldenDrillRecord[]
}

export interface ArticlePackageInput {
  /** 全部已保存文章；函数按 `articleIds` 挑 */
  articles: SavedArticle[]
  /** 要打包的文章 id（`SavedArticle.id`） */
  articleIds: string[]
  library: VocabLibrary
  learning?: ArticlePackageLearning
  /** 导出时刻（测试可固定） */
  exportedAt?: string
}

/** 顶层字段与整库备份同名，现有「合并导入」无需改解析就能吃下。 */
export interface ArticlePackage extends ArticlePackageLearning {
  format: typeof ARTICLE_PACKAGE_FORMAT
  version: 1
  exportedAt: string
  articles: SavedArticle[]
  library: VocabLibrary
}

/**
 * 一篇已保存文章的归属键：按篇收录 / 词条语境可能用 saved.id、sourceKey 或（旧数据）标题。
 *
 * 标题只给「手动粘贴」的文章兜底：内置 / 书里的文章有 sourceKey，按标题兜底会把同名文章
 * 的条目误带进来。
 */
export function articlePackageAliases(article: SavedArticle): string[] {
  const keys = [article.id, article.sourceKey ?? ''].filter((k) => k.length > 0)
  if (!article.sourceKey && article.title) keys.push(article.title)
  return [...new Set(keys)]
}

function refKey(ref: { articleId?: string | null; fileName?: string | null } | null | undefined): string {
  return ref ? ref.articleId || ref.fileName || '' : ''
}

export function buildArticlePackage(input: ArticlePackageInput): ArticlePackage {
  const wanted = new Set(input.articleIds)
  const articles = input.articles.filter((a) => wanted.has(a.id))

  const keys = new Set<string>()
  for (const a of articles) for (const k of articlePackageAliases(a)) keys.add(k)

  const entries = (input.library.articleEntries ?? []).filter((e) => keys.has(e.articleId))
  const entryLemmas = new Set(entries.map((e) => e.lemma))

  /** 词条归属这篇的三种证据：按篇收录过 / 来源是这篇 / 语境出现在这篇。 */
  const belongs = (it: VocabLibrary['items'][number]) =>
    entryLemmas.has(it.lemma) ||
    keys.has(refKey(it.source)) ||
    (it.contexts ?? []).some((c) => keys.has(refKey(c)))

  const baseItems = input.library.items.filter(belongs)
  const baseIds = new Set(baseItems.map((it) => it.id))

  // 错题本里「词条错题」没有 articleId，只能靠 itemId 归属：这些词本身也要带上，否则错题成了空指。
  const mistakes = (input.learning?.mistakes ?? []).filter(
    (m) => (m.articleId ? keys.has(m.articleId) : false) || (m.itemId ? baseIds.has(m.itemId) : false),
  )
  const mistakeItemIds = new Set(mistakes.map((m) => m.itemId).filter((id): id is string => !!id))
  const items = baseItems.concat(
    input.library.items.filter((it) => mistakeItemIds.has(it.id) && !baseIds.has(it.id)),
  )

  const tombstones = (input.library.tombstones ?? []).filter(
    (t) => t.kind === 'item' && !!t.lemma && entryLemmas.has(t.lemma),
  )

  // 句子原文共享表只带被这些词条 / 按篇条目引用到的句子。
  const textKeys = new Set<string>()
  for (const e of entries) {
    const k = sentenceTextKey(e)
    if (k) textKeys.add(k)
  }
  for (const it of items) {
    const k = sentenceTextKey(it.source)
    if (k) textKeys.add(k)
    for (const c of it.contexts ?? []) {
      const ck = sentenceTextKey(c)
      if (ck) textKeys.add(ck)
    }
  }
  const sentenceTexts = Object.fromEntries(
    Object.entries(input.library.sentenceTexts ?? {}).filter(([k]) => textKeys.has(k)),
  )

  const learning = input.learning
  const pkg: ArticlePackage = {
    format: ARTICLE_PACKAGE_FORMAT,
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    articles,
    library: {
      schemaVersion: input.library.schemaVersion,
      items,
      articleEntries: entries,
      ...(Object.keys(sentenceTexts).length ? { sentenceTexts } : {}),
      ...(tombstones.length ? { tombstones } : {}),
    },
  }

  if (!learning) return pkg
  pkg.practice = (learning.practice ?? []).filter((p) => !!p.articleId && keys.has(p.articleId))
  pkg.mistakes = mistakes
  pkg.readDone = (learning.readDone ?? []).filter((r) => keys.has(r.articleId))
  pkg.writingHistory = (learning.writingHistory ?? []).filter((w) => keys.has(w.articleId))
  pkg.backTranslations = (learning.backTranslations ?? []).filter((b) => keys.has(b.articleId))
  pkg.retells = (learning.retells ?? []).filter((r) => keys.has(r.articleId))
  pkg.skimmed = (learning.skimmed ?? []).filter((id) => keys.has(id))
  pkg.answerEvents = (learning.answerEvents ?? []).filter((e) => keys.has(e.articleId))
  pkg.goldenDrills = (learning.goldenDrills ?? []).filter((r) => keys.has(r.articleId))
  return pkg
}
