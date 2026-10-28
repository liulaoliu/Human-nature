import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { buildArticleQuestions } from '../../core/articleQuiz'
import { isArticleKind, shuffleQuiz, type QuizKind, type QuizQuestion } from '../../core/quiz'
import {
  buildQuizSet,
  poolFor,
  type PoolContext,
  type QuizScope,
} from '../../core/quizPool'
import { buildWarmupCards, type DrillWarmupCard } from '../../core/quizWarmup'
import type { Sentence, VocabItem } from '../../types/document'

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
  start: () => void
  startArticle: () => void
  startItems: (ids: string[], kindsArg?: QuizKind[]) => void
  startDrill: (
    ks: QuizKind[],
    scopeArg?: QuizScope,
    opts?: { warmup?: 'memory' | 'chunk' },
  ) => void
  startArticleDrill: (ks: QuizKind[]) => void
}

/**
 * 出卷入口：按当前设置 / 指定词条 / 精读工作流组题，交给主 hook 的 `begin` 开考。
 *
 * 这里不碰进行中的答题状态，只决定「这一轮考哪些题」；预习卡也归它（题已经出好，
 * 只是等人看完再入队）。判分、完成结算仍在 `useQuizSession` 的其它子 hook。
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
    setScope,
    limit,
    unique,
    articleKinds,
    setArticleKinds,
    begin,
    flash,
  } = params

  const [warmup, setWarmup] = useState<DrillWarmupState | null>(null)

  /** 文章级测验：按当前文章出题（英译中/中译英/功能词填空/句子排序/结构语法）。 */
  const startArticle = useCallback(() => {
    const sents = doc?.sentences ?? []
    const ks = articleKinds.filter(isArticleKind)
    const qs = buildArticleQuestions(sents, { kinds: ks })
    if (!qs.length) {
      flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length), { article: true })
  }, [doc, articleKinds, limit, begin, flash])

  /** 用当前设置出一份考卷（洗牌 + 限量）。 */
  const start = useCallback(() => {
    const qs = buildQuizSet(pool, kinds, unique)
    if (!qs.length) {
      flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
      return
    }
    begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length))
  }, [pool, kinds, unique, limit, begin, flash])

  /** 从指定词条开一轮考试（错题本「重练词汇」/ 错题包围战 用）。可指定题型。 */
  const startItems = useCallback(
    (ids: string[], kindsArg?: QuizKind[]) => {
      const items = libraryItems.filter((it) => ids.includes(it.id))
      const qs = buildQuizSet(items, kindsArg ?? kinds, unique)
      if (!qs.length) {
        flash('这些词暂时出不了题（缺释义 / 例句）')
        return
      }
      if (kindsArg) setKinds(kindsArg)
      begin(qs)
    },
    [libraryItems, kinds, unique, begin, flash, setKinds],
  )

  /**
   * 精读工作流：用指定题型 / 范围直接开一轮「拷打」。
   *
   * `opts.warmup`：先给一张「这轮要考的词」预习卡（词 + 释义 + 词块），看完再开考。
   * 记忆/词块两档拷打是**闭卷回忆**，直接上来就考等于让用户猜 —— 先过一遍认一遍，
   * 考出来的分才有意义（也让「词块拷打」第一次就能看到词组长什么样）。
   */
  const startDrill = useCallback(
    (ks: QuizKind[], scopeArg: QuizScope = 'article', opts?: { warmup?: 'memory' | 'chunk' }) => {
      const vocabKinds = ks.filter((k) => !isArticleKind(k))
      const qs = buildQuizSet(poolFor(studyable, scopeArg, poolCtx), vocabKinds, unique)
      if (!qs.length) {
        flash('这个范围/题型下没题可出（词条可能缺释义或例句）')
        return
      }
      setKinds(ks)
      setScope(scopeArg)
      const picked = shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length)
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
    [studyable, poolCtx, unique, limit, begin, flash, setKinds, setScope, libraryItems],
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
    (ks: QuizKind[]) => {
      const sents = doc?.sentences ?? []
      const qs = buildArticleQuestions(sents, { kinds: ks.filter(isArticleKind) })
      if (!qs.length) {
        flash('文章测验没题可出（缺译文 / 语言点，或句子太少）')
        return
      }
      setArticleKinds(ks)
      begin(shuffleQuiz(qs).slice(0, limit > 0 ? limit : qs.length), { article: true })
    },
    [doc, limit, begin, flash, setArticleKinds],
  )

  return { warmup, beginWarmup, cancelWarmup, start, startArticle, startItems, startDrill, startArticleDrill }
}
