import { useMemo } from 'react'
import { activityStreak, type DayActivity } from '../../core/activity'
import { buildArticleMastery, isStable } from '../../core/mastery'
import { buildIntensivePlan } from '../../core/intensive'
import { buildOutputBoard } from '../../core/output'
import { hasReviewHistory, isDue, needsAiExamples } from '../../core/vocab'
import { hasSentenceLanguage } from '../../core/language'
import { practiceForArticle, type PracticeRecord } from '../../core/practice'
import type { KindStats, RetellRecord } from '../../core/learning'
import type { MistakeEntry } from '../../core/mistakes'
import type { WritingRecord } from '../../core/writing'
import type { Sentence, VocabItem } from '../../types/document'

/**
 * 「有词块」的判定：用法要点 / 词组 / 习语，任一非空就算。
 *
 * 精读工作流的「词块」阶段与产出看板的「词块覆盖」共用这一条 ——
 * 原来两处各写一遍，都漏了 `idioms`：只填了习语的词在两边都不算，进度永远差一截。
 */
function hasChunks(it: VocabItem): boolean {
  return it.usage.length > 0 || (it.phrases?.length ?? 0) > 0 || (it.idioms?.length ?? 0) > 0
}

export interface UseArticleDerivedParams {
  articleIdentity: string
  /**
   * 本篇**普通单词**（`articleWordItems`，不含词组 / 习语 / 用法笔记）。
   *
   * 为什么不用「含语言点」的那一份：这里的三个口径（掌握度、精读工作流的词阶段、
   * 产出看板）问的都是「这个词背得怎么样」。语言点条目里 `usage` 是中文说明，
   * 按设计永远不进背词牌组（`entryKind.isStudyable`），也就不可能 `repetitions > 0`；
   * 拿它们当分母会让「学过 N/M」永远到不了 100%，「达标拷打」与最高等级直接锁死。
   */
  articleWordItems: VocabItem[]
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
  articleWordItems,
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
    const words = articleWordItems
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
  }, [articleWordItems, doc, practice, mistakes, articleIdentity])

  /** 精读工作流：按本篇当前数据算出各阶段进度与下一步。 */
  const intensiveSkimmed = skimmedArticles.includes(articleIdentity)
  const intensivePlan = useMemo(() => {
    const w = articleWordItems
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
        withChunks: w.filter(hasChunks).length,
        // 「问过没有」看字段在不在（applyPhrases 一定同时写 phrases/idioms，空数组=AI 说「无」）
        chunksAsked: w.filter((it) => it.phrases !== undefined || hasChunks(it)).length,
        withMarks: w.filter((it) => (it.grammarMarks?.length ?? 0) > 0).length,
        studied: w.filter(hasReviewHistory).length,
        stable: w.filter((it) => isStable(it)).length,
        due: w.filter((it) => isDue(it)).length,
        // 与跑批的 `pickExamples` 同一口径：有释义、且还没有 **AI 例句**。
        // 用 `hasOwnExamples` 会算出另一个数（离线例句也算「有」），于是面板上挂着几百个
        // 「缺例句」，但跑批压根不会去补 —— 用户看到的就是「点多少次都没变化」。
        noExample: w.filter((it) => !!it.meaning && needsAiExamples(it)).length,
      },
      sentences: {
        total: sents.length,
        translated: sents.filter((s) => !!s.translation).length,
        language: sents.filter((s) => hasSentenceLanguage(s)).length,
      },
      quiz: quizTotal > 0 ? { total: quizTotal, correct: quizCorrect } : undefined,
      writes: writingHistory.filter((r) => r.articleId === articleIdentity).length,
    })
  }, [doc, articleWordItems, practice, articleIdentity, writingHistory, intensiveSkimmed])

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
        total: articleWordItems.length,
        withChunks: articleWordItems.filter(hasChunks).length,
        studied: articleWordItems.filter(hasReviewHistory).length,
        stable: articleWordItems.filter((it) => isStable(it)).length,
      },
      writes: { count: writes.length, avgScore },
      retells: { count: myRetells.length, words: myRetells.reduce((a, r) => a + r.words, 0) },
      streak: activityStreak(activity),
    })
  }, [kindStats, articleIdentity, writingHistory, articleWordItems, myRetells, activity])

  return { articleMastery, intensiveSkimmed, intensivePlan, myRetells, outputBoard }
}
