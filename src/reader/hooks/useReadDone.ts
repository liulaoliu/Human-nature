import { useCallback, useMemo } from 'react'
import { addReadDone, readDayOf, readDoneOn, removeReadDone, type ReadDone } from '../../core/goals'
import { useLocalStorageState } from './useLocalStorageState'

/**
 * 「读完一篇」的记账（目标面板/速读共用）。
 *
 * 抽成 hook 的原因：这段是**接线**（localStorage + 4 个派生值 + 2 个动作），
 * 留在 ReaderApp 里既占地方又只能靠手点验证；抽出来后可以用 renderHook 直接测。
 * 规则本身（全局去重、按天分组）在 `core/goals.ts`（纯函数、已单测）。
 */
export interface UseReadDoneParams {
  /** 当前文章的稳定标识（空字符串/ null = 没有文章） */
  articleIdentity: string | null
  articleTitle: string
  /** 内置文章的键（兜底当标题用） */
  articleKey: string | null
  /** 逻辑「今天」的日期键（core/activity 的 dayKeyLocal） */
  todayKey: string
  flash: (msg: string) => void
}

export interface UseReadDoneResult {
  readDone: ReadDone[]
  /** 直接替换整份记录（导入备份时用） */
  setReadDone: (value: ReadDone[] | ((prev: ReadDone[]) => ReadDone[])) => void
  /** 今天读完的篇目（按时间） */
  todayReadDone: ReadDone[]
  /** 当前这篇**第一次**读完是哪天（没读过为 null） */
  articleReadDay: string | null
  /** 文章标识 → 第一次读完的日期键（选择器里标「✓ 已读」） */
  readDays: Record<string, string>
  /** 记一次「读完」（速读过完自动调，也可在面板手动标记） */
  markReadDone: () => void
  /** 撤销某篇的「读完」（不分哪天） */
  undoReadDone: (articleId: string) => void
}

export function useReadDone({
  articleIdentity,
  articleTitle,
  articleKey,
  todayKey,
  flash,
}: UseReadDoneParams): UseReadDoneResult {
  const [readDone, setReadDone] = useLocalStorageState<ReadDone[]>('reader:readDone', [])

  /**
   * 记「读完这篇」。**同一篇只记第一次**：已在某天读过就不再计入
   * （第二天不会又被列入，重读也不算），只给个提示。
   */
  const markReadDone = useCallback(() => {
    if (!articleIdentity) return
    const already = readDayOf(readDone, articleIdentity)
    if (already) {
      if (already !== todayKey) flash(`这篇已于 ${already} 读过，不重复计入（换一天重读也不算）`)
      return
    }
    setReadDone((prev) =>
      addReadDone(prev, {
        day: todayKey,
        articleId: articleIdentity,
        title: articleTitle || articleKey || '未命名',
        at: new Date().toISOString(),
      }),
    )
  }, [articleIdentity, articleTitle, articleKey, todayKey, setReadDone, readDone, flash])

  const todayReadDone = useMemo(() => readDoneOn(readDone, todayKey), [readDone, todayKey])
  const articleReadDay = useMemo(() => readDayOf(readDone, articleIdentity), [readDone, articleIdentity])
  const readDays = useMemo(
    () => Object.fromEntries(readDone.map((d) => [d.articleId, d.day])) as Record<string, string>,
    [readDone],
  )
  const undoReadDone = useCallback(
    (articleId: string) => setReadDone((prev) => removeReadDone(prev, articleId)),
    [setReadDone],
  )

  return { readDone, setReadDone, todayReadDone, articleReadDay, readDays, markReadDone, undoReadDone }
}
