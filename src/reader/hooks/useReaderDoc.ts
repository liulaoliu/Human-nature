import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { cleanText } from '../../core/cleaner'
import { segment, carryAnalysis } from '../../core/segmenter'
import { styleOf, type ArticleBook } from '../../core/matchArticle'
import type { Paragraph, Sentence } from '../../types/document'
import type { ArticleRepoPort, SavedArticle } from '../../adapters/articleRepo'

/** 一篇打开的文档。 */
export interface ReaderDoc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

/** 待选项最小形状（与 reader 的 BatchItem 结构一致）。 */
type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

/** 按期次给内置文章分组。文件名写法区分两代（见 matchArticle.styleOf）。 */
const EDITION_LABEL: Record<ReturnType<typeof styleOf>, string> = {
  spaced: '2016-09-10',
  dashed: '2021-06-12',
  other: '其它',
}
function editionOf(key: string): string {
  return EDITION_LABEL[styleOf(key)]
}

/** 老记录没存 text 时，从段落/句子还原正文。 */
function reconstructText(a: SavedArticle): string {
  const byId = new Map(a.sentences.map((s) => [s.id, s]))
  return a.paragraphs
    .map((p) => p.sentenceIds.map((id) => byId.get(id)?.text ?? '').join(' '))
    .join('\n\n')
}

export interface UseReaderDocParams {
  articles: RefObject<ArticleRepoPort | null>
  batchMapRef: MutableRefObject<Record<string, BatchItemLike[]>>
  setBatch: Dispatch<SetStateAction<BatchItemLike[]>>
  /** 换文章时清空选区（selection 状态在组件里）。 */
  resetSelection: () => void
  flash: (message: string) => void
  book: ArticleBook | null
  articleKey: string | null
  setArticleKey: (v: string | null) => void
  doc: ReaderDoc | null
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  articleTitle: string
  setArticleTitle: (v: string) => void
  saved: SavedArticle[]
  setSaved: (v: SavedArticle[]) => void
  /** 「已保存文章」是否已从 IndexedDB 取回（未取回前不自动恢复）。 */
  savedLoaded: boolean
  savedId: string | null
  setSavedId: (v: string | null) => void
  pendingSave: boolean
  setPendingSave: (v: boolean) => void
  sourceText: string
  setSourceText: (v: string) => void
  setEditing: (v: boolean) => void
  draft: string
  setDraft: (v: string) => void
  articleBook: string
  setArticleBook: (v: string) => void
  confirmDelSave: boolean
  setConfirmDelSave: (v: boolean) => void
  edition: string
}

/**
 * 文章文档管理：打开（内置/已保存）、保存/删除（两步确认）、改名、编辑正文（重新切句、按句搬分析）、
 * 自动落盘、启动恢复上次文章，以及文章选择器所需的派生（书分组/期次）。
 *
 * 过渡形态：状态仍留在组件，这里只收口动作与副作用（后续可把状态也搬进来）。
 */
