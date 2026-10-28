import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { cleanText } from '../../core/cleaner'
import { carryAnalysis, segment } from '../../core/segmenter'
import { pruneGoldenLesson } from '../../core/goldenParse'
import type { ReaderDoc } from './useReaderDoc'

export interface UseArticleEditParams {
  doc: ReaderDoc | null
  sourceText: string
  draft: string
  setDraft: (v: string) => void
  setEditing: (v: boolean) => void
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setSourceText: (v: string) => void
  setPendingSave: (v: boolean) => void
  flash: (message: string) => void
}

/** 正文编辑：进入编辑、重新切句并按句搬分析、取消。 */
export function useArticleEdit({
  doc,
  sourceText,
  draft,
  setDraft,
  setEditing,
  setDoc,
  setSourceText,
  setPendingSave,
  flash,
}: UseArticleEditParams) {
  const enterEdit = useCallback(() => {
    if (!doc) return
    setDraft(sourceText)
    setEditing(true)
  }, [doc, sourceText, setDraft, setEditing])

  const applyEdit = useCallback(() => {
    const cleaned = cleanText(draft)
    const next = segment(cleaned)
    const sentences = carryAnalysis(doc?.sentences ?? [], next.sentences)
    const golden = pruneGoldenLesson(doc?.golden, sentences)
    setDoc({ paragraphs: next.paragraphs, sentences, ...(golden ? { golden } : {}) })
    setSourceText(cleaned)
    setEditing(false)
    setPendingSave(true)
    flash('已应用修改（已粘回的分析按句保留）')
  }, [draft, doc, setDoc, setSourceText, setEditing, setPendingSave, flash])

  const cancelEdit = useCallback(() => setEditing(false), [setEditing])

  return { enterEdit, applyEdit, cancelEdit }
}
