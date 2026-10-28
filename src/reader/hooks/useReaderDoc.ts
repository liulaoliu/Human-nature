import { useCallback, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import type { ArticleBook } from '../../core/matchArticle'
import type { ArticleOrigin, GoldenLesson, Paragraph, Sentence } from '../../types/document'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import type { BatchItemLike } from '../batchItem'
import { useArticleBookGroups } from './useArticleBookGroups'
import { useArticleEdit } from './useArticleEdit'
import { useArticleOpen } from './useArticleOpen'
import { useArticleSave } from './useArticleSave'

/** 一篇打开的文档。 */
export interface ReaderDoc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
  /** D老师小课堂：AI / 本地金句课内容；老文章没有，按需推导 */
  golden?: GoldenLesson
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
  /** 当前文章从哪来；旧文章为 undefined，保存时保持未知 */
  articleOrigin: ArticleOrigin | undefined
  setArticleOrigin: (v: ArticleOrigin | undefined) => void
  confirmDelSave: boolean
  setConfirmDelSave: (v: boolean) => void
  edition: string
}

/**
 * 文章文档管理：打开（内置/已保存）、保存/删除（两步确认）、改名、编辑正文（重新切句、按句搬分析）、
 * 自动落盘、启动恢复上次文章，以及文章选择器所需的派生（书分组/期次）。
 *
 * 打开 / 保存 / 编辑 / 列表分组分别住在 useArticleOpen / useArticleSave / useArticleEdit /
 * useArticleBookGroups；这里只共享「已落盘指纹 / 创建时间」两个 ref 并装配返回值。
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
  articleOrigin,
  setArticleOrigin,
  confirmDelSave,
  setConfirmDelSave,
  edition,
}: UseReaderDocParams) {
  /** 上次真正落盘时那篇文章的内容指纹；打开文章时同步刷新，用来跳过「无改动自动保存」。 */
  const savedFingerprintRef = useRef<string | null>(null)
  /** 当前这篇文章的首次建立时间；覆盖保存时原样带回（列表里可能暂时读不到）。 */
  const createdAtRef = useRef<string | null>(null)

  const remember = useCallback((key: string | null, id: string | null) => {
    try {
      localStorage.setItem('reader:last', JSON.stringify({ key, id }))
    } catch {
      // 隐私模式忽略
    }
  }, [])

  const open = useArticleOpen({
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
  })

  const save = useArticleSave({
    articles,
    doc,
    savedId,
    setSavedId,
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
  })

  const edit = useArticleEdit({
    doc,
    sourceText,
    draft,
    setDraft,
    setEditing,
    setDoc,
    setSourceText,
    setPendingSave,
    flash,
  })

  const groups = useArticleBookGroups(book, edition)

  return {
    loadText: open.loadText,
    loadSaved: open.loadSaved,
    loadFromBook: open.loadFromBook,
    saveCurrent: save.saveCurrent,
    deleteSaved: save.deleteSaved,
    askDeleteSave: save.askDeleteSave,
    renameArticle: save.renameArticle,
    enterEdit: edit.enterEdit,
    applyEdit: edit.applyEdit,
    cancelEdit: edit.cancelEdit,
    onPick: open.onPick,
    bookKeys: groups.bookKeys,
    editions: groups.editions,
    shownKeys: groups.shownKeys,
  }
}
