import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { ArticleOrigin } from '../../types/document'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import type { ReaderDoc } from './useReaderDoc'
import { fingerprintOf } from './articleDocUtil'

export interface UseArticleSaveParams {
  articles: RefObject<ArticleRepoPort | null>
  doc: ReaderDoc | null
  savedId: string | null
  setSavedId: (v: string | null) => void
  /**
   * 「删掉保存后又存回去」要复用的 id（来自 useArticleIdentity）。
   * 同一篇正文复用原 id，词库里按篇收录 / 语境不会突然换成第二个键。
   */
  reuseId?: string | null
  articleKey: string | null
  articleTitle: string
  setArticleTitle: (v: string) => void
  articleBook: string
  setArticleBook: (v: string) => void
  articleOrigin: ArticleOrigin | undefined
  sourceText: string
  setSaved: (v: SavedArticle[]) => void
  savedFingerprintRef: MutableRefObject<string | null>
  createdAtRef: MutableRefObject<string | null>
  confirmDelSave: boolean
  setConfirmDelSave: (v: boolean) => void
  pendingSave: boolean
  setPendingSave: (v: boolean) => void
  remember: (key: string | null, id: string | null) => void
  flash: (message: string) => void
}

/** 保存 / 删除（两步确认）/ 改名 / 已保存文章的改动自动落盘。 */
export function useArticleSave({
  articles,
  doc,
  savedId,
  setSavedId,
  reuseId,
  articleKey,
  articleTitle,
  setArticleTitle,
  articleBook,
  setArticleBook,
  articleOrigin,
  sourceText,
  setSaved,
  savedFingerprintRef,
  createdAtRef,
  confirmDelSave,
  setConfirmDelSave,
  pendingSave,
  setPendingSave,
  remember,
  flash,
}: UseArticleSaveParams) {
  const saveDelTimerRef = useRef<number | null>(null)

  /** 把当前这篇文章（含粘回的翻译/语法）存到本机。 */
  const saveCurrent = useCallback(async () => {
    if (!doc) {
      flash('先打开或粘一篇文章')
      return
    }
    // 删掉保存再存回去：正文没变就用回原来的 id（见 useArticleIdentity）。
    const id = savedId ?? (articleKey ? `saved:${articleKey}` : reuseId ?? `saved:${Date.now()}`)
    let title = articleTitle
    if (!savedId && !title) {
      title = window.prompt('给这篇文章起个名字', articleKey ?? '未命名') || '未命名'
    }
    // 覆盖保存必须把原来的建立时间带上：服务端 / IndexedDB 都靠它保留「新增日期」。
    const createdAt = createdAtRef.current ?? undefined
    const article: SavedArticle = {
      id,
      title: title || '未命名',
      book: articleBook || undefined,
      sourceKey: articleKey,
      origin: articleOrigin,
      text: sourceText,
      paragraphs: doc.paragraphs,
      sentences: doc.sentences,
      ...(doc.golden ? { golden: doc.golden } : {}),
      createdAt,
      updatedAt: new Date().toISOString(),
    }
    try {
      await articles.current?.save(article)
      savedFingerprintRef.current = fingerprintOf(
        article.title,
        article.book ?? '',
        article.origin,
        article.text,
        article,
      )
      const list = (await articles.current?.list()) ?? []
      setSaved(list)
      createdAtRef.current = list.find((x) => x.id === id)?.createdAt ?? createdAt ?? null
      setSavedId(id)
      setArticleTitle(article.title)
      setArticleBook(article.book ?? '')
      remember(articleKey, id)
      flash('已保存到本机')
    } catch (e) {
      console.warn('[文章] 保存失败', e)
      flash('保存文章失败：请稍后重试，或先导出全文')
    }
  }, [
    doc,
    savedId,
    reuseId,
    articleKey,
    articleTitle,
    articleBook,
    articleOrigin,
    sourceText,
    articles,
    setSaved,
    setSavedId,
    setArticleTitle,
    setArticleBook,
    remember,
    flash,
    savedFingerprintRef,
    createdAtRef,
  ])

  const deleteSaved = useCallback(async () => {
    if (!savedId) return
    await articles.current?.remove(savedId)
    const list = (await articles.current?.list()) ?? []
    setSaved(list)
    setSavedId(null)
    savedFingerprintRef.current = null
    createdAtRef.current = null
    flash('已删除保存；正文还在，可重新保存')
  }, [savedId, articles, setSaved, setSavedId, flash, savedFingerprintRef, createdAtRef])

  /** 「删除保存」两步确认，防误删。 */
  const askDeleteSave = useCallback(() => {
    if (confirmDelSave) {
      setConfirmDelSave(false)
      if (saveDelTimerRef.current) window.clearTimeout(saveDelTimerRef.current)
      void deleteSaved()
      return
    }
    setConfirmDelSave(true)
    if (saveDelTimerRef.current) window.clearTimeout(saveDelTimerRef.current)
    saveDelTimerRef.current = window.setTimeout(() => setConfirmDelSave(false), 3000)
  }, [confirmDelSave, setConfirmDelSave, deleteSaved])

  /** 改文章标题（已保存的同步存库）。 */
  const renameArticle = useCallback(async () => {
    const next = window.prompt('修改文章标题', articleTitle || articleKey || '')
    if (next === null) return
    const title = next.trim()
    if (!title) return
    setArticleTitle(title)
    if (savedId && doc) {
      const id = savedId
      await articles.current?.save({
        id,
        title,
        book: articleBook || undefined,
        sourceKey: articleKey,
        origin: articleOrigin,
        text: sourceText,
        paragraphs: doc.paragraphs,
        sentences: doc.sentences,
        ...(doc.golden ? { golden: doc.golden } : {}),
        createdAt: createdAtRef.current ?? undefined,
        updatedAt: new Date().toISOString(),
      })
      savedFingerprintRef.current = fingerprintOf(title, articleBook, articleOrigin, sourceText, doc)
      const list = (await articles.current?.list()) ?? []
      setSaved(list)
      createdAtRef.current = list.find((x) => x.id === id)?.createdAt ?? createdAtRef.current
    }
    flash('已修改标题')
  }, [
    articleTitle,
    articleKey,
    articleBook,
    articleOrigin,
    savedId,
    doc,
    sourceText,
    articles,
    setArticleTitle,
    setSaved,
    flash,
    savedFingerprintRef,
    createdAtRef,
  ])

  // 已保存的文章，改动后自动落盘（翻译/语法粘回后不丢）。
  // 打开文章本身也会换 doc / savedId，但内容指纹没变 → 不写库，列表日期不动。
  useEffect(() => {
    if (!savedId || !doc) return
    const current = fingerprintOf(articleTitle, articleBook, articleOrigin, sourceText, doc)
    if (current === savedFingerprintRef.current) return
    const t = window.setTimeout(() => void saveCurrent(), 900)
    return () => window.clearTimeout(t)
  }, [doc, savedId, saveCurrent, articleTitle, articleBook, articleOrigin, sourceText, savedFingerprintRef])

  // 应用结果 / 编辑正文后：没有保存记录就立即建一条，之后照旧自动存。
  useEffect(() => {
    if (!pendingSave || !doc) return
    setPendingSave(false)
    const current = fingerprintOf(articleTitle, articleBook, articleOrigin, sourceText, doc)
    if (savedId && current === savedFingerprintRef.current) return
    void saveCurrent()
  }, [
    pendingSave,
    doc,
    savedId,
    setPendingSave,
    saveCurrent,
    articleTitle,
    articleBook,
    articleOrigin,
    sourceText,
    savedFingerprintRef,
  ])

  return { saveCurrent, deleteSaved, askDeleteSave, renameArticle }
}
