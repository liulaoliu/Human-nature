import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { cleanText } from '../../core/cleaner'
import { isArticleOrigin } from '../../core/articleOrigin'
import { normalizeGoldenLesson } from '../../core/goldenParse'
import { segment } from '../../core/segmenter'
import type { ArticleBook } from '../../core/matchArticle'
import type { ArticleOrigin } from '../../types/document'
import type { SavedArticle } from '../../core/ports'
import type { ReaderDoc } from './useReaderDoc'
import type { BatchItemLike } from '../batchItem'
import { fingerprintOf, reconstructText } from './articleDocUtil'

export interface UseArticleOpenParams {
  batchMapRef: MutableRefObject<Record<string, BatchItemLike[]>>
  setBatch: Dispatch<SetStateAction<BatchItemLike[]>>
  resetSelection: () => void
  book: ArticleBook | null
  setArticleKey: (v: string | null) => void
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setArticleTitle: (v: string) => void
  saved: SavedArticle[]
  setSavedId: (v: string | null) => void
  savedLoaded: boolean
  setSourceText: (v: string) => void
  setEditing: (v: boolean) => void
  setArticleBook: (v: string) => void
  setArticleOrigin: (v: ArticleOrigin | undefined) => void
  savedFingerprintRef: MutableRefObject<string | null>
  createdAtRef: MutableRefObject<string | null>
  remember: (key: string | null, id: string | null) => void
}

/** 打开内置 / 已保存文章、启动恢复上次文章、以及文章选择器动作。 */
export function useArticleOpen({
  batchMapRef,
  setBatch,
  resetSelection,
  book,
  setArticleKey,
  setDoc,
  setArticleTitle,
  saved,
  setSavedId,
  savedLoaded,
  setSourceText,
  setEditing,
  setArticleBook,
  setArticleOrigin,
  savedFingerprintRef,
  createdAtRef,
  remember,
}: UseArticleOpenParams) {
  const loadText = useCallback(
    (key: string | null, text: string, title: string, id: string | null) => {
      const cleaned = cleanText(text)
      setDoc(segment(cleaned))
      setSourceText(cleaned)
      setEditing(false)
      resetSelection()
      setArticleKey(key)
      setArticleTitle(title)
      setArticleBook('')
      setArticleOrigin('library')
      setSavedId(id)
      setBatch(batchMapRef.current[key ?? id ?? title] ?? [])
      // 内置原文还没保存过：没有「已落盘版本」可比，保存时按新建处理。
      savedFingerprintRef.current = null
      createdAtRef.current = null
    },
    [
      resetSelection,
      setDoc,
      setSourceText,
      setEditing,
      setArticleKey,
      setArticleTitle,
      setArticleBook,
      setArticleOrigin,
      setSavedId,
      setBatch,
      batchMapRef,
      savedFingerprintRef,
      createdAtRef,
    ],
  )

  /** 打开一篇已保存的文章（保留上次粘回的翻译/语法）。 */
  const loadSaved = useCallback(
    (a: SavedArticle) => {
      const text = a.text || reconstructText(a)
      // 服务端 / IndexedDB 的旧数据也可能带坏值；只认白名单，其余当未知。
      const origin = isArticleOrigin(a.origin) ? a.origin : undefined
      const golden = normalizeGoldenLesson(a.golden, a.sentences) ?? undefined
      setDoc({ paragraphs: a.paragraphs, sentences: a.sentences, ...(golden ? { golden } : {}) })
      setSourceText(text)
      setEditing(false)
      resetSelection()
      setArticleKey(a.sourceKey)
      setArticleTitle(a.title)
      setArticleBook(a.book ?? '')
      setArticleOrigin(origin)
      setSavedId(a.id)
      setBatch(batchMapRef.current[a.sourceKey ?? a.id ?? a.title] ?? [])
      remember(a.sourceKey, a.id)
      // 刚打开的这一版就是「已落盘版本」：点击列表本身不算改动，不刷新 updatedAt。
      savedFingerprintRef.current = fingerprintOf(a.title, a.book ?? '', origin, text, {
        paragraphs: a.paragraphs,
        sentences: a.sentences,
        ...(golden ? { golden } : {}),
      })
      createdAtRef.current = a.createdAt ?? null
    },
    [
      resetSelection,
      setDoc,
      setSourceText,
      setEditing,
      setArticleKey,
      setArticleTitle,
      setArticleBook,
      setArticleOrigin,
      setSavedId,
      setBatch,
      batchMapRef,
      remember,
      savedFingerprintRef,
      createdAtRef,
    ],
  )

  /** 从内置原文库打开：保存过就优先用保存的版本（含改动）。 */
  const loadFromBook = useCallback(
    (key: string) => {
      const existing = saved.find((a) => a.sourceKey === key)
      if (existing) {
        loadSaved(existing)
        return
      }
      const text = book?.[key]?.text
      if (text == null) return
      loadText(key, text, book?.[key]?.title ?? key, null)
      remember(key, null)
    },
    [saved, book, loadSaved, loadText, remember],
  )

  // 启动后恢复「上次打开的文章」
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    // 必须等「已保存文章」取回：否则会把已保存的正文误判成没保存，退回内置原文
    // （翻译/语言点等分析全丢），要再点一次列表才加载出来。
    if (!savedLoaded) return
    let last: { key: string | null; id: string | null } | null = null
    try {
      last = JSON.parse(localStorage.getItem('reader:last') ?? 'null')
    } catch {
      last = null
    }
    // 上次是内置文章（没有 savedId）：还要等原文库到位
    if (last && !last.id && last.key && !book) return
    restored.current = true
    if (!last) return
    if (last.id) {
      const a = saved.find((x) => x.id === last.id)
      if (a) {
        loadSaved(a)
        return
      }
    }
    if (last.key && book?.[last.key]) loadFromBook(last.key)
  }, [book, saved, savedLoaded, loadSaved, loadFromBook])

  const onPick = useCallback(
    (value: string) => {
      if (value.startsWith('b:')) loadFromBook(value.slice(2))
      else if (value.startsWith('s:')) {
        const a = saved.find((x) => x.id === value.slice(2))
        if (a) loadSaved(a)
      }
    },
    [loadFromBook, loadSaved, saved],
  )

  return { loadText, loadSaved, loadFromBook, onPick }
}
