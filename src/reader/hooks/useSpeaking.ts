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
 */
export function useSpeaking({ doc, selectedId, autoSpeak }: UseSpeakingOptions) {
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const readAllRef = useRef(false)
  const lastSpokenRef = useRef<string | null>(null)
  const [readingAll, setReadingAll] = useState(false)

  /** 停掉一切朗读（单句 + 整篇）。 */
  const stopReadAll = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    } catch {
      // 忽略
    }
  }, [])

  /** 朗读一句。同一句正在读时不重开，避免叠读。 */
  const speak = useCallback((text: string) => {
    readAllRef.current = false
    setReadingAll(false)
    try {
      if (typeof speechSynthesis === 'undefined') return
      const t = text.trim()
      if (!t) return
      if (speechSynthesis.speaking && utterRef.current && utterRef.current.text === t) return
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'en-US'
      u.onend = () => {
        if (utterRef.current === u) utterRef.current = null
      }
      utterRef.current = u // 持有引用，避免被 GC 导致中断/重读
      speechSynthesis.speak(u)
    } catch {
      // 忽略
    }
  }, [])

  /** 逐句朗读整篇（先停掉正在读的）。 */
  const startReadAll = useCallback(() => {
    stopReadAll()
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
        speechSynthesis.speak(u)
      } catch {
        stopReadAll()
      }
    }
    next()
  }, [doc, stopReadAll])

  /** 允许同一句再次自动朗读（重复点同一句时用）。 */
  const resetSpoken = useCallback(() => {
    lastSpokenRef.current = null
  }, [])

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
