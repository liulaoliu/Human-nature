import { useCallback, useEffect, useState } from 'react'
import { reviewItem, sortItems } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'

export interface UseQuickSessionParams {
  /** 快刷候选池（按当前范围）。 */
  studyPool: VocabItem[]
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  markStudied: (itemId: string) => void
  recordActivity: (cat: 'vocab', n?: number) => void
  flash: (message: string) => void
  /** 开始快刷时关掉其它会话（背单词/考试）。 */
  closeOthers: () => void
}

/** 快刷：一次一个词，1/← 不认识，2/→ 认识，空格看释义，Esc 退出。 */
export function useQuickSession({
  studyPool,
  library,
  persist,
  markStudied,
  recordActivity,
  flash,
  closeOthers,
}: UseQuickSessionParams) {
  const [queue, setQueue] = useState<VocabItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)

  const start = useCallback(() => {
    const items = sortItems(studyPool, 'due')
    if (!items.length) {
      flash('这个范围里没有词')
      return
    }
    closeOthers()
    setQueue(items)
    setIndex(0)
    setRevealed(false)
  }, [studyPool, flash, closeOthers])

  const grade = useCallback(
    (ok: boolean) => {
      if (!queue) return
      const queued = queue[index]
      const cur = queued ? (library.items.find((it) => it.id === queued.id) ?? queued) : null
      if (cur) {
        persist(reviewItem(library, cur.id, ok ? 'good' : 'again'))
        markStudied(cur.id)
        recordActivity('vocab', 1)
      }
      setRevealed(false)
      setIndex((i) => i + 1)
    },
    [queue, index, library, persist, markStudied, recordActivity],
  )

  const close = useCallback(() => setQueue(null), [])

  // 快捷键：1/← 不认识，2/→ 认识，空格看释义，Esc 退出
  useEffect(() => {
    if (!queue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (index >= queue.length) return
      if (e.key === 'ArrowLeft' || e.key === '1') {
        e.preventDefault()
        grade(false)
      } else if (e.key === 'ArrowRight' || e.key === '2') {
        e.preventDefault()
        grade(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, index, grade, close])

  return { queue, setQueue, index, revealed, setRevealed, start, grade, close }
}
