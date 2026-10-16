/**
 * 从**正文标记**重建词条。
 *
 * 为什么需要：正文里的「已标记生词」其实是**派生**的（按词库算高亮），词库一空就看不出标记了；
 * 但文章对象里另存着一份不依赖词库的记录 —— `Sentence.vocab`（每句的生词词形，
 * 来自当年粘回的 AI 句子解析 / 词表）。词库出事时，它就是最准的「我当时标过哪些词」。
 *
 * 纯函数：给同样的文章总是同样的结果；调用方只管把已保存文章 + 当前文章传进来。
 */
import type { VocabLibrary } from '../types/document'
import { markWord } from './vocab'

export interface ArticleWithMarks {
  id: string
  title?: string
  sentences: { id: string; text: string; vocab?: string[] }[]
}

/** 从文章标记里认出「词 + 出处」。 */
export function wordsFromArticleMarks(articles: ArticleWithMarks[]): {
  word: string
  articleId: string
  sentenceId: string | null
  sentenceText: string
}[] {
  const seen = new Set<string>()
  const out: { word: string; articleId: string; sentenceId: string | null; sentenceText: string }[] = []
  for (const a of articles) {
    for (const s of a.sentences ?? []) {
      for (const raw of s.vocab ?? []) {
        const word = (raw ?? '').trim()
        if (!word) continue
        const key = word.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ word, articleId: a.id, sentenceId: s.id ?? null, sentenceText: s.text ?? '' })
      }
    }
  }
  return out
}

export interface RebuildFromMarksResult {
  library: VocabLibrary
  /** 这次补回来多少条 */
  added: number
  /** 文章标记里一共认出多少个不同的词 */
  found: number
}

/** 把正文标记里的词并回词库（幂等：已有的不动）。 */
export function rebuildFromArticleMarks(
  library: VocabLibrary,
  articles: ArticleWithMarks[],
  now: Date = new Date(),
): RebuildFromMarksResult {
  const words = wordsFromArticleMarks(articles)
  let lib = library
  let added = 0
  for (const w of words) {
    try {
      const r = markWord(
        lib,
        {
          word: w.word,
          articleId: w.articleId,
          fileName: w.articleId,
          sentenceId: w.sentenceId,
          sentenceText: w.sentenceText,
        },
        now,
      )
      if (!r.created) continue
      lib = r.library
      added++
    } catch {
      // 归一化后为空的脏数据：跳过
    }
  }
  return { library: lib, added, found: words.length }
}
