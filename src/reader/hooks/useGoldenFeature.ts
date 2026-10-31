import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { GoldenPanelActions } from '../panels/GoldenPanel'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import { buildLocalGoldenExamItem } from '../../core/goldenExam'
import type { SavedArticle } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { isGoldenWritingRecord, WRITING_HISTORY_WARN_AT, type WritingRecord } from '../../core/writing'
import type { WritingRecommendationGroup } from '../../core/writingErrors'
import type { WritingErrorCard } from '../../core/writingErrorReview'
import { collectWritingErrorCards } from '../../core/writingErrorReview'
import type { AnswerEvent, AnswerEventInput } from '../../core/answerEvents'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import {
  applyWritingErrorReview,
  setWritingErrorProgressStatus,
  syncWritingErrorProgress,
  writingErrorProgressFromEvents,
} from '../../core/writingErrorProgress'
import { langPointChoiceId, langPointChoices } from '../../core/goldenLangPoint'
import { writingHistoryToPrintHTML } from '../../core/writingExport'
import { openPrintWindow } from './printWindow'
import type { ReaderDoc } from './useReaderDoc'
import { useGoldenBank } from './useGoldenBank'
import { useGoldenExam } from './useGoldenExam'
import { useGoldenImitation } from './useGoldenImitation'
import { useGoldenLangPoint } from './useGoldenLangPoint'
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
  answerEvents: readonly AnswerEvent[]
  writingErrorProgress: readonly WritingErrorProgress[]
  setWritingErrorProgress: Dispatch<SetStateAction<WritingErrorProgress[]>>
  recordAnswer: (event: AnswerEventInput) => void
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
  answerEvents,
  writingErrorProgress,
  setWritingErrorProgress,
  recordAnswer,
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
  const currentSentence = golden.currentSentence
  const extraPointsFor = golden.extraPointsFor
  const bySentence = golden.bySentence
  const currentExtraPoints = useMemo(
    () => (currentSentence ? extraPointsFor(currentSentence.id) : []),
    [currentSentence, extraPointsFor],
  )
  /** 批改提示词里可引用的文章语言点；id 与「加入本课」使用同一套 slug。 */
  const availablePoints = useMemo(() => {
    const s = currentSentence ? bySentence.get(currentSentence.id) : null
    if (!s) return []
    return langPointChoices(s, undefined, currentExtraPoints).map((c) => ({
      id: langPointChoiceId(s.id, c.en),
      en: c.en,
      ...(c.zh ? { zh: c.zh } : {}),
      kind: 'chunk',
    }))
  }, [currentSentence, bySentence, currentExtraPoints])
  const sentenceImitation = useGoldenImitation({
    current: sentenceItem,
    articleId: golden.articleId,
    articleTitle,
    source: 'goldenSentence',
    setWritingHistory,
    writingHistory,
    availablePoints,
    flash,
    recordActivity,
  })
  // 每次进「本句仿写」都从空白开始；同一句重练也不带上一轮答案。
  useEffect(() => {
    if (golden.phase === 'imitation') sentenceImitation.reset()
    // 只用到 `sentenceImitation.reset`（已列出），不是整个仿写状态机。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 批改记录只增不删：超过提醒线时提示一次导出归档（别静默丢，也别悄悄变慢）
  const warnedHistoryRef = useRef(false)
  useEffect(() => {
    if (warnedHistoryRef.current || writingHistory.length < WRITING_HISTORY_WARN_AT) return
    warnedHistoryRef.current = true
    flash(
      `批改记录已超过 ${WRITING_HISTORY_WARN_AT} 条：建议「导出批改」归档，页面会随记录变多而变慢`,
    )
  }, [writingHistory.length, flash])

  // 语言点造句：同一句的额外练习，记录同样进 writingHistory（带 task.focus）
  const langPoint = useGoldenLangPoint({
    sentence: golden.currentSentence ?? null,
    articleId: golden.articleId,
    articleTitle,
    writingHistory,
    setWritingHistory,
    extraPoints: currentExtraPoints,
    flash,
    recordActivity,
  })

  // 本科的仿写 / 考试批改历史：单句仿写 + 整课考试都算，按文章归属
  const history = useMemo(() => {
    const all = writingHistory.filter(isGoldenWritingRecord)
    return {
      all,
      article: all.filter((r) => r.articleId === golden.articleId),
    }
  }, [writingHistory, golden.articleId])

  const allCards = useMemo(
    () => collectWritingErrorCards(history.all, { scope: 'all' }),
    [history.all],
  )
  // 新批改产生新错因时补一行进度（不覆盖已有 streak / paused）；只在新卡出现时写一次。
  useEffect(() => {
    if (!allCards.length) return
    const { next, added } = syncWritingErrorProgress(
      writingErrorProgress,
      allCards,
      new Date().toISOString(),
      answerEvents,
    )
    if (added) setWritingErrorProgress(next)
  }, [allCards, writingErrorProgress, answerEvents, setWritingErrorProgress])

  const actions: GoldenPanelActions = {
    onExportMarkdown: bank.exportLesson,
    onGenerate,
    history,
    errors: {
      onAddPoint: (rec: WritingRecommendationGroup) => {
        if (rec.kind === 'grammar') {
          flash('这条属于语法规则，已经在错因卡里；语言点只收词块 / 句型 / 搭配')
          return
        }
        if (rec.articleId !== golden.articleId) {
          flash('这条推荐来自别的文章；先切到那篇再加入本课')
          return
        }
        if (!rec.sentenceId) {
          flash('这条推荐没有对应句子，暂时不能加入本课')
          return
        }
        golden.addExtraPoint({
          sentenceId: rec.sentenceId,
          en: rec.point,
          ...(rec.zh ? { zh: rec.zh } : {}),
          kind: rec.kind,
          source: 'ai',
          ...(rec.issueKey ? { issueKey: rec.issueKey } : {}),
        })
      },
      writingErrorProgress,
      onReviewAnswer: (card: WritingErrorCard, correct: boolean) => {
        const nowIso = new Date().toISOString()
        setWritingErrorProgress((prev) => {
          const old = prev.find((p) => p.id === card.id)
          const base = old ?? writingErrorProgressFromEvents(card, answerEvents, nowIso)
          const updated = applyWritingErrorReview(base, card, correct, nowIso)
          return [updated, ...prev.filter((p) => p.id !== card.id)]
        })
        recordAnswer({
          articleId: card.articleId,
          source: 'golden',
          kind: 'error-fix',
          cat: 'write',
          correct,
          questionId: card.id,
        })
        recordActivity('write', 1)
      },
      onPauseReview: (card: WritingErrorCard) => {
        const nowIso = new Date().toISOString()
        setWritingErrorProgress((prev) => {
          const old = prev.find((p) => p.id === card.id)
          const updated = setWritingErrorProgressStatus(old, card, 'paused', nowIso)
          return [updated, ...prev.filter((p) => p.id !== card.id)]
        })
      },
      onResumeReview: (card: WritingErrorCard) => {
        const nowIso = new Date().toISOString()
        setWritingErrorProgress((prev) => {
          const old = prev.find((p) => p.id === card.id)
          const updated = setWritingErrorProgressStatus(old, card, 'active', nowIso)
          return [updated, ...prev.filter((p) => p.id !== card.id)]
        })
      },
      extraPoints: golden.extraPoints,
      onRemovePoint: golden.removeExtraPoint,
      onMissingSentence: () =>
        flash('这句不在当前文章的金句课里：先切到对应文章，再点「去练」'),
    },
    onPrintHistory: (rows, title) => {
      if (!rows.length) {
        flash('没有可打印的学习历史')
        return
      }
      if (!openPrintWindow(writingHistoryToPrintHTML(rows, title), title)) flash('弹窗被拦截，允许后重试')
    },
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
    langPoint,
  }

  return { bank, actions, exam, sentenceImitation }
}
