import { useMemo } from 'react'
import { buildReadiness } from '../../core/readiness'
import { buildArticleQuestions } from '../../core/articleQuiz'
import type { ArticleQuizKind } from '../../core/quiz'
import { buildJournalDay, journalDays, journalSummary } from '../../core/journal'
import { buildHeatmap, dayTotal, type DayActivity } from '../../core/activity'
import { hasOwnExamples, isDue, isFresh, lemmaOf } from '../../core/vocab'
import { hasSentenceLanguage } from '../../core/language'
import { wordSpans } from '../../core/wordSelect'
import type { ListeningQuiz } from '../../core/listening'
import type { PracticeRecord } from '../../core/practice'
import type { StudiedDay } from '../../core/learning'
import type { Sentence, VocabItem } from '../../types/document'

export interface UseReaderViewDataParams {
  doc: { sentences: Sentence[] } | null
  libraryItems: VocabItem[]
  batchCount: number
  confusableTodoCount: number
  lemmaCandidatesCount: number
  writingHistoryCount: number
  listenQuiz: ListeningQuiz | null
  quizArticleKinds: ArticleQuizKind[]
  studiedDays: StudiedDay[]
  saved: { id: string; title: string; sourceKey?: string | null; sentences: Sentence[] }[]
  activity: DayActivity[]
  practice: PracticeRecord[]
  /** 学习日志当前选中的日期 */
  journalDay: string
}

/**
 * 侧栏 / 面板用的「视图派生」：就绪清单、学习日志、打印文章索引、文章测验可出题数。
 *
 * 都是「拿现有状态算一眼」的纯派生，不需要副作用；集中在这里后
 * `ReaderApp` 只负责把 hook 结果塞给宿主。
 */
export function useReaderViewData({
  doc,
  libraryItems,
  batchCount,
  confusableTodoCount,
  lemmaCandidatesCount,
  writingHistoryCount,
  listenQuiz,
  quizArticleKinds,
  studiedDays,
  saved,
  activity,
  practice,
  journalDay,
}: UseReaderViewDataParams) {
  /** 仪表盘：各能力当前可用性 */
  const readyRows = useMemo(
    () =>
      buildReadiness({
        hasDoc: !!doc,
        sentences: doc?.sentences.length ?? 0,
        translated: doc?.sentences.filter((s) => s.translation).length ?? 0,
        language: doc?.sentences.filter((s) => hasSentenceLanguage(s)).length ?? 0,
        listenQuiz: listenQuiz?.questions.length ?? 0,
        vocab: libraryItems.length,
        batch: batchCount,
        unqueried: libraryItems.filter((it) => it.status === 'unqueried').length,
        noMeaning: libraryItems.filter((it) => !it.meaning).length,
        noExampleUsage: libraryItems.filter(
          (it) => !hasOwnExamples(it) || (it.usage.length === 0 && !it.phrases?.length),
        ).length,
        noPhonetic: libraryItems.filter((it) => !it.phonetic).length,
        confusableMissing: confusableTodoCount,
        lemmaCandidates: lemmaCandidatesCount,
        due: libraryItems.filter((it) => isDue(it)).length,
        newWords: libraryItems.filter(isFresh).length,
        writingHistory: writingHistoryCount,
      }),
    [
      doc,
      listenQuiz,
      libraryItems,
      batchCount,
      confusableTodoCount,
      lemmaCandidatesCount,
      writingHistoryCount,
    ],
  )

  /** 学习日志：按天回顾。 */
  const journalInput = useMemo(
    () => ({
      studied: studiedDays,
      items: libraryItems,
      articles: saved.map((a) => ({ id: a.id, title: a.title, sentences: a.sentences })),
      activity,
      practice,
    }),
    [studiedDays, libraryItems, saved, activity, practice],
  )
  const journalAllDays = useMemo(() => journalDays(journalInput), [journalInput])
  const journalData = useMemo(() => buildJournalDay(journalInput, journalDay), [journalInput, journalDay])
  const journalSummaryRows = useMemo(() => journalSummary(journalInput), [journalInput])
  const journalHeat = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of activity) counts[a.day] = dayTotal(a)
    return buildHeatmap(counts, 13)
  }, [activity])

  /** 打印面板：已保存文章 + 每篇正文里的 lemma（老数据兜底；新数据走按篇条目）。 */
  const exportArticles = useMemo(
    () =>
      saved.map((a) => {
        const lemmas = new Set<string>()
        for (const s of a.sentences) for (const w of wordSpans(s.text)) lemmas.add(lemmaOf(w.text))
        const aliases = [a.sourceKey, a.title].filter((x): x is string => !!x && x !== a.id)
        return { id: a.id, title: a.title, aliases, lemmas }
      }),
    [saved],
  )

  /** 文章测验可出题数（设置面板提示用）。 */
  const articleQuizCount = useMemo(
    () => buildArticleQuestions(doc?.sentences ?? [], { kinds: quizArticleKinds }).length,
    [doc, quizArticleKinds],
  )

  return {
    readyRows,
    journalInput,
    journalAllDays,
    journalData,
    journalSummaryRows,
    journalHeat,
    exportArticles,
    articleQuizCount,
  }
}
