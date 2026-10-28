import type { GoldenPanelActions } from '../panels/GoldenPanel'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { SavedArticle } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { WritingRecord } from '../../core/writing'
import type { Dispatch, SetStateAction } from 'react'
import type { ReaderDoc } from './useReaderDoc'
import { useGoldenBank } from './useGoldenBank'
import { useGoldenExam } from './useGoldenExam'
import type { useGoldenDrill } from './useGoldenDrill'

interface GoldenFeatureArgs {
  golden: ReturnType<typeof useGoldenDrill>
  doc: ReaderDoc | null
  articleTitle: string
  articleKey: string | null
  articleIdentity: string
  savedId: string | null
  saved: SavedArticle[]
  records: GoldenDrillRecord[]
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  recordActivity: (cat: ActivityCat, n?: number) => void
  download: (name: string, data: string, mime: string) => void
  flash: (message: string) => void
  onGenerate: () => void
  startWriting: (opts?: { model?: string; mustUse?: string[] }) => void
}

/**
 * 金句课的功能装配：把 drill / bank / 去仿写 / 导出动作收成一个 feature hook。
 * ReaderApp 只拿 `actions` 往模型里塞，不再自己拼五六个回调。
 */
export function useGoldenFeature({
  golden,
  doc,
  articleTitle,
  articleKey,
  articleIdentity,
  savedId,
  saved,
  records,
  writingHistory,
  setWritingHistory,
  recordActivity,
  download,
  flash,
  onGenerate,
  startWriting,
}: GoldenFeatureArgs) {
  const exam = useGoldenExam({
    doc,
    lesson: golden.lesson,
    articleId: golden.articleId,
    articleTitle,
    records,
    writingHistory,
    setWritingHistory,
    setDoc: golden.setDoc,
    setPendingSave: golden.setPendingSave,
    flash,
    recordActivity,
  })
  const bank = useGoldenBank({
    saved,
    savedId,
    articleKey,
    articleTitle,
    articleIdentity,
    doc,
    lesson: golden.lesson,
    records,
    download,
    flash,
  })

  const actions: GoldenPanelActions = {
    onExportMarkdown: bank.exportLesson,
    onGenerate,
    onOpenWriting: (mustUse) => {
      const firstId = golden.lesson?.selected[0] ?? golden.lesson?.sentences[0]?.id
      const sentence = firstId ? doc?.sentences.find((s) => s.id === firstId) : null
      if (!sentence) {
        flash('先选一句金句再仿写')
        return
      }
      golden.close()
      startWriting({ model: sentence.text, mustUse })
    },
    bank: {
      rows: bank.rows,
      onExportMarkdown: bank.exportMarkdown,
      onExportAnki: bank.exportAnki,
      onPrint: bank.printBank,
    },
    onPrintLesson: bank.printLesson,
    exam,
  }

  return { bank, actions, exam }
}
