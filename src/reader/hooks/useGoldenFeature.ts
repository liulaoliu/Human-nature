import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { GoldenPanelActions } from '../panels/GoldenPanel'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import { buildLocalGoldenExamItem } from '../../core/goldenExam'
import type { SavedArticle } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { WritingRecord } from '../../core/writing'
import type { ReaderDoc } from './useReaderDoc'
import { useGoldenBank } from './useGoldenBank'
import { useGoldenExam } from './useGoldenExam'
import { useGoldenImitation } from './useGoldenImitation'
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
  const sentenceItem = useMemo(
    () =>
      golden.lesson && golden.currentSentence
        ? buildLocalGoldenExamItem(golden.lesson, doc?.sentences ?? [], golden.currentSentence.id)
        : null,
    [golden.lesson, golden.currentSentence, doc?.sentences],
  )
  const sentenceImitation = useGoldenImitation({
    current: sentenceItem,
    articleId: golden.articleId,
    articleTitle,
    source: 'goldenSentence',
    setWritingHistory,
    flash,
    recordActivity,
  })
  // 每次进「本句仿写」都从空白开始；同一句重练也不带上一轮答案。
  useEffect(() => {
    if (golden.phase === 'imitation') sentenceImitation.reset()
  }, [golden.phase, golden.current?.id, sentenceImitation.reset])
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
    sentenceImitation,
  }

  return { bank, actions, exam, sentenceImitation }
}
