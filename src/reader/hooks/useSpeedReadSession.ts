import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import { readNum, writeNum } from '../storage'
import { useHotkeys } from '../useHotkeys'
import {
  DEFAULT_WPM,
  checkDrill,
  contentWords,
  pickDrill,
  speedCursorKey,
  summarize,
  targetMs,
  wordCount,
  type SpeedReadDrill,
  type SpeedRow,
} from '../../core/speedRead'
import { persistentBoolTrue, persistentNumber, useLocalStorageState } from './useLocalStorageState'
import type { SpeedReadPhase as Phase } from '../panels/SpeedReadSentence'

export interface UseSpeedReadSessionOptions {
  sentences: Sentence[]
  /** 文章键（`core/docSignature.articleKey`：标识 + 正文签名），由面板算好传入。 */
  docKey: string
  onClose: () => void
  /** 这篇过完（推到结尾）时回调一次（「读完」目标记一笔）。 */
  onFinishRead?: () => void
  /** 朗读一句（R 键，与面板里的「读本句」共用）。 */
  onSpeak?: (text: string) => void
  /** 语言点编辑器打开时不抢键盘。 */
  langEditorOpen: boolean
}

/**
 * 速读会话状态机：逐句计时 → 揭示 → 超时拷打 → 下一句，以及翻句 / 结算 / 快捷键。
 * 只关心「读到哪、处于哪个阶段」，选词与渲染分别在 `useSpeedReadWords` 和面板里。
 */
export function useSpeedReadSession({
  sentences,
  docKey,
  onClose,
  onFinishRead,
  onSpeak,
  langEditorOpen,
}: UseSpeedReadSessionOptions) {
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
    const id = window.setInterval(() => setElapsed(Date.now() - t0.current), 100)
    return () => window.clearInterval(id)
  }, [phase, index, done])

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
    [sentence, words, readMs, elapsed, slow, index, n, key],
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
  }, [done, sentence, phase, elapsed, target, slow, autoDrill, drill, drillOk, pool, finish])

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
    [index, n, key],
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
    [phase, drill, finish],
  )

  // 卸载时清掉自动下一句的定时器
  useEffect(() => {
    return () => {
      if (drillTimerRef.current != null) window.clearTimeout(drillTimerRef.current)
    }
  }, [])

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

  useHotkeys(
    (e) => {
      // 正在输入框里打字时，不要触发空格翻页 / 数字选项
      const el = e.target as HTMLElement | null
      if (langEditorOpen) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'r' && sentence && onSpeak) {
        e.preventDefault()
        onSpeak(sentence.text)
        return
      }
      if (k === 'w' || k === 'a') {
        e.preventDefault()
        go(-1)
        return
      }
      if (k === 'd') {
        e.preventDefault()
        go(1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (phase === 'drill' && drill) {
        const k = Number(e.key)
        if (k >= 1 && k <= drill.options.length) {
          e.preventDefault()
          chooseDrill(drill.options[k - 1])
          return
        }
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        advance()
      }
    },
    !langEditorOpen,
    25,
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
  }, [key])

  const pace = target > 0 ? Math.min(100, Math.round((elapsed / target) * 100)) : 0
  const over = elapsed > target

  return {
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
    advance,
    go,
    chooseDrill,
    restart,
    close,
  }
}
