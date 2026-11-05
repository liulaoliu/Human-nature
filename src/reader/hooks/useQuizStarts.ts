import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { buildArticleQuestions } from '../../core/articleQuiz'
import { isArticleKind, shuffleQuiz, type QuizKind, type QuizQuestion } from '../../core/quiz'
import { useQuizRoundHistory, type QuizRoundSpec } from './useQuizRoundHistory'
import {
  buildQuizSet,
  poolFor,
  type PoolContext,
  type QuizScope,
} from '../../core/quizPool'
import { buildWarmupCards, type DrillWarmupCard } from '../../core/quizWarmup'
import type { Sentence, VocabItem } from '../../types/document'

export type { QuizRoundSpec } from './useQuizRoundHistory'

/** 预习态：题目已经出好，等人看完再开考。 */
export interface DrillWarmupState {
  /** memory = 记忆拷打（词·搭配），chunk = 词块拷打（词块·搭配） */
  kind: 'memory' | 'chunk'
  title: string
  cards: DrillWarmupCard[]
  /** 点「开始拷打」时才真正进队列 */
  questions: QuizQuestion[]
  article: boolean
}

export interface UseQuizStartsParams {
  doc: { sentences: Sentence[] } | null
  libraryItems: VocabItem[]
  /** 可出题的词条（已过滤用法笔记）。 */
  studyable: VocabItem[]
  /** 当前范围下的候选池。 */
  pool: VocabItem[]
  poolCtx: PoolContext
  kinds: QuizKind[]
  setKinds: Dispatch<SetStateAction<QuizKind[]>>
  scope: QuizScope
  setScope: Dispatch<SetStateAction<QuizScope>>
  limit: number
  unique: boolean
  articleKinds: QuizKind[]
  setArticleKinds: Dispatch<SetStateAction<QuizKind[]>>
  begin: (qs: QuizQuestion[], opts?: { article?: boolean }) => void
  flash: (message: string) => void
}

export interface QuizStarts {
  warmup: DrillWarmupState | null
  beginWarmup: () => void
  cancelWarmup: () => void
  start: (opts?: { limit?: number; scope?: QuizScope; kinds?: QuizKind[] }) => void
  startArticle: (limit?: number) => void
  startItems: (ids: string[], kindsArg?: QuizKind[], opts?: { limit?: number }) => void
  startDrill: (
    ks: QuizKind[],
    scopeArg?: QuizScope,
    opts?: { warmup?: 'memory' | 'chunk'; limit?: number },
  ) => void
  /** `limit` 省略 = 用考试设置里的题量；精读面板会传各自入口的数。 */
  startArticleDrill: (ks: QuizKind[], limit?: number) => void
  /** 上一轮的模式 / 范围 / 题型 / 实际题数（结算页「再来一轮」用）。 */
  lastRound: QuizRoundSpec | null
  /** 按上一轮完整复现；只换 `limit`。 */
  restart: (limit?: number) => void
  /** 答完一题后记入本轮历史，下一轮跳过。 */
  markAnswered: (q: QuizQuestion) => void
}

/**
 * 出卷入口：按当前设置 / 指定词条 / 精读工作流组题，交给主 hook 的 `begin` 开考。
 *
 * 这里不碰进行中的答题状态，只决定「这一轮考哪些题」；预习卡也归它（题已经出好，
 * 只是等人看完再入队）。判分、完成结算仍在 `useQuizSession` 的其它子 hook。
 *
 * 「同一轮不重复」的口径：按 `quizHistory` 的 key 记已经答过的题（词级按词条、
 * 文章级按题目），下一轮只从没答过的里面抽；新题不够就只考剩下的，不拿旧题凑数。
 */
