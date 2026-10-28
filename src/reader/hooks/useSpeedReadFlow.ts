import { useCallback } from 'react'
import { checkDrill, pickDrill } from '../../core/speedRead'
import { writeNum } from '../storage'
import type { SpeedReadState } from './useSpeedReadState'

export interface UseSpeedReadFlowParams {
  state: SpeedReadState
  onClose: () => void
}

/**
 * 速读的动作状态机：逐句计时 → 揭示 → 超时拷打 → 下一句，以及翻句 / 重开 / 退出。
 * 状态与派生在 `useSpeedReadState`，这里只推进阶段和写游标。
 */
export function useSpeedReadFlow({ state, onClose }: UseSpeedReadFlowParams) {
  const { api, internals } = state
  const { n, index, phase, sentence, done, target, words, elapsed, readMs, slow, drill, drillOk, autoDrill } =
    api
  const {
    key,
    pool,
    setIndex,
    setPhase,
    setReadMs,
    setSlow,
    setDrill,
    setPicked,
    setDrillOk,
    setRows,
    drillTimerRef,
  } = internals

  const finish = useCallback(
    (okForDrill: boolean | null) => {
      if (drillTimerRef.current != null) {
        window.clearTimeout(drillTimerRef.current)
        drillTimerRef.current = null
      }
      if (!sentence) return
      setRows((r) => [...r, { words, ms: readMs || elapsed, slow, drillOk: okForDrill }])
      const next = index + 1
      try {
        writeNum(key, next < n ? next : 0)
      } catch {
        // 忽略
      }
      setIndex(next)
      setPhase('read')
      setReadMs(0)
      setSlow(false)
      setDrill(null)
      setPicked('')
      setDrillOk(null)
    },
    [
      sentence,
      words,
      readMs,
      elapsed,
      slow,
      index,
      n,
      key,
      setRows,
      setIndex,
      setPhase,
      setReadMs,
      setSlow,
      setDrill,
      setPicked,
      setDrillOk,
      drillTimerRef,
    ],
  )

  const advance = useCallback(() => {
    if (done || !sentence) return
    if (phase === 'read') {
      const ms = Math.max(1, elapsed)
      const isSlow = ms > target
      setReadMs(ms)
      setSlow(isSlow)
      setDrill(pickDrill(sentence, pool))
      setPicked('')
      setDrillOk(null)
      setPhase('reveal')
      return
    }
    if (phase === 'reveal') {
      if (slow && autoDrill && drill) {
        setPhase('drill')
        return
      }
      finish(null)
      return
    }
    if (phase === 'drill-answer') {
      finish(drillOk)
    }
  }, [
    done,
    sentence,
    phase,
    elapsed,
    target,
    slow,
    autoDrill,
    drill,
    drillOk,
    pool,
    finish,
    setReadMs,
    setSlow,
    setDrill,
    setPicked,
    setDrillOk,
    setPhase,
  ])

  /** 前后翻句：只移动游标、不记成绩，并把游标落盘方便续读。 */
  const go = useCallback(
    (dir: 1 | -1) => {
      if (!n) return
      const next = Math.max(0, Math.min(n - 1, index + dir))
      if (next === index) return
      if (drillTimerRef.current != null) {
        window.clearTimeout(drillTimerRef.current)
        drillTimerRef.current = null
      }
      setIndex(next)
      setPhase('read')
      setDrill(null)
      setPicked('')
      setDrillOk(null)
      setReadMs(0)
      setSlow(false)
      try {
        writeNum(key, next)
      } catch {
        // 忽略
      }
    },
    [index, n, key, drillTimerRef, setIndex, setPhase, setDrill, setPicked, setDrillOk, setReadMs, setSlow],
  )

  const chooseDrill = useCallback(
    (opt: string) => {
      if (phase !== 'drill' || !drill) return
      const ok = checkDrill(drill, opt)
      setPicked(opt)
      setDrillOk(ok)
      setPhase('drill-answer')
      // 答对 → 短停后自动下一句；答错 → 停下看答案（按空格继续）
      if (ok) {
        if (drillTimerRef.current != null) window.clearTimeout(drillTimerRef.current)
        drillTimerRef.current = window.setTimeout(() => {
          drillTimerRef.current = null
          finish(true)
        }, 650)
      }
    },
    [phase, drill, finish, drillTimerRef, setPicked, setDrillOk, setPhase],
  )

  const restart = useCallback(() => {
    setRows([])
    setIndex(0)
    setPhase('read')
    setDrill(null)
    setPicked('')
    setDrillOk(null)
    setReadMs(0)
    setSlow(false)
    try {
      writeNum(key, 0)
    } catch {
      // 忽略
    }
  }, [key, setRows, setIndex, setPhase, setDrill, setPicked, setDrillOk, setReadMs, setSlow])

  /**
   * 退出速读：已经读到（或停在）最后一句就算这篇过完了，游标清零 ——
   * 下次再进来从第一句开始，不会一开门就显示「第 N / N 句」。
   */
  const close = useCallback(() => {
    if (n > 0 && index >= n - 1) {
      try {
        writeNum(key, 0)
      } catch {
        // 忽略
      }
    }
    onClose()
  }, [index, n, key, onClose])

  return { advance, go, chooseDrill, restart, close }
}

export type SpeedReadFlowApi = ReturnType<typeof useSpeedReadFlow>
