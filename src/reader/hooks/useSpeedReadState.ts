import { useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import { readNum } from '../storage'
import {
  DEFAULT_WPM,
  contentWords,
  speedCursorKey,
  summarize,
  targetMs,
  wordCount,
  type SpeedReadDrill,
  type SpeedRow,
} from '../../core/speedRead'
import { persistentBoolTrue, persistentNumber, useLocalStorageState } from './useLocalStorageState'
import type { SpeedReadPhase as Phase } from '../panels/SpeedReadSentence'

export interface UseSpeedReadStateOptions {
  sentences: Sentence[]
  /** 文章键（`core/docSignature.articleKey`：标识 + 正文签名），由面板算好传入。 */
  docKey: string
  /** 这篇过完（推到结尾）时回调一次（「读完」目标记一笔）。 */
  onFinishRead?: () => void
}

/**
 * 速读的「状态与计时」：偏好、游标、阶段、本轮成绩、当前句与派生。
 * 动作（读→揭示→拷打→下一句、翻句、重开）在 `useSpeedReadFlow`。
 */
export function useSpeedReadState({ sentences, docKey, onFinishRead }: UseSpeedReadStateOptions) {
  const n = sentences.length
  const [wpm, setWpm] = useLocalStorageState('reader:speedWpm', DEFAULT_WPM, persistentNumber)
  const [autoDrill, setAutoDrill] = useLocalStorageState('reader:speedAutoDrill', true, persistentBoolTrue)
  /**
   * 游标键 = articleKey（标识 + 正文签名）：标识相同的两篇文章（空标题 / 同名 / 「未命名」）
   * 也不会共用进度，正文改过就从第一句重来。
   */
  const key = useMemo(() => speedCursorKey(docKey), [docKey])
  const [index, setIndex] = useState(() => Math.min(readNum(key, 0), Math.max(0, n - 1)))
  const [phase, setPhase] = useState<Phase>('read')
  const [elapsed, setElapsed] = useState(0)
  const [readMs, setReadMs] = useState(0)
  const [slow, setSlow] = useState(false)
  const [drill, setDrill] = useState<SpeedReadDrill | null>(null)
  const [picked, setPicked] = useState('')
  const [drillOk, setDrillOk] = useState<boolean | null>(null)
  const [rows, setRows] = useState<SpeedRow[]>([])
  const t0 = useRef(0)
  /** 拷打答对后自动下一句的定时器。 */
  const drillTimerRef = useRef<number | null>(null)

  const sentence = sentences[index] as Sentence | undefined
  const done = index >= n

  /** 这篇过完（推到结尾）→ 回调一次，用于「目标备忘 · 今日读文」记账。 */
  const finishedRef = useRef(false)
  useEffect(() => {
    if (!done) {
      finishedRef.current = false
      return
    }
    if (finishedRef.current) return
    finishedRef.current = true
    onFinishRead?.()
  }, [done, onFinishRead])

  const target = sentence ? targetMs(sentence.text, wpm) : 0
  const words = sentence ? wordCount(sentence.text) : 0
  const summary = useMemo(() => summarize(rows), [rows])
  /** 干扰项池：整篇实词，选最像的做选项。 */
  const pool = useMemo(() => [...new Set(sentences.flatMap((s) => contentWords(s.text)))], [sentences])

  /**
   * 换到另一篇（面板没关就换了文章 / 正文被编辑过）：把成绩清掉，
   * 游标回到那篇自己的位置——否则上一篇的「第 N 句」会跟着带到新文章上。
   */
  const keyRef = useRef(key)
  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    if (drillTimerRef.current != null) {
      window.clearTimeout(drillTimerRef.current)
      drillTimerRef.current = null
    }
    setRows([])
    setIndex(Math.min(readNum(key, 0), Math.max(0, n - 1)))
    setPhase('read')
    setDrill(null)
    setPicked('')
    setDrillOk(null)
    setReadMs(0)
    setSlow(false)
  }, [key, n])

  useEffect(() => {
    if (phase !== 'read' || done) return
    t0.current = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => setElapsed(Date.now() - t0.current), 250)
    return () => window.clearInterval(id)
  }, [phase, index, done])

  // 卸载时清掉自动下一句的定时器
  useEffect(() => {
    return () => {
      if (drillTimerRef.current != null) window.clearTimeout(drillTimerRef.current)
    }
  }, [])

  const pace = target > 0 ? Math.min(100, Math.round((elapsed / target) * 100)) : 0
  const over = elapsed > target

  return {
    api: {
      n,
      wpm,
      setWpm,
      autoDrill,
      setAutoDrill,
      index,
      phase,
      elapsed,
      readMs,
      slow,
      drill,
      picked,
      drillOk,
      summary,
      sentence,
      done,
      target,
      words,
      pace,
      over,
    },
    internals: {
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
    },
  }
}

export type SpeedReadState = ReturnType<typeof useSpeedReadState>
