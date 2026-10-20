// ============================================================
// useQuizSettings — 考试设置（题型 / 范围 / 题量 / 切题 / 鞭打）的持久化
//
// 从 `useQuizSession` 拆出来：那边只管「一轮考试怎么跑」，设置存哪儿、坏数据怎么回
// 默认值放在这里。候选取词规则见 `core/quizPool`。
// ============================================================
import type { Dispatch, SetStateAction } from 'react'
import { useLocalStorageState, persistentBool, persistentBoolTrue, persistentEnum, persistentNumber } from './useLocalStorageState'
import { isArticleKind, isQuizKind, type QuizKind } from '../../core/quiz'
import { QUIZ_SCOPES, type QuizScope } from '../../core/quizPool'

/** 默认词级题型：拼写 / 例句填空 / 搭配填空。 */
export const DEFAULT_QUIZ_KINDS: QuizKind[] = ['spell', 'cloze', 'usage']
/** 默认文章级题型：英译中 / 中译英 / 功能词 / 排序 / 词组填空。 */
export const DEFAULT_ARTICLE_KINDS: QuizKind[] = ['translate', 'translate2', 'functionWord', 'ordering', 'phraseBlank']

/**
 * 一组题型的持久化：坏 JSON / 空数组 / 非法值一律回默认。
 * `keep` 用来再筛一层（比如文章级题型表里只能存文章级题型）。
 */
function useKinds(key: string, fallback: QuizKind[], keep: (k: QuizKind) => boolean) {
  return useLocalStorageState<QuizKind[]>(key, fallback, {
    parse: (raw) => {
      try {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          const valid = arr.filter((k) => isQuizKind(k) && keep(k))
          if (valid.length) return valid
        }
      } catch {
        // 坏 JSON：当没存过
      }
      return fallback
    },
  })
}

export interface QuizSettings {
  kinds: QuizKind[]
  setKinds: Dispatch<SetStateAction<QuizKind[]>>
  scope: QuizScope
  setScope: Dispatch<SetStateAction<QuizScope>>
  limit: number
  setLimit: Dispatch<SetStateAction<number>>
  /** 答题后自动切下一题。 */
  auto: boolean
  setAuto: Dispatch<SetStateAction<boolean>>
  /** 每个词只考一次（关掉则允许同词多题型）。 */
  unique: boolean
  setUnique: Dispatch<SetStateAction<boolean>>
  /** 判分后朗读答案。 */
  speakAfter: boolean
  setSpeakAfter: Dispatch<SetStateAction<boolean>>
  articleKinds: QuizKind[]
  setArticleKinds: Dispatch<SetStateAction<QuizKind[]>>
  /** 反复鞭打：没全对就自动重练错题。 */
  loopWrong: boolean
  setLoopWrong: Dispatch<SetStateAction<boolean>>
}

export function useQuizSettings(): QuizSettings {
  const [kinds, setKinds] = useKinds('reader:quizKinds', DEFAULT_QUIZ_KINDS, () => true)
  const [scope, setScope] = useLocalStorageState<QuizScope>(
    'reader:quizScope',
    'article',
    persistentEnum(QUIZ_SCOPES, 'article'),
  )
  const [limit, setLimit] = useLocalStorageState('reader:quizLimit', 20, persistentNumber)
  const [auto, setAuto] = useLocalStorageState('reader:quizAuto', false, persistentBool)
  const [unique, setUnique] = useLocalStorageState('reader:quizUnique', true, persistentBoolTrue)
  const [speakAfter, setSpeakAfter] = useLocalStorageState('reader:quizSpeak', true, persistentBoolTrue)
  const [articleKinds, setArticleKinds] = useKinds('reader:quizArticleKinds', DEFAULT_ARTICLE_KINDS, isArticleKind)
  const [loopWrong, setLoopWrong] = useLocalStorageState('reader:quizLoopWrong', false, persistentBool)

  return {
    kinds,
    setKinds,
    scope,
    setScope,
    limit,
    setLimit,
    auto,
    setAuto,
    unique,
    setUnique,
    speakAfter,
    setSpeakAfter,
    articleKinds,
    setArticleKinds,
    loopWrong,
    setLoopWrong,
  }
}