export function useReaderDoc({
  articles,
  batchMapRef,
  setBatch,
  resetSelection,
  flash,
  book,
  articleKey,
  setArticleKey,
  doc,
  setDoc,
  articleTitle,
  setArticleTitle,
  saved,
  setSaved,
  savedLoaded,
  savedId,
  setSavedId,
  pendingSave,
  setPendingSave,
  sourceText,
  setSourceText,
  setEditing,
  draft,
  setDraft,
  articleBook,
  setArticleBook,
  confirmDelSave,
  setConfirmDelSave,
  edition,
}: UseReaderDocParams) {
  const saveDelTimerRef = useRef<number | null>(null)

  const remember = useCallback((key: string | null, id: string | null) => {
    try {
      localStorage.setItem('reader:last', JSON.stringify({ key, id }))
    } catch {
      // 隐私模式忽略
    }
  }, [])

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
      setSavedId(id)
      setBatch(batchMapRef.current[key ?? id ?? title] ?? [])
    },
    [resetSelection, setDoc, setSourceText, setEditing, setArticleKey, setArticleTitle, setArticleBook, setSavedId, setBatch, batchMapRef],
  )

  /** 打开一篇已保存的文章（保留上次粘回的翻译/语法）。 */
  const loadSaved = useCallback(
    (a: SavedArticle) => {
      setDoc({ paragraphs: a.paragraphs, sentences: a.sentences })
      setSourceText(a.text || reconstructText(a))
      setEditing(false)
      resetSelection()
      setArticleKey(a.sourceKey)
      setArticleTitle(a.title)
      setArticleBook(a.book ?? '')
      setSavedId(a.id)
      setBatch(batchMapRef.current[a.sourceKey ?? a.id ?? a.title] ?? [])
      remember(a.sourceKey, a.id)
    },
    [resetSelection, setDoc, setSourceText, setEditing, setArticleKey, setArticleTitle, setArticleBook, setSavedId, setBatch, batchMapRef, remember],
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

  /** 把当前这篇文章（含粘回的翻译/语法）存到本机。 */
  const saveCurrent = useCallback(async () => {
    if (!doc) {
      flash('先打开或粘一篇文章')
      return
    }
    const id = savedId ?? (articleKey ? `saved:${articleKey}` : `saved:${Date.now()}`)
    let title = articleTitle
    if (!savedId && !title) {
      title = window.prompt('给这篇文章起个名字', articleKey ?? '未命名') || '未命名'
    }
    const article: SavedArticle = {
      id,
      title: title || '未命名',
      book: articleBook || undefined,
      sourceKey: articleKey,
      text: sourceText,
      paragraphs: doc.paragraphs,
      sentences: doc.sentences,
      updatedAt: new Date().toISOString(),
    }
    await articles.current?.save(article)
    setSaved((await articles.current?.list()) ?? [])
    setSavedId(id)
    setArticleTitle(article.title)
    setArticleBook(article.book ?? '')
    remember(articleKey, id)
    flash('已保存到本机')
  }, [doc, savedId, articleKey, articleTitle, articleBook, sourceText, articles, setSaved, setSavedId, setArticleTitle, setArticleBook, remember, flash])

  const deleteSaved = useCallback(async () => {
    if (!savedId) return
    await articles.current?.remove(savedId)
    setSaved((await articles.current?.list()) ?? [])
    setSavedId(null)
    flash('已删除保存；正文还在，可重新保存')
  }, [savedId, articles, setSaved, setSavedId, flash])

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
        text: sourceText,
        paragraphs: doc.paragraphs,
        sentences: doc.sentences,
        updatedAt: new Date().toISOString(),
      })
      setSaved((await articles.current?.list()) ?? [])
    }
    flash('已修改标题')
  }, [articleTitle, articleKey, articleBook, savedId, doc, sourceText, articles, setArticleTitle, setSaved, flash])

  const enterEdit = useCallback(() => {
    if (!doc) return
    setDraft(sourceText)
    setEditing(true)
  }, [doc, sourceText, setDraft, setEditing])

  /** 完成编辑：重新切句，并按句文把已粘回的分析搬过来。 */
  const applyEdit = useCallback(() => {
    const cleaned = cleanText(draft)
    const next = segment(cleaned)
    const sentences = carryAnalysis(doc?.sentences ?? [], next.sentences)
    setDoc({ paragraphs: next.paragraphs, sentences })
    setSourceText(cleaned)
    setEditing(false)
    setPendingSave(true)
    flash('已应用修改（已粘回的分析按句保留）')
  }, [draft, doc, setDoc, setSourceText, setEditing, setPendingSave, flash])

  const cancelEdit = useCallback(() => setEditing(false), [setEditing])

  // 已保存的文章，改动后自动落盘（翻译/语法粘回后不丢）
  useEffect(() => {
    if (!savedId || !doc) return
    const t = window.setTimeout(() => void saveCurrent(), 900)
    return () => window.clearTimeout(t)
  }, [doc, savedId, saveCurrent])

  // 应用结果 / 编辑正文后：没有保存记录就立即建一条，之后照旧自动存
  useEffect(() => {
    if (!pendingSave || !doc) return
    setPendingSave(false)
    void saveCurrent()
  }, [pendingSave, doc, setPendingSave, saveCurrent])

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

  const bookKeys = useMemo(() => (book ? Object.keys(book).sort() : []), [book])
  const editions = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of bookKeys) {
      const e = editionOf(k)
      m.set(e, (m.get(e) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [bookKeys])
  const shownKeys = useMemo(
    () => bookKeys.filter((k) => edition === '全部' || editionOf(k) === edition),
    [bookKeys, edition],
  )

  return {
    loadText,
    loadSaved,
    loadFromBook,
    saveCurrent,
    deleteSaved,
    askDeleteSave,
    renameArticle,
    enterEdit,
    applyEdit,
    cancelEdit,
    onPick,
    bookKeys,
    editions,
    shownKeys,
  }
}
