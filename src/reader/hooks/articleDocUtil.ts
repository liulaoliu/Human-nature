import { articleFingerprint } from '../../core/articleMeta'
import type { ArticleOrigin } from '../../types/document'
import type { SavedArticle } from '../../core/ports'
import type { ReaderDoc } from './useReaderDoc'

/** 老记录没存 text 时，从段落/句子还原正文。 */
export function reconstructText(a: SavedArticle): string {
  const byId = new Map(a.sentences.map((s) => [s.id, s]))
  return a.paragraphs
    .map((p) => p.sentenceIds.map((id) => byId.get(id)?.text ?? '').join(' '))
    .join('\n\n')
}

/** 当前编辑器状态的内容指纹（用于判断自动落盘是不是真的有必要）。 */
export function fingerprintOf(
  title: string,
  book: string,
  origin: ArticleOrigin | undefined,
  text: string,
  doc: ReaderDoc,
): string {
  return articleFingerprint({
    title,
    book: book || undefined,
    origin,
    text,
    paragraphs: doc.paragraphs,
    sentences: doc.sentences,
  })
}
