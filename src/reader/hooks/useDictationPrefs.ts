import { persistentEnum, persistentNumber, useLocalStorageState } from './useLocalStorageState'

/** 听写的持久化偏好：模式 / 每句词数 / 挖空数 / 并段词数 / 每轮题量。 */
export function useDictationPrefs() {
  const [mode, setMode] = useLocalStorageState<'full' | 'cloze'>(
    'reader:dictMode',
    'full',
    persistentEnum(['full', 'cloze'] as const, 'full'),
  )
  /** 整句模式每句最多多少词。 */
  const [words, setWords] = useLocalStorageState('reader:dictWords', 12, persistentNumber)
  /** 填空模式每题挖几个空。 */
  const [blankCount, setBlankCount] = useLocalStorageState('reader:dictBlankCount', 2, persistentNumber)
  /** 填空模式每个题最多多少词（越大并得越长、题越少）。 */
  const [clozeWords, setClozeWords] = useLocalStorageState('reader:dictClozeWords', 40, persistentNumber)
  /** 每轮最多做多少题（0=不限）；做不完下次从断点继续。 */
  const [maxQuestions, setMaxQuestions] = useLocalStorageState('reader:dictMaxQuestions', 20, persistentNumber)

  return { mode, setMode, words, setWords, blankCount, setBlankCount, clozeWords, setClozeWords, maxQuestions, setMaxQuestions }
}