export function useQuizStarts(params: UseQuizStartsParams): QuizStarts {
  const {
    doc,
    libraryItems,
    studyable,
    pool,
    poolCtx,
    kinds,
    setKinds,
    scope,
    setScope,
    limit,
    unique,
    articleKinds,
    setArticleKinds,
    begin,
    flash,
  } = params

  const [warmup, setWarmup] = useState<DrillWarmupState | null>(null)
  const { lastRound, markAnswered, prepare, remember } = useQuizRoundHistory(flash)

  /** track 里包含文章标识：换文章不继承上一篇的「考过」。 */
  const trackKey = useCallback(
    (source: 'vocab' | 'article', scopeArg: QuizScope, ks: QuizKind[]) =>
      `${poolCtx.articleIdentity}|${source}|${source === 'article' ? '' : scopeArg}|${[...ks].sort().join(',')}`,
    [poolCtx.articleIdentity],
  )

  /** 用当前设置出一份考卷（洗牌 + 限量 + 跳过已考）。 */
  const start = useCallback(
    (opts?: { limit?: number; scope?: QuizScope; kinds?: QuizKind[] }) => {
      const nextScope = opts?.scope ?? scope
      const nextKinds = opts?.kinds ?? kinds
      const sourcePool = nextScope === scope ? pool : poolFor(studyable, nextScope, poolCtx)
      const qs = buildQuizSet(sourcePool, nextKinds, unique)
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      const take = opts?.limit ?? limit
      const key = trackKey('vocab', nextScope, nextKinds)
      const picked = prepare(key, qs, take)
      setKinds(nextKinds)
      setScope(nextScope)
      remember({ source: 'vocab', scope: nextScope, kinds: nextKinds, limit: take, key }, picked, take)
      begin(picked)
    },
    [pool, scope, kinds, studyable, poolCtx, unique, limit, begin, flash, setKinds, setScope, trackKey, prepare, remember],
  )

  /** 文章级测验：按当前文章出题（英译中/中译英/功能词填空/句子排序/结构语法）。 */
  const startArticle = useCallback(
    (limitArg?: number) => {
      const sents = doc?.sentences ?? []
      const ks = articleKinds.filter(isArticleKind)
      const qs = buildArticleQuestions(sents, { kinds: ks })
      if (!qs.length) {
        flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
        return
      }
      const take = limitArg ?? limit
      const key = trackKey('article', 'article', ks)
      const picked = prepare(key, qs, take)
      setArticleKinds(ks)
      remember({ source: 'article', scope: 'article', kinds: ks, limit: take, key }, picked, take)
      begin(picked, { article: true })
    },
    [doc, articleKinds, limit, begin, flash, setArticleKinds, trackKey, prepare, remember],
  )

  /** 从指定词条开一轮考试（错题本「重练词汇」/ 错题包围战 用）。可指定题型。 */
  const startItems = useCallback(
    (ids: string[], kindsArg?: QuizKind[], opts?: { limit?: number }) => {
      const items = libraryItems.filter((it) => ids.includes(it.id))
      const qs = buildQuizSet(items, kindsArg ?? kinds, unique)
      if (!qs.length) {
        flash('这些词暂时出不了题（缺释义 / 例句）')
        return
      }
      if (kindsArg) setKinds(kindsArg)
      const take = opts?.limit ?? 0
      const picked = take > 0 ? shuffleQuiz(qs).slice(0, take) : qs
      remember(
        { source: 'items', scope: 'all', kinds: kindsArg ?? kinds, limit: take, ids: [...ids], key: '' },
        picked,
        take,
      )
      begin(picked)
    },
    [libraryItems, kinds, unique, begin, flash, setKinds, remember],
  )

  /**
   * 精读工作流：用指定题型 / 范围直接开一轮「拷打」。
   *
   * `opts.warmup`：先给一张「这轮要考的词」预习卡（词 + 释义 + 词块），看完再开考。
   * 记忆/词块两档拷打是**闭卷回忆**，直接上来就考等于让用户猜 —— 先过一遍认一遍，
   * 考出来的分才有意义（也让「词块拷打」第一次就能看到词组长什么样）。
   */
  const startDrill = useCallback(
    (ks: QuizKind[], scopeArg: QuizScope = 'article', opts?: { warmup?: 'memory' | 'chunk'; limit?: number }) => {
      const vocabKinds = ks.filter((k) => !isArticleKind(k))
      const qs = buildQuizSet(poolFor(studyable, scopeArg, poolCtx), vocabKinds, unique)
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      const take = opts?.limit ?? limit
      const key = trackKey('vocab', scopeArg, ks)
      const picked = prepare(key, qs, take)
      setKinds(ks)
      setScope(scopeArg)
      remember({ source: 'vocab', scope: scopeArg, kinds: ks, limit: take, key }, picked, take)
      if (opts?.warmup) {
        const cards = buildWarmupCards(libraryItems, picked, opts.warmup)
        setWarmup({
          kind: opts.warmup,
          title: opts.warmup === 'chunk' ? '词块拷打 · 先看一遍' : '记忆拷打 · 先看一遍',
          cards,
          questions: picked,
          article: false,
        })
        return
      }
      begin(picked)
    },
    [
      studyable,
      poolCtx,
      unique,
      limit,
      begin,
      flash,
      setKinds,
      setScope,
      libraryItems,
      trackKey,
      prepare,
      remember,
    ],
  )

  /** 看完预习卡，开始拷打。 */
  const beginWarmup = useCallback(() => {
    const w = warmup
    if (!w) return
    setWarmup(null)
    begin(w.questions, { article: w.article })
  }, [warmup, begin])

  /** 关掉预习卡（本轮不考）。 */
  const cancelWarmup = useCallback(() => setWarmup(null), [])

  /** 精读工作流：用指定文章级题型开一轮（结构/语法、中译英、功能词、排序）。 */
  const startArticleDrill = useCallback(
    (ks: QuizKind[], limitArg?: number) => {
      const sents = doc?.sentences ?? []
      const articleKs = ks.filter(isArticleKind)
      const qs = buildArticleQuestions(sents, { kinds: articleKs })
      if (!qs.length) {
        flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
        return
      }
      const take = limitArg ?? limit
      const key = trackKey('article', 'article', articleKs)
      const picked = prepare(key, qs, take)
      setArticleKinds(ks)
      remember({ source: 'article', scope: 'article', kinds: ks, limit: take, key }, picked, take)
      begin(picked, { article: true })
    },
    [doc, limit, begin, flash, setArticleKinds, trackKey, prepare, remember],
  )

  /** 按上一轮的来源 / 范围 / 题型再来一轮，只换数量。 */
  const restart = useCallback(
    (limitArg?: number) => {
      const spec = lastRound
      if (!spec) return
      const take = limitArg ?? spec.limit
      if (spec.source === 'article') startArticleDrill(spec.kinds, take)
      else if (spec.source === 'items' && spec.ids) startItems(spec.ids, spec.kinds, { limit: take })
      else start({ limit: take, scope: spec.scope, kinds: spec.kinds })
    },
    [lastRound, start, startArticleDrill, startItems],
  )

  return {
    warmup,
    beginWarmup,
    cancelWarmup,
    start,
    startArticle,
    startItems,
    startDrill,
    startArticleDrill,
    lastRound,
    restart,
    markAnswered,
  }
}
