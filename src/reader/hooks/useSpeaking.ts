import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'

export interface UseSpeakingOptions {
  /** 当前文章（只用到句子列表）；没有文章时为 null。 */
  doc: { sentences: Sentence[] } | null
  selectedId: string | null
  /** 选中句子后自动朗读。 */
  autoSpeak: boolean
}

/**
 * 朗读（TTS）：单句朗读 / 逐句朗读整篇 / 选中句自动朗读。
 *
 * `speak` 身份稳定（useCallback 空依赖），所以调用方可以直接在任意位置引用，
 * 不用再靠 ref 绕「声明顺序 / TDZ」的问题。
 *
 * 抗卡死：浏览器的 speechSynthesis 偶尔会「假死」——`speaking` 一直是 true
 * 但没声音，或 `paused` 卡住。这里做了三件事：
 *   1. 不再用 `speechSynthesis.speaking` 判断是否在播（会假死），改用我们自己的
 *      `onstart/onend` 状态；点「再听一遍」一律 cancel + 重播。
 *   2. 每次朗读前先 `cancel()`，若卡在 `paused` 则 `resume()`。
 *   3. 定时看门狗唤醒卡住的 `paused`。
 */
export function useSpeaking({ doc, selectedId, autoSpeak }: UseSpeakingOptions) {
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const readAllRef = useRef(false)
  const lastSpokenRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const [readingAll, setReadingAll] = useState(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 彻底停掉并复位（含卡死的 paused 状态）。 */
  const hardStop = useCallback(() => {
    clearTimer()
    try {
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel()
        if (speechSynthesis.paused) speechSynthesis.resume()
      }
    } catch {
      // 忽略
    }
    utterRef.current = null
  }, [clearTimer])

  /** 停掉一切朗读（单句 + 整篇）。 */
  const stopReadAll = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    hardStop()
  }, [hardStop])

  /**
   * 朗读一句。**一律 cancel + 重播**：即使上一句卡死，点这里也能立刻重新出声。
   * （自动朗读的去重由调用方 / lastSpokenRef 负责，不靠这里拦截。）
   */
  const speak = useCallback(
    (text: string) => {
      readAllRef.current = false
      setReadingAll(false)
      const t = text.trim()
      if (!t || typeof speechSynthesis === 'undefined') return
      // 清掉上一拍排队中的重播，避免连点叠读
      clearTimer()
      try {
        speechSynthesis.cancel()
        if (speechSynthesis.paused) speechSynthesis.resume()
      } catch {
        // 忽略
      }
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'en-US'
      u.onend = () => {
        if (utterRef.current === u) utterRef.current = null
      }
      u.onerror = () => {
        if (utterRef.current === u) utterRef.current = null
      }
      utterRef.current = u // 持有引用，避免被 GC 导致中断/重读
      // Chrome/Edge 上 cancel() 后立刻 speak() 偶尔被吞：下一拍再 speak
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (utterRef.current !== u) return
        try {
          if (speechSynthesis.paused) speechSynthesis.resume()
          speechSynthesis.speak(u)
        } catch {
          // 忽略
        }
      }, 0)
    },
    [clearTimer],
  )

  /** 逐句朗读整篇（先停掉正在读的）。 */
  const startReadAll = useCallback(() => {
    hardStop()
    const list = doc?.sentences.filter((s) => s.text.trim()) ?? []
    if (!list.length) return
    readAllRef.current = true
    setReadingAll(true)
    let i = 0
    const next = () => {
      if (!readAllRef.current || i >= list.length) {
        stopReadAll()
        return
      }
      const s = list[i++]
      try {
        const u = new SpeechSynthesisUtterance(s.text)
        u.lang = 'en-US'
        u.rate = 0.95
        u.onend = () => next()
        u.onerror = () => next()
        utterRef.current = u
        if (speechSynthesis.paused) speechSynthesis.resume()
        speechSynthesis.speak(u)
      } catch {
        stopReadAll()
      }
    }
    next()
  }, [doc, hardStop, stopReadAll])

  /** 允许同一句再次自动朗读（重复点同一句时用）。 */
  const resetSpoken = useCallback(() => {
    lastSpokenRef.current = null
  }, [])

  // 看门狗：有些浏览器会把合成卡在 paused=true，定时唤醒一次
  useEffect(() => {
    const id = window.setInterval(() => {
      try {
        if (typeof speechSynthesis !== 'undefined' && speechSynthesis.paused) speechSynthesis.resume()
      } catch {
        // 忽略
      }
    }, 3000)
    return () => window.clearInterval(id)
  }, [])

  // 卸载时清掉定时器并停声
  useEffect(() => {
    return () => hardStop()
  }, [hardStop])

  // 选中句子后自动朗读（可选）
  useEffect(() => {
    if (!autoSpeak || !selectedId || !doc) return
    if (lastSpokenRef.current === selectedId) return
    lastSpokenRef.current = selectedId
    const s = doc.sentences.find((x) => x.id === selectedId)
    if (s && s.text.trim()) speak(s.text)
  }, [doc, selectedId, autoSpeak, speak])

  return { speak, startReadAll, stopReadAll, resetSpoken, readingAll }
}
