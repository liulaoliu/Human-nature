import type { RefObject } from 'react'
import { cleanText } from '../../core/cleaner'
import { segment } from '../../core/segmenter'
import { buildCleanupPrompt } from '../../core/analyzer'
import { extractEpub, extractPdfText } from '../importers'
import type { ArticleRepoPort } from '../../adapters/articleRepo'
import type { SavedArticle } from '../../adapters/articleRepo'

export interface UseArticleImportParams {
  repo: RefObject<ArticleRepoPort | null>
  setSaved: (list: SavedArticle[]) => void
  loadSaved: (a: SavedArticle) => void
  newBook: string
  pdfRange: string
  manual: string
  newTitle: string
  setManual: (v: string) => void
  setNewTitle: (v: string) => void
  setNewBook: (v: string) => void
  setComposing: (v: boolean) => void
  setImporting: (v: string) => void
  flash: (message: string) => void
}

/**
 * 新建 / 导入文章：粘正文创建、.txt/.md 多选、.pdf（可页码范围，浏览器内抽文本）、
 * .epub（按章拆成多篇），以及复制「清洗提示词」。
 */
export function useArticleImport({
  repo,
  setSaved,
  loadSaved,
  newBook,
  pdfRange,
  manual,
  newTitle,
  setManual,
  setNewTitle,
  setNewBook,
  setComposing,
  setImporting,
  flash,
}: UseArticleImportParams) {
  /** 复制清洗提示词：让 AI 去掉复制文本的多余换行、粘连和错误。next 是拿到结果后该做什么。 */
  const copyCleanupPrompt = async (text: string, next: string) => {
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(buildCleanupPrompt(text))
      flash(`已复制；去 AI 粘贴，把结果贴回来再${next}`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }

  /** 新建一篇文章：清洗 + 切句 + 直接存进「已保存」。 */
  const createArticle = async () => {
    if (!manual.trim()) return
    const title = newTitle.trim() || '未命名'
    const cleaned = cleanText(manual)
    const seg = segment(cleaned)
    const article: SavedArticle = {
      id: `saved:${Date.now()}`,
      title,
      book: newBook.trim() || undefined,
      sourceKey: null,
      text: cleaned,
      paragraphs: seg.paragraphs,
      sentences: seg.sentences,
      updatedAt: new Date().toISOString(),
    }
    await repo.current?.save(article)
    setSaved((await repo.current?.list()) ?? [])
    loadSaved(article)
    setComposing(false)
    setManual('')
    setNewTitle('')
    setNewBook('')
    flash('已新建文章')
  }

  /** 从 .txt/.md 导入：一个文件=一篇；多选就是多篇。 */
  const onImportFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    const read = (f: File) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result ?? ''))
        r.onerror = () => reject(r.error)
        r.readAsText(f)
      })
    const texts = await Promise.all(list.map(read))
    if (list.length === 1) {
      setManual(texts[0])
      setNewTitle(list[0].name.replace(/\.[^.]+$/, ''))
      setComposing(true)
      flash('已读入，确认后点「创建文章」')
      return
    }
    const now = Date.now()
    for (let i = 0; i < list.length; i++) {
      const cleaned = cleanText(texts[i])
      const seg = segment(cleaned)
      await repo.current?.save({
        id: `saved:${now}:${i}`,
        title: list[i].name.replace(/\.[^.]+$/, '') || `第 ${i + 1} 篇`,
        book: newBook.trim() || undefined,
        sourceKey: null,
        text: cleaned,
        paragraphs: seg.paragraphs,
        sentences: seg.sentences,
        updatedAt: new Date().toISOString(),
      })
    }
    setSaved((await repo.current?.list()) ?? [])
    flash(`已导入 ${list.length} 篇`)
  }

  /** 浏览器内解析 PDF → 填入 composer，人工确认后创建。 */
  const onPickPdf = async (file: File | null | undefined) => {
    if (!file) return
    setImporting('正在解析 PDF…')
    try {
      const text = await extractPdfText(file, pdfRange)
      setManual(text)
      setNewTitle(file.name.replace(/\.[^.]+$/, ''))
      setComposing(true)
      flash('PDF 已解析，检查正文后点「创建文章」')
    } catch {
      flash('PDF 解析失败（可能是扫描件，没有文字层）')
    } finally {
      setImporting('')
    }
  }

  /** 浏览器内解析 EPUB：按章拆成多篇，标题形如「书名 · 章节」。 */
  const onPickEpub = async (file: File | null | undefined) => {
    if (!file) return
    setImporting('正在解析 EPUB…')
    try {
      const chapters = await extractEpub(file)
      if (!chapters.length) {
        flash('EPUB 里没读到文本')
        return
      }
      const book = file.name.replace(/\.[^.]+$/, '')
      const now = Date.now()
      for (let i = 0; i < chapters.length; i++) {
        const cleaned = cleanText(chapters[i].text)
        const seg = segment(cleaned)
        await repo.current?.save({
          id: `saved:${now}:${i}`,
          title: `${book} · ${chapters[i].title || `第 ${i + 1} 章`}`,
          book,
          sourceKey: null,
          text: cleaned,
          paragraphs: seg.paragraphs,
          sentences: seg.sentences,
          updatedAt: new Date().toISOString(),
        })
      }
      setSaved((await repo.current?.list()) ?? [])
      flash(`已导入《${book}》共 ${chapters.length} 章`)
    } catch {
      flash('EPUB 解析失败')
    } finally {
      setImporting('')
    }
  }

  return { copyCleanupPrompt, createArticle, onImportFiles, onPickPdf, onPickEpub }
}
