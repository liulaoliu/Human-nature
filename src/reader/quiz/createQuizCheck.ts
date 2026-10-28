import { isCorrect, type QuizQuestion } from '../../core/quiz'
import { markSpellingMiss, nextDayIso, prioritizeItems, reviewItem } from '../../core/vocab'
import { vocabMistake, type MistakeEntry } from '../../core/mistakes'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { QuizResultRow } from '../../core/sessionSnapshots'
import type { VocabLibrary } from '../../types/document'

/** 拼写题拼错后的判定提示（非空时锁住下一题 / 退出）。 */
export interface QuizSpellMiss {
  itemId: string
  word: string
  input: string
}

export interface QuizCheckParams {
  queue: QuizQuestion[] | null
  index: number
  checked: boolean
  input: string
  library: VocabLibrary
  articleIdentity: string
  autoRun: boolean
  speakAfter: boolean
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordAnswer?: (event: AnswerEventInput) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  speak: (text: string) => void
  scheduleAdvance: (delay: number) => void
  setChecked: (value: boolean) => void
  setResult: (value: boolean | null) => void
  setResults: (updater: (prev: QuizResultRow[]) => QuizResultRow[]) => void
  setSpellMiss: (value: QuizSpellMiss | null) => void
}

/**
 * 判分：对 → SRS good，错 → SRS again（记 lapse），并同步错题本 / 活动 / 答题事件。
 *
 * 没有 React 状态，做成 factory；主 hook 每轮渲染把最新快照传进来，事件处理拿到的
 * 永远是当前题（和 `useCallback` 的依赖数组等价，但不用维护一长串 deps）。
 */
export function createQuizCheck(params: QuizCheckParams): (answerOverride?: string) => void {
  const {
    queue,
    index,
    checked,
    input,
    library,
    articleIdentity,
    autoRun,
    speakAfter,
    persist,
    markStudied,
    recordActivity,
    recordAnswer,
    addMistake,
    dropMistake,
    speak,
    scheduleAdvance,
    setChecked,
    setResult,
    setResults,
    setSpellMiss,
  } = params

  return (answerOverride?: string) => {
    if (!queue) return
    const q = queue[index]
    if (!q || checked) return
    const ans = answerOverride ?? input
    const ok = isCorrect(q, ans)
    setChecked(true)
    setResult(ok)
    setResults((r) => [...r, { id: q.id, itemId: q.itemId, correct: ok }])
    const isArticle = q.source === 'article'
    // 拼写错 = 不认识：SRS again + 「不认识」标签 + 进入重学（不是普通错题）
    const spellingKind = q.kind === 'spell' || q.kind === 'ear' || q.kind === 'define'
    // 文章题不写 SRS / 错题本（那是词级的）
    if (!isArticle) {
      if (ok) dropMistake(`vocab:${q.itemId}`)
      else addMistake(vocabMistake(q.itemId, q.word, new Date().toISOString()))
      // 拼写错 = 不认识：SRS again + 「不认识」标签 + 进入重学（不是普通错题）
      const reviewed =
        !ok && spellingKind
          ? markSpellingMiss(library, q.itemId)
          : reviewItem(library, q.itemId, ok ? 'good' : 'again')
      persist(ok ? reviewed : prioritizeItems(reviewed, [q.itemId], nextDayIso()))
      markStudied(q.itemId)
    }
    // 拼写错：锁在本题，必须确认（可立即重学，或继续考但该词已排队重学）
    if (!ok && spellingKind && !isArticle) {
      setSpellMiss({ itemId: q.itemId, word: q.word, input: ans })
    }
    const cat: ActivityCat = isArticle ? 'read' : q.kind === 'listen' || q.kind === 'ear' ? 'listen' : 'vocab'
    recordActivity(cat, 1)
    recordAnswer?.({
      articleId: articleIdentity,
      source: 'quiz',
      kind: q.kind,
      cat,
      correct: ok,
      questionId: q.id,
    })
    // 答完朗读一下（看词选义读英文单词；其余读答案词形）
    if (speakAfter) speak(q.kind === 'meaning' ? q.word : q.answer)
    // 开了「自动下一题」：答对快切、答错稍停（看答案）后自动切；拼写错必须先确认
    if (autoRun && !(!ok && spellingKind && !isArticle)) scheduleAdvance(ok ? 650 : 1400)
  }
}
