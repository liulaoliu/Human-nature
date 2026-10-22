import { useCallback } from 'react'
import { inStudyDeck, type StudyDeck } from '../../core/entryKind'
import {
  buildLearnQueue,
  buildReviewQueue,
  sortItems,
  type StudyMode,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { StudyScope } from './useStudyPool'

/**
 * 「开一轮 / 换模式 / 换范围 / 换牌组」这几个入口（从 `useStudySession` 拆出来）。
 *
 * 它们只做一件事：决定这一轮**背哪些词、按什么顺序**，然后把队列交给主 hook
 * （`load` 负责重置账本、装队列、冻结分母）。评分、加练、拼写都不在这里。
 *
 * 空队列要说清为什么空（新词配额用完 / 没有到期的 / 这篇没生词），
 * 用户看到的是提示，不是一张空面板。
 */
export interface UseStudyStartsParams {
  library: VocabLibrary
  /** 按范围 + 牌组过滤出的候选池（`useStudyPool`）。 */
  poolFor: (scope: StudyScope, deck?: StudyDeck) => VocabItem[]
  mode: StudyMode
  scope: StudyScope
  deck: StudyDeck
  setMode: (m: StudyMode) => void
  setScope: (s: StudyScope) => void
  setDeck: (d: StudyDeck) => void
  /** 每天最多引入多少新词（0 = 不限）与今天已引入数。 */
  newLimit: number
  newToday: number
  flash: (message: string) => void
  /** 开始新一轮前关掉正在进行的考试。 */
  closeQuiz: () => void
  /** 拼错未确认时，不许重开一轮把判罚吞掉。 */
  blocked: boolean
  /** 把这一轮装进会话：重置账本 + 队列 + 分母 + 指针。 */
  load: (items: VocabItem[], opts?: { retrying?: boolean }) => void
  /** 空队列时收起旧队列（换牌组后旧队列已不对应当前牌组）。 */
  clear: () => void
}

export interface StudyStarts {
  start: (opts?: { mode?: StudyMode; scope?: StudyScope; deck?: StudyDeck }) => void
  switchMode: (m: StudyMode) => void
  switchScope: (s: StudyScope) => void
  switchDeck: (d: StudyDeck) => void
  /** 「本篇全部」：不分新学/复习、忽略新词配额，把这篇文章的生词整套过一遍。 */
  startArticleAll: () => void
  /** 「从头重学」一批词（考试拼错后立即跳过来）。 */
  startRelearn: (ids: string[]) => void
}

export function useStudyStarts(params: UseStudyStartsParams): StudyStarts {
  const {
    library,
    poolFor,
    mode,
    scope,
    deck,
    setMode,
    setScope,
    setDeck,
    newLimit,
    newToday,
    flash,
    closeQuiz,
    blocked,
    load,
    clear,
  } = params

  /** 开始背单词/背搭配：按模式组队（新学习 = 没学过的；复习 = 已学过且到期的）。 */
  const start = useCallback(
    (opts?: { mode?: StudyMode; scope?: StudyScope; deck?: StudyDeck }) => {
      if (blocked) return
      const nextMode = opts?.mode ?? mode
      const nextScope = opts?.scope ?? scope
      const nextDeck = opts?.deck ?? deck
      if (opts?.mode != null) setMode(nextMode)
      if (opts?.scope != null) setScope(nextScope)
      if (opts?.deck != null) setDeck(nextDeck)
      const p = poolFor(nextScope, nextDeck)
      const q =
        nextMode === 'review'
          ? buildReviewQueue(p, new Date())
          : buildLearnQueue(p, new Date(), { newLimit, newToday })
      if (!q.length) {
        const thing = nextDeck === 'collocation' ? '搭配' : '词'
        flash(
          nextMode === 'review'
            ? nextScope === 'article'
              ? `这篇没有到期的复习${thing}`
              : `没有到期的复习${thing}，去「新学习」吧`
            : nextScope === 'article'
              ? `这篇没有待学的新${thing}`
              : `没有待学的新${thing}，去「复习」吧`,
        )
        // 换牌组后旧队列已经不对应当前牌组，直接收起，避免界面显示错位的卡
        if (opts?.deck != null && nextDeck !== deck) clear()
        return
      }
      closeQuiz()
      load(q)
    },
    [blocked, mode, scope, deck, setMode, setScope, setDeck, poolFor, newLimit, newToday, flash, closeQuiz, load, clear],
  )

  const switchMode = useCallback((m: StudyMode) => start({ mode: m }), [start])
  const switchScope = useCallback((s: StudyScope) => start({ scope: s }), [start])

  const switchDeck = useCallback(
    (d: StudyDeck) => {
      if (d === deck) return
      if (!library.items.some((it) => inStudyDeck(it, d))) {
        flash(d === 'collocation' ? '还没有词组/习语：先在阅读里收藏语言点' : '还没有可背的单词')
        return
      }
      start({ deck: d })
    },
    [deck, library.items, flash, start],
  )

  const startArticleAll = useCallback(() => {
    if (blocked) return
    const p = poolFor('article')
    if (!p.length) {
      flash(deck === 'collocation' ? '这篇还没有搭配' : '这篇还没有生词')
      return
    }
    setScope('article')
    closeQuiz()
    load(sortItems(p, 'due'))
  }, [blocked, poolFor, deck, flash, setScope, closeQuiz, load])

  const startRelearn = useCallback(
    (ids: string[]) => {
      const set = new Set(ids)
      const items = library.items.filter((it) => set.has(it.id))
      if (!items.length) {
        flash('找不到要重学的词')
        return
      }
      closeQuiz()
      load(sortItems(items, 'due'), { retrying: true })
    },
    [library.items, flash, closeQuiz, load],
  )

  return { start, switchMode, switchScope, switchDeck, startArticleAll, startRelearn }
}
