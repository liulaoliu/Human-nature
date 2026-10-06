import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import { DEFAULT_TTS_VOICE } from '../../core/ttsVoices'
import { wordSpans } from '../../core/wordSelect'

/** 一个词的音频区间（毫秒）。 */
export interface WordTiming {
  start: number
  end: number
}

/** 当前正在朗读的句子：文本 + 逐词时间 + 已播到哪（毫秒）。 */
export interface NowPlaying {
  text: string
  wordTimings: WordTiming[]
  ms: number
}

function normW(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/[^a-z0-9']/g, '')
}

/** 把服务端逐词时间戳对齐到该句的词序（供逐词高亮 / 点词跳播）。 */
function alignTimings(text: string, timings: { part?: string; start: number; end: number }[]): WordTiming[] {
  const spans = wordSpans(text)
  const out: WordTiming[] = []
  let j = 0
  for (const sp of spans) {
    const key = normW(sp.text)
    let found = -1
    for (let k = j; k < timings.length; k++) {
      if (normW(timings[k].part ?? '') === key) {
        found = k
        break
      }
    }
    const t = found >= 0 ? timings[found] : timings[j]
    if (found >= 0) j = found + 1
    else if (j < timings.length) j++
    out.push(t ? { start: t.start, end: t.end } : { start: 0, end: 0 })
  }
  return out
}

export interface UseSpeakingOptions {
  /** 当前文章（只用到句子列表）；没有文章时为 null。 */
  doc: { sentences: Sentence[] } | null
  selectedId: string | null
  /** 选中句子后自动朗读。 */
  autoSpeak: boolean
  /** Edge TTS 音色 id（改口音就是改它）。 */
  voice?: string
}

/**
 * 朗读（TTS）。**优先用服务端 Edge TTS（/api/tts）+ `<audio>` 播放**，
 * 彻底绕开浏览器 `speechSynthesis` 的假死；服务端不可用时自动退回浏览器语音。
 *
 * `speak` 身份稳定（useCallback 空依赖），调用方可在任意位置引用。
 */
export function useSpeaking({ doc, selectedId, autoSpeak, voice = DEFAULT_TTS_VOICE }: UseSpeakingOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const readAllRef = useRef(false)
  const lastSpokenRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  /** 每次「播/停」递增；异步回调只认最新，避免旧回调乱触发。 */
  const tokenRef = useRef(0)
  /** 服务端 TTS 是否可用；一旦失败（非自动播放拦截）就停用，退回浏览器语音。 */
  const serverTtsRef = useRef(true)
  /** 当前音色（改口音即时生效，且不改变 speak 身份）。 */
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const [readingAll, setReadingAll] = useState(false)
  /** 朗读状态：idle / 正在合成（首次要等网络）/ 正在出声。 */
  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing'>('idle')
  /** 正在朗读的句子（逐词高亮 / 点词跳播用）。 */
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof Audio === 'undefined') return null
    if (!audioRef.current) {
      const a = new Audio()
      a.preload = 'auto'
      audioRef.current = a
    }
    return audioRef.current
  }, [])

  /** 停掉当前一切播放（audio + 浏览器语音）+ 复位。 */
  const stopMedia = useCallback(() => {
    tokenRef.current++
    clearTimer()
    const a = audioRef.current
    if (a) {
      a.onended = null
      a.onerror = null
      a.onplaying = null
      a.ontimeupdate = null
      a.onloadedmetadata = null
      try {
        a.pause()
      } catch {
        // 忽略
      }
    }
    try {
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel()
        if (speechSynthesis.paused) speechSynthesis.resume()
      }
    } catch {
      // 忽略
    }
    utterRef.current = null
    setTtsState('idle')
    setNowPlaying(null)
  }, [clearTimer])

  /** 浏览器语音（兜底路径）。 */
  const playBrowser = useCallback((text: string, onEnd?: () => void, rate = 1) => {
    try {
      if (typeof speechSynthesis === 'undefined') {
        onEnd?.()
        return
      }
      speechSynthesis.cancel()
      if (speechSynthesis.paused) speechSynthesis.resume()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      u.rate = rate
      u.onstart = () => {
        if (utterRef.current === u) setTtsState('playing')
      }
      u.onend = () => {
        if (utterRef.current === u) {
          utterRef.current = null
          setTtsState('idle')
          onEnd?.()
        }
      }
      u.onerror = () => {
        if (utterRef.current === u) {
          utterRef.current = null
          setTtsState('idle')
          onEnd?.()
        }
      }
      utterRef.current = u
      speechSynthesis.speak(u)
    } catch {
      onEnd?.()
    }
  }, [])

  /**
   * 播一段文本：服务端 TTS 可用就用 `<audio>`，否则/失败退回浏览器语音。
   * `onEnd` 播放结束（或失败）后调用，用于整篇连播的串联。
   */
  const playText = useCallback(
    (text: string, onEnd?: () => void, rate = 1, seekMs = 0) => {
      const t = text.trim()
      if (!t) {
        onEnd?.()
        return
      }
      stopMedia()
      setTtsState('loading')
      setNowPlaying({ text: t, wordTimings: [], ms: seekMs })
      const token = tokenRef.current

      const useBrowser = () => playBrowser(t, onEnd, rate)

      if (!serverTtsRef.current) {
        useBrowser()
        return
      }

      const a = getAudio()
      if (!a) {
        useBrowser()
        return
      }
      const setMs = (ms: number) => {
        if (token === tokenRef.current) setNowPlaying((np) => (np && np.text === t ? { ...np, ms } : np))
      }
      a.onplaying = () => {
        if (token === tokenRef.current) setTtsState('playing')
      }
      a.ontimeupdate = () => setMs(a.currentTime * 1000)
      a.onloadedmetadata = () => {
        if (seekMs > 0) {
          try {
            a.currentTime = seekMs / 1000
          } catch {
            // 忽略
          }
        }
      }
      a.onended = () => {
        if (token === tokenRef.current) {
          setTtsState('idle')
          setNowPlaying(null)
          onEnd?.()
        }
      }
      a.onerror = () => {
        if (token !== tokenRef.current) return
        // 服务端没响应/不是音频 → 停用服务端，退回浏览器
        serverTtsRef.current = false
        useBrowser()
      }
      // 逐词时间戳（服务端随音频一起生成，取回即可）→ 高亮 / 点词跳播
      fetch(`/api/tts/words?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (token !== tokenRef.current || !Array.isArray(j)) return
          setNowPlaying((np) => (np && np.text === t ? { ...np, wordTimings: alignTimings(t, j) } : np))
        })
        .catch(() => {
          // 忽略：拿不到时间戳就不高亮
        })
      try {
        a.pause()
        a.src = `/api/tts?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(t)}`
        a.playbackRate = rate
        const p = a.play()
        if (p && typeof p.catch === 'function') {
          p.catch((err: unknown) => {
            if (token !== tokenRef.current) return
            const name = err instanceof DOMException ? err.name : ''
            if (name === 'NotAllowedError') {
              // 自动播放被拦：本次退回浏览器语音，但保留服务端 TTS
              useBrowser()
            } else {
              serverTtsRef.current = false
              useBrowser()
            }
          })
        }
      } catch {
        serverTtsRef.current = false
        useBrowser()
      }
    },
    [stopMedia, getAudio, playBrowser],
  )

  /** 停掉一切朗读（单句 + 整篇）。 */
  const stopReadAll = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    stopMedia()
  }, [stopMedia])

  /**
   * 一键尝试唤醒「假死」的浏览器语音，并重新允许尝试服务端 TTS。
   * 有服务端 Edge TTS 时基本用不上；没联网退回浏览器语音时才有意义。
   */
  const resetSpeech = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    stopMedia()
    serverTtsRef.current = true
    try {
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel()
        if (speechSynthesis.paused) speechSynthesis.resume()
        speechSynthesis.pause()
        speechSynthesis.resume()
        speechSynthesis.getVoices()
      }
    } catch {
      // 忽略
    }
  }, [stopMedia])

  /** 朗读一句。 */
  const speak = useCallback(
    (text: string) => {
      readAllRef.current = false
      setReadingAll(false)
      playText(text)
    },
    [playText],
  )

  /** 从某个词开始朗读：取该词音频起点，在原音频里 seek（不重新合成、不改语气）。 */
  const speakFromWord = useCallback(
    (text: string, wordIndex: number) => {
      readAllRef.current = false
      setReadingAll(false)
      const t = text.trim()
      if (!t) return
      fetch(`/api/tts/words?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const ms = Array.isArray(j) ? (alignTimings(t, j)[wordIndex]?.start ?? 0) : 0
          playText(t, undefined, 1, ms)
        })
        .catch(() => playText(t))
    },
    [playText],
  )

  /** 逐句朗读整篇。 */
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
      playText(s.text, next, 0.95)
    }
    next()
  }, [doc, stopReadAll, playText])

  /** 允许同一句再次自动朗读（重复点同一句时用）。 */
  const resetSpoken = useCallback(() => {
    lastSpokenRef.current = null
  }, [])

  // 看门狗：浏览器语音可能卡在 paused=true，定时唤醒（服务端 TTS 不受影响）
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

  // 卸载时停声
  useEffect(() => {
    return () => stopMedia()
  }, [stopMedia])

  // 选中句子后自动朗读（可选）
  useEffect(() => {
    if (!autoSpeak || !selectedId || !doc) return
    if (lastSpokenRef.current === selectedId) return
    lastSpokenRef.current = selectedId
    const s = doc.sentences.find((x) => x.id === selectedId)
    if (s && s.text.trim()) speak(s.text)
  }, [doc, selectedId, autoSpeak, speak])

  return { speak, speakFromWord, startReadAll, stopReadAll, resetSpoken, resetSpeech, readingAll, ttsState, nowPlaying }
}
