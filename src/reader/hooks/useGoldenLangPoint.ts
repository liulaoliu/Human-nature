import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { Sentence } from '../../types/document'
import {
  defaultLangPoint,
  doneLangPoints,
  langPointChoices,
  type LangPointChoice,
} from '../../core/goldenLangPoint'
import { buildLangPointItem } from '../../core/goldenExam'
import { useGoldenImitation, type GoldenImitationApi } from './useGoldenImitation'
import type { WritingRecord } from '../../core/writing'
import type { ActivityCat } from '../../core/activity'

export interface UseGoldenLangPointParams {
  /** 当前句（D老师小课堂走到哪句就是哪句）；没有就不出题 */
  sentence: Sentence | null
  articleId: string
  articleTitle: string
  /** 已练过的记录：用来给选项打 ✓，也用来默认挑第一个没练过的 */
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}

export interface GoldenLangPointApi {
  /** 本句可单练的词块（phrases / idioms） */
  choices: LangPointChoice[]
  /** 当前选中的词块英文（可能为 null：本句没有语言点） */
  active: string | null
  select: (en: string) => void
  /** 批改链路（和单句仿写同一个 hook，记录 source 也是 goldenSentence） */
  imitation: GoldenImitationApi
}

const EMPTY = new Set<string>()

/**
 * 「语言点造句」：在整句仿写之外，单独练本句的一个词块。
 *
 * 与整句仿写的区别只在题面：这里 `mustUse` 只有一个 focus，评分也更看重词块用得对不对。
 * 记录仍然进 `writingHistory`（source = goldenSentence + sentenceId + task.focus），
 * **不写** `golden_drill_records`：句子的掌握进度只认原有的仿写，语言点练不练不影响流程。
 */
export function useGoldenLangPoint({
  sentence,
  articleId,
  articleTitle,
  writingHistory,
  setWritingHistory,
  flash,
  recordActivity,
}: UseGoldenLangPointParams): GoldenLangPointApi {
  const done = useMemo(
    () => (sentence ? doneLangPoints(writingHistory, articleId, sentence.id) : EMPTY),
    [writingHistory, articleId, sentence],
  )
  const choices = useMemo(() => langPointChoices(sentence, done), [sentence, done])

  const [picked, setPicked] = useState<string | null>(null)
  // 换句就回到默认（第一个没练过的）
  useEffect(() => {
    setPicked(null)
  }, [sentence?.id])

  const fallback = defaultLangPoint(choices)
  const active = picked && choices.some((c) => c.en === picked) ? picked : fallback

  const item = useMemo(() => {
    if (!sentence || !active) return null
    const point = choices.find((c) => c.en === active) ?? { en: active }
    return buildLangPointItem({ id: sentence.id, text: sentence.text }, point)
  }, [sentence, active, choices])

  const imitation = useGoldenImitation({
    current: item,
    articleId,
    articleTitle,
    source: 'goldenSentence',
    setWritingHistory,
    flash,
    recordActivity,
  })

  const select = useCallback((en: string) => setPicked(en), [])

  return { choices, active, select, imitation }
}
