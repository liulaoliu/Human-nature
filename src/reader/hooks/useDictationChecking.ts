import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  diffWords,
  dictationWrongWords,
  isClozeBlankCorrect,
  type ClozeQuestion,
} from '../../core/dictation'
import type { ActivityCat } from '../../core/activity'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { MistakeEntry } from '../../core/mistakes'
import { dictMistake } from '../../core/mistakes'
import type { DictItemData, DictSessionSnapshot } from '../../core/sessionSnapshots'
import type { BatchItemLike } from '../batchItem'

export interface UseDictationCheckingParams {
  queue: DictItemData[] | null
  index: number
  mode: 'full' | 'cloze'
  cloze: ClozeQuestion | null
  blanks: string[]
  input: string
  articleIdentity: string
  recordActivity: (cat: ActivityCat, n?: number) => void
  recordAnswer?: (event: AnswerEventInput) => void
  addMistake: (entry: MistakeEntry) => void
  dropMistake: (id: string) => void
  schedule: (ms: number, fn: () => void) => void
  next: () => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  flash: (message: string) => void
  setDiff: Dispatch<SetStateAction<DictSessionSnapshot['diff']>>
  setChecked: Dispatch<SetStateAction<boolean>>
  setResults: Dispatch<SetStateAction<boolean[]>>
  setWrongItems: Dispatch<SetStateAction<DictItemData[]>>
  setBlanks: Dispatch<SetStateAction<string[]>>
}

/** 听写判分：整句 diff / 填空对错、错题本、自动下一句、漏词加入待选。 */
export function useDictationChecking({
  queue,
  index,
  mode,
  cloze,
  blanks,
  input,
  articleIdentity,
  recordActivity,
  recordAnswer,
  addMistake,
  dropMistake,
  schedule,
  next,
  mergeBatch,
  batchItemsFromWords,
  flash,
  setDiff,
  setChecked,
  setResults,
  setWrongItems,
  setBlanks,
}: UseDictationCheckingParams) {
  const check = useCallback(() => {
    if (!queue) return
    const item = queue[index]
    if (!item) return
    let ok = false
    if (mode === 'cloze' && cloze) {
      ok = cloze.blanks.every((b, i) => isClozeBlankCorrect(b, blanks[i] ?? ''))
    } else {
      const d = diffWords(item.text, input)
      ok = d.correct
      setDiff(d.tokens)
    }
    setChecked(true)
    recordActivity('listen', 1)
    recordAnswer?.({
      articleId: articleIdentity,
      source: 'dictation',
      kind: 'dictation',
      cat: 'listen',
      correct: ok,
      questionId: item.id,
    })
    setResults((r) => [...r, ok])
    if (!ok) {
      setWrongItems((w) => (w.some((x) => x.id === item.id) ? w : [...w, { id: item.id, text: item.text }]))
    }
    // 错题本：听写漏词（对→清掉，错→记上）
    const dictId = dictMistake(item.text, '').id
    if (ok) dropMistake(dictId)
    else addMistake(dictMistake(item.text, new Date().toISOString()))
    // 全对 → 自动下一句；有错 → 停下（显示原文，等手动下一句）
    if (ok) schedule(700, next)
  }, [
    queue,
    index,
    input,
    mode,
    blanks,
    cloze,
    recordActivity,
    recordAnswer,
    articleIdentity,
    next,
    schedule,
    addMistake,
    dropMistake,
    setDiff,
    setChecked,
    setResults,
    setWrongItems,
  ])

  /** 把本句漏写 / 填错的词加入待选。 */
  const wrongNow = useCallback(() => {
    if (!queue) return
    const item = queue[index]
    if (!item) return
    let ws: string[] = []
    if (mode === 'cloze' && cloze) {
      ws = cloze.blanks.filter((b, i) => !isClozeBlankCorrect(b, blanks[i] ?? '')).map((b) => b.answer)
    } else {
      ws = dictationWrongWords(diffWords(item.text, input))
    }
    if (!ws.length) {
      flash('没有漏写 / 填错的词')
      return
    }
    mergeBatch(batchItemsFromWords(ws))
    flash(`已把 ${ws.length} 个词加入待选`)
  }, [queue, index, mode, cloze, blanks, input, mergeBatch, batchItemsFromWords, flash])

  const setBlank = useCallback(
    (i: number, value: string) => {
      setBlanks((arr) => {
        const nextArr = [...arr]
        nextArr[i] = value
        return nextArr
      })
    },
    [setBlanks],
  )

  return { check, wrongNow, setBlank }
}
