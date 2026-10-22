import { useCallback, useRef, useState } from 'react'
import {
  isFresh,
  markSpellingMiss,
  planExtra,
  recordLearnPass,
  reviewItem,
  type ExtraRound,
  type ReviewGrade,
} from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import { fmtInterval } from '../format'

/**
 * 判一次分要做的账：写库 → 记「今天引入了新词」→ 计时 / 活动 / 计数 → 忘记账本 →
 * 把忘记/模糊的卡排到队尾 → 给一句判定提示。
 *
 * 从 `useStudySession`（769 行）抽出来。原来这套流程在四个地方各写一遍
 * （拼写判错、评分、标「不认识」、组末拼错的验收），改一处就得记得改另外三处：
 * 比如「新词第一次判到才计引入」漏了一处，今天的额度就会少扣一次。
 *
 * 这里只管账本，不管卡片的 UI 状态（`revealed` / `input` / `checked` 那些）
 * 和「要不要推进到下一张」——那些留在会话里，因为不同模式的推进规则不一样。
 */
export interface StudyGradingEnv {
  library: VocabLibrary
  /** 本轮加练账本（每卡最多出场 3 次，跨重练保留）。 */
  extraRound: ExtraRound
  setExtraRound: (round: ExtraRound) => void
  /** 忘记/模糊后把卡追加到队尾。 */
  setQueue: (update: (q: VocabItem[] | null) => VocabItem[] | null) => void
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  addStudyTime: (seconds: number, cards: number) => void
  flash: (message: string) => void
  onBumpNewToday: () => void
}

