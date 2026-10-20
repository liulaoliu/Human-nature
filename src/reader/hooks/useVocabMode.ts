import { useCallback, useEffect, useRef, useState } from 'react'
import type { PickSession } from '../../core/vocabStats'

export interface UseVocabModeParams {
  /** 选词会话落盘（`useLearningData` 的 setSessions） */
  setSessions: (updater: (prev: PickSession[]) => PickSession[]) => void
}

export interface UseVocabModeResult {
  vocabMode: boolean
  /** 本次会话已计时秒数（选词模式打开时每秒刷新） */
  vocabSeconds: number
  toggleVocabMode: () => void
  /** 本次会话选了几个词（useSelection 累加） */
  sessionPickedRef: React.MutableRefObject<number>
}

/**
 * 选词模式的**会话状态机**：开关、计时、切走标签页暂停、关闭时记一条会话。
 *
 * 原来这三块（toggle + 两个 effect + 三个 ref）散在 `ReaderApp` 里，
 * `useSelection` 还要拿 `sessionPickedRef` 累加选词数；收进一个 hook 后
 * 计时语义可以单独用假计时器测。
 */
export function useVocabMode({ setSessions }: UseVocabModeParams): UseVocabModeResult {
  const [vocabMode, setVocabMode] = useState(false)
  const [vocabSeconds, setVocabSeconds] = useState(0)
  const startRef = useRef<number | null>(null)
  const accumRef = useRef(0)
  const sessionPickedRef = useRef(0)

  /** 记一次选词模式会话（sessions 落盘，最多留 500 条）。 */
  const recordSession = useCallback(
    (seconds: number, picked: number) => {
      if (seconds < 1 && picked === 0) return
      setSessions((prev) => [...prev, { at: new Date().toISOString(), seconds, picked }].slice(-500))
    },
    [setSessions],
  )

  const toggleVocabMode = useCallback(() => {
    if (vocabMode) {
      const start = startRef.current
      const seconds = Math.round(accumRef.current + (start ? (Date.now() - start) / 1000 : 0))
      recordSession(seconds, sessionPickedRef.current)
      startRef.current = null
      accumRef.current = 0
      setVocabMode(false)
    } else {
      startRef.current = Date.now()
      accumRef.current = 0
      sessionPickedRef.current = 0
      setVocabSeconds(0)
      setVocabMode(true)
    }
  }, [vocabMode, recordSession])

  // 计时：选词模式打开时每秒刷新
  useEffect(() => {
    if (!vocabMode) return
    const id = window.setInterval(() => {
      const start = startRef.current
      setVocabSeconds(Math.round(accumRef.current + (start ? (Date.now() - start) / 1000 : 0)))
    }, 1000)
    return () => window.clearInterval(id)
  }, [vocabMode])

  // 切走标签页就暂停计时（只算真正盯着读的时间）
  useEffect(() => {
    if (!vocabMode) return
    const onVis = () => {
      if (document.hidden) {
        if (startRef.current) {
          accumRef.current += (Date.now() - startRef.current) / 1000
          startRef.current = null
        }
      } else if (!startRef.current) {
        startRef.current = Date.now()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [vocabMode])

  return { vocabMode, vocabSeconds, toggleVocabMode, sessionPickedRef }
}
