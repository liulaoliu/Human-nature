import { useCallback } from 'react'
import { buildSiege } from '../../core/siege'
import type { ListeningQuestion } from '../../core/listening'
import type { MistakeEntry } from '../../core/mistakes'
import type { VocabItem } from '../../types/document'
import type { QuizKind } from '../../core/quiz'

export interface UseMistakeActionsParams {
  mistakes: MistakeEntry[]
  /** 全库词条（包围战按错题 / lapses / 优先从里面挑） */
  libraryItems: VocabItem[]
  startQuizItems: (ids: string[], kinds?: QuizKind[]) => void
  startListenQuestions: (questions: ListeningQuestion[]) => void
  startDictItems: (items: { id: string; text: string }[]) => void
  setIntensiveOpen: (open: boolean) => void
  setQuizLoopWrong: (on: boolean) => void
  setQuizScope: (scope: 'lapses') => void
  flash: (message: string) => void
}

export interface UseMistakeActionsResult {
  retryMistakeVocab: () => void
  retryMistakeListen: () => void
  retryMistakeDict: () => void
  startSiege: () => void
}

/**
 * 错题本上的动作：三类「重练」+ 错题包围战。
 * 只负责从错题里挑出该练的东西、调对应会话的 start；会话状态仍归各自 hook。
 */
export function useMistakeActions({
  mistakes,
  libraryItems,
  startQuizItems,
  startListenQuestions,
  startDictItems,
  setIntensiveOpen,
  setQuizLoopWrong,
  setQuizScope,
  flash,
}: UseMistakeActionsParams): UseMistakeActionsResult {
  /** 错题本：重练考试错词。 */
  const retryMistakeVocab = useCallback(() => {
    const ids = mistakes.filter((m) => m.kind === 'vocab' && m.itemId).map((m) => m.itemId as string)
    if (!ids.length) {
      flash('没有考试错词')
      return
    }
    startQuizItems(ids)
  }, [mistakes, startQuizItems, flash])

  /** 错题本：重练听力错题。 */
  const retryMistakeListen = useCallback(() => {
    const qs = mistakes.filter((m) => m.kind === 'listen' && m.question).map((m) => m.question as ListeningQuestion)
    if (!qs.length) {
      flash('没有听力错题')
      return
    }
    startListenQuestions(qs)
  }, [mistakes, startListenQuestions, flash])

  /** 错题本：重练听写漏词。 */
  const retryMistakeDict = useCallback(() => {
    const items = mistakes
      .filter((m) => m.kind === 'dict' && m.text)
      .map((m, i) => ({ id: `mk-${i}`, text: m.text as string }))
    if (!items.length) {
      flash('没有听写漏词')
      return
    }
    startDictItems(items)
  }, [mistakes, startDictItems, flash])

  /** 错题包围战：错题 + 优先重排 + 常错 + 学不稳 一起围剿，打到全对。 */
  const startSiege = useCallback(() => {
    const picked = buildSiege(libraryItems, mistakes, { scope: 'all', limit: 40 })
    if (!picked.length) {
      flash('错题本是空的 —— 先做几轮「考试 / 拷打」攒点错题吧')
      return
    }
    setIntensiveOpen(false)
    setQuizLoopWrong(true)
    setQuizScope('lapses')
    startQuizItems(
      picked.map((x) => x.item.id),
      ['spell', 'meaning', 'choice', 'usage', 'collocation', 'prep', 'idiom', 'cloze'],
    )
    flash(`错题包围战：${picked.length} 个欠揍的词，打到全对`)
  }, [libraryItems, mistakes, startQuizItems, setIntensiveOpen, setQuizLoopWrong, setQuizScope, flash])

  return { retryMistakeVocab, retryMistakeListen, retryMistakeDict, startSiege }
}
