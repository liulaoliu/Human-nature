// ============================================================
// quizPool — 「考哪些词」的候选池规则（纯函数）
//
// 范围（全库/本篇/未掌握/到期/常错）× 题型，决定这一轮能出多少题。
// 规则放这里（带测试），`reader/hooks/useQuizSession` 只负责拿结果去出卷。
// ============================================================
import {
  buildQuizQuestions,
  countQuestions,
  makeQuestion,
  shuffleQuiz,
  type QuizKind,
  type QuizQuestion,
} from './quiz'
import { isDue } from './vocab'
import { isStudyable } from './entryKind'
import type { VocabItem } from '../types/document'

/** 考试范围。 */
export type QuizScope = 'all' | 'article' | 'unmastered' | 'due' | 'lapses'

/** 范围的取值表（持久化设置用它校验）。 */
export const QUIZ_SCOPES: readonly QuizScope[] = ['all', 'article', 'unmastered', 'due', 'lapses']

/** 记忆 / 词块拷打默认每次考几项（可在精读面板调整，设置存本机）。 */
export const DEFAULT_DRILL_LIMIT = 10

/** 精读面板「每次拷打」下拉的可选档位。 */
export const DRILL_LIMIT_OPTIONS = [5, 10, 15, 20, 30] as const

/**
 * 把外部输入（localStorage / 下拉框）收敛到合法档位。
 * 只认 `DRILL_LIMIT_OPTIONS` 里的正整数，其余一律回默认 10：
 * 这样下拉框永远有对应选项，坏数据也不会变成 0 题（= 全部）或负数。
 */
export function normalizeDrillLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return (DRILL_LIMIT_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_DRILL_LIMIT
}

export interface PoolContext {
  /** 当前文章的 identity（词条的 source.fileName 用它认「本篇的词」）。 */
  articleIdentity: string
  /** 本篇出现的 lemma：没走过查词、但正文里有的，也算「本篇」。 */
  docLemmas: Set<string>
}

/** 能出题的词条：用法笔记（中文说明）不出题。 */
export function studyableItems(items: VocabItem[]): VocabItem[] {
  return items.filter(isStudyable)
}

/** 按范围取候选词。`studyable` 先过一次 `studyableItems` 更省（考试 / 拷打共用）。 */
export function poolFor(
  studyable: VocabItem[],
  scope: QuizScope,
  ctx: PoolContext,
  now: Date = new Date(),
): VocabItem[] {
  switch (scope) {
    case 'all':
      return studyable
    case 'due':
      return studyable.filter((it) => isDue(it, now))
    case 'lapses':
      return studyable.filter((it) => (it.reviewState.lapses ?? 0) > 0)
    case 'unmastered':
      return studyable.filter((it) => it.status !== 'mastered')
    case 'article':
      return studyable.filter((it) => it.source?.fileName === ctx.articleIdentity || ctx.docLemmas.has(it.lemma))
  }
}

export interface PoolSizes {
  all: number
  due: number
  unmastered: number
}

/** 各范围下按当前题型能出多少题（设置面板显示「全库 320 / 到期 12 …」用）。 */
export function poolSizes(studyable: VocabItem[], kinds: QuizKind[], now: Date = new Date()): PoolSizes {
  const count = (items: VocabItem[]) => countQuestions(items, kinds)
  return {
    all: count(studyable),
    due: count(studyable.filter((it) => isDue(it, now))),
    unmastered: count(studyable.filter((it) => it.status !== 'mastered')),
  }
}

/**
 * 出一份题集。
 * `unique` 开着（默认）= 每个词最多出一题（题型随机轮一遍，先出得来的先出）；
 * 关掉 = 交给 `buildQuizQuestions`（同词多题型都可能出现）。
 */
export function buildQuizSet(items: VocabItem[], kinds: QuizKind[], unique: boolean): QuizQuestion[] {
  if (!unique) return buildQuizQuestions(items, kinds)
  return shuffleQuiz(items)
    .map((it) => {
      for (const k of shuffleQuiz(kinds)) {
        const q = makeQuestion(it, k, items)
        if (q) return q
      }
      return null
    })
    .filter((q): q is QuizQuestion => q !== null)
}
