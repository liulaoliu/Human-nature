import { useCallback, useState } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { ArticleBook } from '../../core/matchArticle'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import type { ArticleOrigin, Sentence, SentenceLanguage } from '../../types/document'
import type { BatchItemLike } from '../batchItem'
import { useReaderDoc, type ReaderDoc } from './useReaderDoc'
import { useArticleImport } from './useArticleImport'

export interface UseArticleWorkspaceParams {
  articles: RefObject<ArticleRepoPort | null>
  batchMapRef: MutableRefObject<Record<string, BatchItemLike[]>>
  setBatch: Dispatch<SetStateAction<BatchItemLike[]>>
  /** 换文章时清空选区（selection 状态在 ReaderApp / useSelection） */
  resetSelection: () => void
  flash: (message: string) => void
  book: ArticleBook | null
  articleKey: string | null
  setArticleKey: (v: string | null) => void
  articleTitle: string
  setArticleTitle: (v: string) => void
  savedId: string | null
  setSavedId: (v: string | null) => void
  confirmDelSave: boolean
  setConfirmDelSave: (v: boolean) => void
  doc: ReaderDoc | null
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  saved: SavedArticle[]
  setSaved: (v: SavedArticle[]) => void
  savedLoaded: boolean
}

/**
 * 文章工作区：打开哪篇 / 标题 / 选区之外的编辑态 / 新建与导入 / 语言点编辑。
 *
 * 收口的是「一篇文章怎么进来、怎么存、怎么改」这组状态；
 * `useReaderDoc` 仍负责文档动作，`useArticleImport` 仍负责导入解析，这里只做组装。
 */
export function useArticleWorkspace({
  articles,
  batchMapRef,
  setBatch,
  resetSelection,
  flash,
  book,
  articleKey,
  setArticleKey,
  articleTitle,
  setArticleTitle,
  savedId,
  setSavedId,
  confirmDelSave,
  setConfirmDelSave,
  doc,
  setDoc,
  saved,
  setSaved,
  savedLoaded,
}: UseArticleWorkspaceParams) {
  const [edition, setEdition] = useState('全部')
  /** 有内容改动、需要（首次则建立记录）自动保存 */
  const [pendingSave, setPendingSave] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  /** 当前打开文章所属的书 */
  const [articleBook, setArticleBook] = useState('')
  /** 当前文章从哪来；旧文章没有记录时保持 undefined，不猜 */
  const [articleOrigin, setArticleOrigin] = useState<ArticleOrigin | undefined>(undefined)

  /** 新建 / 导入态 */
  const [composing, setComposing] = useState(false)
  const [manual, setManual] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newBook, setNewBook] = useState('')
  const [pdfRange, setPdfRange] = useState('')
  const [importing, setImporting] = useState('')

  /** 手动加/改语言点 */
  const [langOpen, setLangOpen] = useState(false)
  const [langTarget, setLangTarget] = useState<Sentence | null>(null)

  const docApi = useReaderDoc({
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
    articleOrigin,
    setArticleOrigin,
    confirmDelSave,
    setConfirmDelSave,
    edition,
  })

  const { loadSaved, renameArticle } = docApi

  const { copyCleanupPrompt, createArticle, onImportFiles, onPickPdf, onPickEpub, markPaste } = useArticleImport({
    repo: articles,
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
  })

  /** 用户重新手输/粘贴：composer 来源改回 paste（文件读入后又被改掉的情况）。 */
  const changeManual = useCallback(
    (value: string) => {
      markPaste()
      setManual(value)
    },
    [markPaste],
  )

  const currentValue = savedId ? `s:${savedId}` : articleKey ? `b:${articleKey}` : ''

  /** 打开语言点编辑（针对指定句子）。 */
  const openLangFor = useCallback((s: Sentence | null) => {
    if (!s) return
    setLangTarget(s)
    setLangOpen(true)
  }, [])

  /** 手动保存语言点列表（写回目标句的 languages）。 */
  const saveLanguage = useCallback(
    (langs: SentenceLanguage[]) => {
      const target = langTarget
      if (!target) return
      const sid = target.id
      setDoc((d) =>
        d
          ? { ...d, sentences: d.sentences.map((s) => (s.id === sid ? { ...s, languages: langs, language: undefined } : s)) }
          : d,
      )
      setPendingSave(true)
      setLangOpen(false)
      flash(langs.length ? `已保存语言点（${langs.length} 条）` : '已清空该句语言点')
    },
    [langTarget, setDoc, setPendingSave, flash],
  )

  return {
    docApi,
    loadSaved,
    renameArticle,
    articleTitle,
    savedId,
    edition,
    setEdition,
    currentValue,
    confirmDelSave,
    editing,
    draft,
    setDraft,
    composing,
    setComposing,
    manual,
    setManual: changeManual,
    newTitle,
    setNewTitle,
    newBook,
    setNewBook,
    pdfRange,
    setPdfRange,
    importing,
    langOpen,
    setLangOpen,
    langTarget,
    openLangFor,
    saveLanguage,
    setPendingSave,
    copyCleanupPrompt,
    createArticle,
    onImportFiles,
    onPickPdf,
    onPickEpub,
  }
}
