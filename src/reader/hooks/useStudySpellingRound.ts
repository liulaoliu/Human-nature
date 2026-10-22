import { useCallback, useRef, useState } from 'react'
import type { VocabItem } from '../../types/document'
import { displayMeaning, spellingMatches } from '../../core/vocab'

/**
 * 组末拼写测试的状态机（从 `useStudySession` 拆出来）。
 *
 * 学习模式学到「每组 N 词」的组末，停下来把**本组全部词**挨个拼一遍
 * （Spec 2026-10-22：学了多少拼多少，不封顶）：
 *   - 拼对 → 下一词；
 *   - 拼错 → 判「不认识」并落库（主 hook 回调 `onMiss`），**显示英文原文**，
 *     用户照着再打一遍——一开始输入原文就消失（靠「输入为空才显示原文」实现），
 *     打对才放行。判定在拼错那一刻已经定了，重打只是为了把这个词过一遍手，
 *     不会因为打对了改判。
 *
 * 全部拼完回调 `onDone`（主 hook 把 index 推进到组末之后 / 收尾）。
 */

export interface SpellingRoundMiss {
  /** 拼错那一次写的内容 */
  typed: string
  word: string
  meaning: string | null
}

export interface SpellingRoundTest {
  index: number
  total: number
}

export interface UseStudySpellingRoundParams {
  /** 拼错：判「不认识」并落库（主 hook 做，含计时 / 活动记录）。 */
  onMiss: (item: VocabItem) => void
  /** 本组全部拼完。 */
  onDone: () => void
}

export interface StudySpellingRound {
  /** 非空 = 正在组末拼写测试（当前词由主 hook 把 `card` 换成测试里的词）。 */
  test: SpellingRoundTest | null
  /** 当前词；不在测试中时是 null。 */
  card: VocabItem | null
  /** 输入框内容（与卡片模式共用一个「输入后原文消失」的行为，见组件）。 */
  input: string
  /** 拼错的卡：非空时显示原文（input 为空时）并要求重打。 */
  miss: SpellingRoundMiss | null
  begin: (words: VocabItem[]) => void
  setInput: (v: string) => void
  /** 回车 / 点「检查」：对 → 下一词；错 → 落库并进入「重打」状态。 */
  check: () => void
  /** 整轮结束（换轮 / 退出）时清干净。 */
  reset: () => void
}

export function useStudySpellingRound(params: UseStudySpellingRoundParams): StudySpellingRound {
  const missRef = useRef(params.onMiss)
  const doneRef = useRef(params.onDone)
  missRef.current = params.onMiss
  doneRef.current = params.onDone

  const [words, setWords] = useState<VocabItem[]>([])
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [miss, setMiss] = useState<SpellingRoundMiss | null>(null)

  const test: SpellingRoundTest | null = words.length > 0 ? { index, total: words.length } : null
  const card = words[index] ?? null

  const reset = useCallback(() => {
    setWords([])
    setIndex(0)
    setInput('')
    setMiss(null)
  }, [])

  const begin = useCallback((list: VocabItem[]) => {
    setWords(list)
    setIndex(0)
    setInput('')
    setMiss(null)
  }, [])

  const advance = useCallback(() => {
    setInput('')
    setMiss(null)
    const next = index + 1
    // 不能在 setState 的 updater 里再 setState / 回调 onDone（React 不允许渲染期嵌套更新）：
    // 先用当前 index 算好下一步，再分头更新，最后才回调主 hook 推进。
    if (next >= words.length) {
      setWords([])
      setIndex(0)
      doneRef.current()
    } else {
      setIndex(next)
    }
  }, [index, words.length])

  const check = useCallback(() => {
    if (!card || words.length === 0) return
    if (miss) {
      // 重打：判定已定，打对只是放行；再错就清空输入让原文重新显示出来
      if (spellingMatches(input, card.word)) advance()
      else {
        setMiss({ ...miss, typed: input })
        setInput('')
      }
      return
    }
    if (spellingMatches(input, card.word)) {
      advance()
      return
    }
    missRef.current(card)
    setMiss({ typed: input, word: card.word, meaning: displayMeaning(card) })
    setInput('')
  }, [card, words.length, miss, input, advance])

  return { test, card, input, miss, begin, setInput, check, reset }
}
