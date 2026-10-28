import { useCallback, useEffect, useRef } from 'react'

interface UseQuizAdvanceParams {
  /** 拼写判错未确认时不许切题。 */
  spellMiss: unknown
  setInput: (value: string) => void
  setChecked: (value: boolean) => void
  setResult: (value: boolean | null) => void
  setIndex: (updater: (i: number) => number) => void
}

/**
 * 考试的「下一题」时序：手动下一题 + 自动切题定时器。
 *
 * 抽出来是因为定时器、spellMiss 拦截、卸载清理三件事必须一起看；
 * 判分/出卷仍留在 useQuizSession。
 */
export function useQuizAdvance({ spellMiss, setInput, setChecked, setResult, setIndex }: UseQuizAdvanceParams) {
  const advanceRef = useRef<number | null>(null)

  const clearAdvance = useCallback(() => {
    if (advanceRef.current) {
      window.clearTimeout(advanceRef.current)
      advanceRef.current = null
    }
  }, [])

  /** 真正切到下一题（不再做「拼错必须先确认」的拦截）。 */
  const advance = useCallback(() => {
    clearAdvance()
    setInput('')
    setChecked(false)
    setResult(null)
    setIndex((i) => i + 1)
  }, [clearAdvance, setInput, setChecked, setResult, setIndex])

  /** 用户点「下一题」：拼错判定未确认时停在这一题。 */
  const next = useCallback(() => {
    if (spellMiss) return
    advance()
  }, [spellMiss, advance])

  /** 答完后按对错延迟自动切题；重复调用会覆盖上一个定时器。 */
  const scheduleAdvance = useCallback(
    (delay: number) => {
      clearAdvance()
      advanceRef.current = window.setTimeout(() => {
        advanceRef.current = null
        next()
      }, delay)
    },
    [clearAdvance, next],
  )

  useEffect(() => clearAdvance, [clearAdvance])

  return { clearAdvance, advance, next, scheduleAdvance }
}