export function useStudyGrading({
  library,
  extraRound,
  setExtraRound,
  setQueue,
  persist,
  markStudied,
  recordActivity,
  addStudyTime,
  flash,
  onBumpNewToday,
}: StudyGradingEnv) {
  const [counts, setCounts] = useState({ know: 0, fuzzy: 0, forgot: 0 })
  /** 供外部（收尾小结）显示「重练忘记的 N 个」 */
  const [forgotCount, setForgotCount] = useState(0)
  /** 忘记/模糊触发的「加练」次数（单独计数，不计入分母）。 */
  const [extraCount, setExtraCount] = useState(0)
  const [gradeInfo, setGradeInfo] = useState('')
  /** 本轮点过「忘记了」的词 id，用于收尾重练 */
  const forgotRef = useRef<string[]>([])
  /** 拼错 / 判不认识时已经计过「今天引入」的词，避免同一天重复扣额度。 */
  const bumpedRef = useRef<Set<string>>(new Set())

  /** 新词头一回被判到才计一次「今天已引入」。 */
  const bumpIfFirstNew = (cur: VocabItem) => {
    if (isFresh(cur) && !bumpedRef.current.has(cur.id)) {
      bumpedRef.current.add(cur.id)
      onBumpNewToday()
    }
  }

  /** 一次判分的共同账：+1 张卡、记「今天学过」、记一次学习活动、对应桶 +1。 */
  const tally = (bucket: 'know' | 'fuzzy' | 'forgot', id: string) => {
    addStudyTime(0, 1)
    markStudied(id)
    recordActivity('vocab', 1)
    setCounts((c) => ({ ...c, [bucket]: c[bucket] + 1 }))
  }

  const noteForgot = (id: string) => {
    if (!forgotRef.current.includes(id)) {
      forgotRef.current.push(id)
      setForgotCount(forgotRef.current.length)
    }
  }

  /** 忘记 / 模糊的词本轮末尾再出现（每卡 3 次上限，规则在 `core/vocab/extra`）。 */
  const requeue = (cur: VocabItem, g: ReviewGrade): boolean => {
    const decision = planExtra(extraRound, cur.id, g)
    if (!decision.append) return false
    setExtraRound(decision.round)
    setQueue((q) => (q ? [...q, cur] : q))
    setExtraCount((n) => n + 1)
    return true
  }

  /** 一句判定提示，过一会儿自己消失（`ms` 到点清空）。 */
  const showGradeInfo = useCallback((text: string, ms = 1600) => {
    setGradeInfo(text)
    window.setTimeout(() => setGradeInfo(''), ms)
  }, [])

  /**
   * 正常评分：写 SRS（`learnPass` 决定要不要顺手记「这次没看答案就选对了」——
   * 两次 persist 会互相覆盖，所以必须一次算完）。
   */
  const recordGrade = useCallback(
    (g: ReviewGrade, queuedItem: VocabItem, learnPass?: boolean) => {
      const cur = library.items.find((it) => it.id === queuedItem.id) ?? queuedItem
      const reviewed = reviewItem(library, cur.id, g)
      const nextLibrary = learnPass == null ? reviewed : recordLearnPass(reviewed, cur.id, learnPass)
      persist(nextLibrary)
      bumpIfFirstNew(cur)
      const nextState = nextLibrary.items.find((it) => it.id === cur.id)?.reviewState
      if (nextState) {
        const label: Record<ReviewGrade, string> = {
          again: '忘记了',
          hard: '模糊',
          good: '认识',
          easy: '认识',
        }
        showGradeInfo(`${label[g]} · 下次复习：${fmtInterval(nextState.interval)}`)
      }
      tally(g === 'again' ? 'forgot' : g === 'hard' ? 'fuzzy' : 'know', cur.id)
      if (g === 'again') noteForgot(cur.id)
      if (g === 'again' || g === 'hard') requeue(cur, g)
    },
    // 全部依赖都是外部注入的稳定引用或本轮状态，跟原来的 applyGrade 一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, extraRound, persist, onBumpNewToday, addStudyTime, markStudied, recordActivity, showGradeInfo],
  )

  /**
   * 拼写判错：立刻按「忘记」写 SRS（`relearn` +1，进入重学）并打「不认识」标签，
   * 本轮重排到队尾。返回是否真的进了队尾（受每卡 3 次上限约束）。
   */
  const recordSpellingMiss = useCallback(
    (cur: VocabItem): boolean => {
      persist(markSpellingMiss(library, cur.id))
      bumpIfFirstNew(cur)
      tally('forgot', cur.id)
      noteForgot(cur.id)
      return requeue(cur, 'again')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, extraRound, persist, onBumpNewToday, addStudyTime, markStudied, recordActivity],
  )

  /**
   * 组末拼写测试里拼错：判定已经在测试里的那一刻定了（again + 重学 + 标签），
   * 这里是验收，不再本轮重排 —— 所以只写库 + 记账，不 requeue。
   */
  const recordRoundTestMiss = useCallback(
    (item: VocabItem) => {
      persist(markSpellingMiss(library, item.id))
      tally('forgot', item.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, persist, addStudyTime, markStudied, recordActivity],
  )

  /**
   * 「不认识」：安排复习（按「忘记」重置，比模糊更狠）+ 打标签；**本轮不重排**，
   * 不增加本轮总数。
   */
  const recordUnknown = useCallback(
    (queuedItem: VocabItem) => {
      const cur = library.items.find((it) => it.id === queuedItem.id) ?? queuedItem
      const reviewed = reviewItem(library, cur.id, 'again')
      persist({
        ...reviewed,
        items: reviewed.items.map((it) =>
          it.id === cur.id && !it.tags.includes('不认识')
            ? { ...it, tags: [...it.tags, '不认识'] }
            : it,
        ),
      })
      noteForgot(cur.id)
      tally('forgot', cur.id)
      showGradeInfo('已标为「不认识」· 已从零重学')
      flash('已标为「不认识」的全新词，已安排重学')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, persist, addStudyTime, markStudied, recordActivity, flash, showGradeInfo],
  )

  /** 本轮点过「忘记了」的词 id（收尾重练用；返回的是账本快照，外部别改）。 */
  const getForgotIds = useCallback(() => forgotRef.current, [])

  /**
   * 账本归零：开新一轮、重练忘记的词时用。
   * 不动 `extraRound`（那是会话的加练账本，由调用方按需重置）。
   */
  const resetLedger = useCallback(() => {
    forgotRef.current = []
    bumpedRef.current = new Set()
    setForgotCount(0)
    setExtraCount(0)
    setCounts({ know: 0, fuzzy: 0, forgot: 0 })
  }, [])

  return {
    counts,
    forgotCount,
    extraCount,
    gradeInfo,
    showGradeInfo,
    getForgotIds,
    recordGrade,
    recordSpellingMiss,
    recordRoundTestMiss,
    recordUnknown,
    resetLedger,
  }
}
