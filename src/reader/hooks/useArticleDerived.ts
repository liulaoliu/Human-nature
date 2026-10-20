import { useMemo } from 'react'
import { activityStreak, type DayActivity } from '../../core/activity'
import { buildArticleMastery, isStable } from '../../core/mastery'
import { buildIntensivePlan } from '../../core/intensive'
import { buildOutputBoard } from '../../core/output'
import { hasOwnExamples, isDue } from '../../core/vocab'
import { hasSentenceLanguage } from '../../core/language'
import { practiceForArticle, type PracticeRecord } from '../../core/practice'
import type { KindStats, RetellRecord } from '../../core/learning'
import type { MistakeEntry } from '../../core/mistakes'
import type { WritingRecord } from '../../core/writing'
import type { Sentence, VocabItem } from '../../types/document'

export interface UseArticleDerivedParams {
  articleIdentity: string
  /** 本篇词条（已在上面按归属过滤） */
  articleWords: VocabItem[]
  doc: { sentences: Sentence[] } | null
  practice: PracticeRecord[]
  mistakes: MistakeEntry[]
  writingHistory: WritingRecord[]
  retells: RetellRecord[]
  kindStats: KindStats
  activity: DayActivity[]
  skimmedArticles: string[]
}

/**
 * 本篇的派生数据：掌握度 / 精读工作流 / 复述 / 产出看板。
 *
 * 全都是纯派生（输入变才重算），原先散在 `ReaderApp` 里各占一段 `useMemo`；
 * 收进一个 hook 后，口径（哪些算本篇、哪些算稳定）只有这一份实现。
 */
export function useArticleDerived({
  articleIdentity,
  articleWords,
  doc,
  practice,
  mistakes,
  writingHistory,
  retells,
  kindStats,
  activity,
  skimmedArticles,
}: UseArticleDerivedParams) {
  /** 本篇掌握度：词（SRS）+ 精读完成度 + 本篇技能正确率 + 本篇错题。 */
  const articleMastery = useMemo(() => {
    const words = articleWords
    let stable = 0
    let due = 0
    let lapsed = 0
    let fresh = 0
    for (const it of words) {
      if (isStable(it)) stable += 1
      if (isDue(it)) due += 1
      if ((it.reviewState.lapses ?? 0) > 0) lapsed += 1
      if (it.reviewState.repetitions === 0) fresh += 1
    }
    const sents = doc?.sentences ?? []
    const reading = {
      sentences: sents.length,
      translated: sents.filter((s) => s.translation).length,
      language: sents.filter((s) => hasSentenceLanguage(s)).length,
    }
    const stat = (kind: string) => {
      const rows = practiceForArticle(practice, articleIdentity).filter((r) => r.kind === kind)
      const total = rows.reduce((a, r) => a + r.total, 0)
      const correct = rows.reduce((a, r) => a + r.correct, 0)
      return total > 0 ? { total, correct } : undefined
    }
    const mine = mistakes.filter((m) => {
      if (m.kind === 'vocab') return !!m.itemId && words.some((it) => it.id === m.itemId)
      if (m.kind === 'listen') return m.articleId === articleIdentity
      if (m.kind === 'dict') return !!m.text && sents.some((s) => s.text.includes(m.text ?? ''))
      return false
    })
    return buildArticleMastery({
      words: { total: words.length, stable, due, lapsed, fresh },
      reading,
      skills: { quiz: stat('quiz'), dictation: stat('dictation'), listening: stat('listening') },
      mistakes: {
        words: mine.filter((m) => m.kind === 'vocab').length,
        sentences: mine.filter((m) => m.kind !== 'vocab').length,
      },
    })
  }, [articleWords, doc, practice, mistakes, articleIdentity])

  /** 精读工作流：按本篇当前数据算出各阶段进度与下一步。 */
  const intensiveSkimmed = skimmedArticles.includes(articleIdentity)
  const intensivePlan = useMemo(() => {
    const w = articleWords
    const quizRows = practiceForArticle(practice, articleIdentity).filter((r) => r.kind === 'quiz')
    const quizTotal = quizRows.reduce((a, r) => a + r.total, 0)
    const quizCorrect = quizRows.reduce((a, r) => a + r.correct, 0)
    const sents = doc?.sentences ?? []
    return buildIntensivePlan({
      hasDoc: !!doc,
      skimmed: intensiveSkimmed,
      words: {
        total: w.length,
        withMeaning: w.filter((it) => !!it.meaning).length,
        withChunks: w.filter((it) => it.usage.length > 0 || (it.phrases?.length ?? 0) > 0).length,
        withMarks: w.filter((it) => (it.grammarMarks?.length ?? 0) > 0).length,
        studied: w.filter((it) => it.reviewState.repetitions > 0).length,
        stable: w.filter((it) => isStable(it)).length,
        due: w.filter((it) => isDue(it)).length,
        noExample: w.filter((it) => !hasOwnExamples(it)).length,
      },
      sentences: {
        total: sents.length,
        translated: sents.filter((s) => !!s.translation).length,
        language: sents.filter((s) => hasSentenceLanguage(s)).length,
      },
      quiz: quizTotal > 0 ? { total: quizTotal, correct: quizCorrect } : undefined,
      writes: writingHistory.filter((r) => r.articleId === articleIdentity).length,
    })
  }, [doc, articleWords, practice, articleIdentity, writingHistory, intensiveSkimmed])

  /** 本篇的复述记录。 */
  const myRetells = useMemo(
    () => retells.filter((r) => r.articleId === articleIdentity),
    [retells, articleIdentity],
  )

  /** 产出看板：词块/搭配/习语正确率 + 仿写 + 复述 的量化。 */
  const outputBoard = useMemo(() => {
    const ks = kindStats[articleIdentity] ?? {}
    const sumKinds = (list: string[]) => {
      let total = 0
      let correct = 0
      for (const k of list) {
        const s = ks[k]
        if (s) {
          total += s.total
          correct += s.correct
        }
      }
      return { total, correct }
    }
    const chunkStats = sumKinds(['usage', 'collocation', 'prep', 'idiom'])
    const grammarStats = sumKinds(['grammar', 'phraseBlank', 'functionWord', 'ordering', 'translate', 'translate2'])
    const writes = writingHistory.filter((r) => r.articleId === articleIdentity)
    const avgScore = writes.length
      ? Math.round(
          writes.reduce(
            (a, r) => a + (r.feedback.max > 0 ? (r.feedback.total / r.feedback.max) * 100 : 0),
            0,
          ) / writes.length,
        )
      : null
    return buildOutputBoard({
      chunkStats,
      grammarStats,
      words: {
        total: articleWords.length,
        withChunks: articleWords.filter((it) => it.usage.length > 0 || (it.phrases?.length ?? 0) > 0).length,
        studied: articleWords.filter((it) => it.reviewState.repetitions > 0).length,
        stable: articleWords.filter((it) => isStable(it)).length,
      },
      writes: { count: writes.length, avgScore },
      retells: { count: myRetells.length, words: myRetells.reduce((a, r) => a + r.words, 0) },
      streak: activityStreak(activity),
    })
  }, [kindStats, articleIdentity, writingHistory, articleWords, myRetells, activity])

  return { articleMastery, intensiveSkimmed, intensivePlan, myRetells, outputBoard }
}
