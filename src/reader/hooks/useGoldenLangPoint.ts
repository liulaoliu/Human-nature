import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { Sentence } from '../../types/document'
import { doneLangPoints, langPointChoices, type LangPointChoice } from '../../core/goldenLangPoint'
import type { WritingRecord } from '../../core/writing'
import type { ActivityCat } from '../../core/activity'

export interface UseGoldenLangPointParams {
  /** 当前句；没有就不出题 */
  sentence: Sentence | null
  articleId: string
  articleTitle: string
  /** 全库写作历史：给选项打 ✓，也让每个作答框翻同一题的历史批改 */
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  /** 本句「加入本课」的额外语言点；只影响可选项，不改进度键 */
  extraPoints?: ReadonlyArray<{ en: string; zh?: string }>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}

/**
 * 「语言点造句」的题面 API：本句有哪些词块、勾了哪几个。
 *
 * 多选：勾几个就出几个编号输入框；每个框由 `GoldenLangPointAnswer` 自己建一份
 * 批改实例（每框一条 `writingHistory`，`task.focus` 不同）。
 * **不写** `golden_drill_records`：句子掌握进度只认原有的整句仿写。
 */
export interface GoldenLangPointApi {
  /** 本句可单练的词块（phrases / idioms） */
  choices: LangPointChoice[]
  /** 已勾选的词块英文（顺序 = 勾选顺序，编号按这个来） */
  selected: string[]
  /** 勾 / 取消勾一个词块 */
  toggle: (en: string) => void
  /** 每框都需要的上下文（子组件用它建自己的批改实例） */
  sentence: { id: string; text: string } | null
  articleId: string
  articleTitle: string
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  writingHistory: WritingRecord[]
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}

const EMPTY = new Set<string>()

export function useGoldenLangPoint({
  sentence,
  articleId,
  articleTitle,
  writingHistory,
  setWritingHistory,
  extraPoints,
  flash,
  recordActivity,
}: UseGoldenLangPointParams): GoldenLangPointApi {
  const done = useMemo(
    () => (sentence ? doneLangPoints(writingHistory, articleId, sentence.id) : EMPTY),
    [writingHistory, articleId, sentence],
  )
  const choices = useMemo(
    () => langPointChoices(sentence, done, extraPoints),
    [sentence, done, extraPoints],
  )

  const [picked, setPicked] = useState<string[]>([])
  const [pickedFor, setPickedFor] = useState<string | null>(null)
  // 换句就回到默认：**全选**（想少练就取消勾选）。
  // 渲染期重置是 React 推荐的「派生状态跟随 props」写法，比 effect 少一帧、也不会打断练完后的勾选。
  const sentenceId = sentence?.id ?? null
  if (pickedFor !== sentenceId) {
    setPickedFor(sentenceId)
    setPicked(choices.map((c) => c.en))
  }

  const selected = useMemo(
    () => picked.filter((en) => choices.some((c) => c.en === en)),
    [picked, choices],
  )

  const toggle = useCallback((en: string) => {
    setPicked((prev) => (prev.includes(en) ? prev.filter((x) => x !== en) : [...prev, en]))
  }, [])

  return {
    choices,
    selected,
    toggle,
    sentence: sentence ? { id: sentence.id, text: sentence.text } : null,
    articleId,
    articleTitle,
    setWritingHistory,
    writingHistory,
    flash,
    recordActivity,
  }
}
