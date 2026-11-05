import { shuffleQuiz, type QuizQuestion } from './quiz'

/**
 * 「这一轮哪些题已经考过」的去重键。
 *
 * - 词级：按词条去重。同一个词这轮考了拼写，下一轮换成看词选义也算考过 ——
 *   用户要的是「下一轮学新词」，不是把同一个词换个题型再问一遍。
 * - 文章级：按题目 id 去重。同一句的「结构/语法」和「英译中」是两道不同的题，
 *   只跳过真正答过的那一道。
 */
export function questionHistoryKey(q: QuizQuestion): string {
  return q.source === 'article' ? q.id : `vocab:${q.itemId}`
}

export interface FreshQuestionPick {
  /** 洗牌后、按数量截好的本轮题目。 */
  picked: QuizQuestion[]
  /** 进入截断前的「没考过」总数（用于提示「只剩 N 道新题」）。 */
  fresh: number
}

/**
 * 从候选里挑本轮新题：先排掉 `seen` 里的，再洗牌取前 `limit` 道。
 *
 * `limit <= 0` = 不限（全部新题）。新题不够时**只返回剩下的**，绝不拿旧题凑数；
 * 调用方看到 `picked.length < limit` 可以提示「新题只剩 N 道」。
 */
export function pickFreshQuestions(
  questions: readonly QuizQuestion[],
  seen: ReadonlySet<string>,
  limit: number,
): FreshQuestionPick {
  const fresh = questions.filter((q) => !seen.has(questionHistoryKey(q)))
  const picked = shuffleQuiz([...fresh]).slice(0, limit > 0 ? limit : fresh.length)
  return { picked, fresh: fresh.length }
}
