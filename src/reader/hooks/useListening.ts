import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildListeningQuizPrompt,
  gradeListening,
  isListeningCorrect,
  type ListeningQuestion,
  type ListeningQuiz,
  type ListeningResult,
} from '../../core/listening'
import { listenMistake } from '../../core/mistakes'
import type { MistakeEntry } from '../../core/mistakes'
import { useLocalStorageState, persistentNumber } from './useLocalStorageState'

export interface UseListeningParams {
  doc: { sentences: { id: string; text: string }[] } | null
  articleIdentity: string
  flash: (message: string) => void
  setLastTask: (task: 'listening') => void
  askedWordsRef: { current: string[] }
  askedIdsRef: { current: string[] }
  recordActivity: (cat: 'listen', n?: number) => void
  recordPractice: (kind: 'listening', total: number, correct: number) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  /** 打开听力题时关掉其它会话。 */
  closeOthers: () => void
}

/**
 * 听力理解题：AI 出题（复制提示词）+ 本地判分 + 错题重做 + 每篇持久化。
 */
export function useListening({
  doc,
  articleIdentity,
  flash,
  setLastTask,
  askedWordsRef,
  askedIdsRef,
  recordActivity,
  recordPractice,
  addMistake,
  dropMistake,
  closeOthers,
}: UseListeningParams) {
  const [quiz, setQuiz] = useState<ListeningQuiz | null>(null)
  const [open, setOpen] = useState(false)
  const [wrongIds, setWrongIds] = useState<string[] | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<ListeningResult | null>(null)
  const [count, setCount] = useLocalStorageState('reader:listenCount', 8, persistentNumber)

  /** 当前要作答的题（「重做错题」时只含错题）。 */
  const questions = useMemo(() => {
    if (!quiz) return []
    if (!wrongIds) return quiz.questions
    const set = new Set(wrongIds)
    return quiz.questions.filter((q) => set.has(q.id))
  }, [quiz, wrongIds])

  const copyPrompt = useCallback(async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    setLastTask('listening')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildListeningQuizPrompt(doc.sentences.map((s) => s.text).join(' '), { count }),
      )
      flash('已复制听力理解题提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [doc, count, flash, setLastTask, askedWordsRef, askedIdsRef])

  /** 打开听力理解题：没有题目就先复制出题提示词。 */
  const start = useCallback(() => {
    if (quiz && quiz.questions.length) {
      closeOthers()
      setAnswers({})
      setSubmitted(false)
      setResult(null)
      setWrongIds(null)
      setOpen(true)
    } else {
      void copyPrompt()
    }
  }, [quiz, closeOthers, copyPrompt])

  /** 用指定题目开一轮（错题本「重练听力」用）。 */
  const startQuestions = useCallback(
    (qs: ListeningQuestion[]) => {
      if (!qs.length) return
      closeOthers()
      setQuiz({ questions: qs })
      setWrongIds(null)
      setAnswers({})
      setSubmitted(false)
      setResult(null)
      setOpen(true)
    },
    [closeOthers],
  )

  const submit = useCallback(() => {
    if (!questions.length) return
    const res = gradeListening(questions, answers)
    setResult(res)
    setSubmitted(true)
    recordActivity('listen', questions.length)
    recordPractice('listening', res.total, res.correct)
    // 错题本：听力错题（对→清掉，错→记上）
    for (const q of questions) {
      const id = listenMistake(articleIdentity, q, '').id
      if (isListeningCorrect(q, answers[q.id] ?? '')) dropMistake(id)
      else addMistake(listenMistake(articleIdentity, q, new Date().toISOString()))
    }
  }, [questions, answers, recordActivity, recordPractice, articleIdentity, addMistake, dropMistake])

  /** 只重做错题。 */
  const retryWrong = useCallback(() => {
    if (!result) return
    const ids = result.per.filter((p) => !p.correct).map((p) => p.id)
    if (!ids.length) return
    setWrongIds(ids)
    setAnswers({})
    setSubmitted(false)
    setResult(null)
  }, [result])

  /** 恢复全部题。 */
  const showAll = useCallback(() => {
    setWrongIds(null)
    setAnswers({})
    setSubmitted(false)
    setResult(null)
  }, [])

  // 换文章时载入该篇已生成的听力理解题，并重置作答
  useEffect(() => {
    try {
      const raw = localStorage.getItem('reader:listening:' + articleIdentity)
      setQuiz(raw ? (JSON.parse(raw) as ListeningQuiz) : null)
    } catch {
      setQuiz(null)
    }
    setOpen(false)
    setAnswers({})
    setSubmitted(false)
    setResult(null)
  }, [articleIdentity])

  return {
    quiz,
    setQuiz,
    open,
    setOpen,
    questions,
    answers,
    setAnswers,
    submitted,
    result,
    wrongIds,
    count,
    setCount,
    copyPrompt,
    start,
    startQuestions,
    submit,
    retryWrong,
    showAll,
  }
}
