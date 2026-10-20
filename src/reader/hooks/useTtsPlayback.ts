import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import { isOfflineTtsVoice } from '../../core/ttsVoices'
import { wordSpans } from '../../core/wordSelect'
import type { WordTiming } from '../../core/ttsTiming'
import { fetchTimings, timingKey } from '../../adapters/ttsCache'

export type { WordTiming }

/** 当前正在朗读的句子：文本 + 逐词时间 + 已播到哪（毫秒）。 */
export interface NowPlaying {
  text: string
  wordTimings: WordTiming[]
  ms: number
}

/** 服务端 TTS 出错后暂时降级多久再自动重试（避免一次抖动就永久退回浏览器语音）。 */
const SERVER_RETRY_MS = 20000

export interface UseTtsPlaybackOptions {
  /** Edge TTS 音色 id（改口音就是改它）。 */
  voice: string
  /** 从服务端语音退回浏览器语音时通知（server=服务端连不上；local=本机离线语音失败；autoplay=自动播放被拦）。 */
  onFallback?: (reason: 'server' | 'local' | 'autoplay') => void
}

/**
 * 播放层：`<audio>`（服务端 Edge TTS）/ 浏览器语音兜底 / 逐词时间戳 / 单句与整篇朗读。
 *
 * 只关心「怎么出声」，不关心预热与当前文章；逐词时间戳缓存通过 `timingsCache` 暴露给预热层复用。
 * `speak` 等回调身份稳定（空依赖链），调用方可在任意位置引用。
 */
export function useTtsPlayback({ voice, onFallback }: UseTtsPlaybackOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const readAllRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  /** 每次「播/停」递增；异步回调只认最新，避免旧回调乱触发。 */
  const tokenRef = useRef(0)
  /** 服务端有错的临时降级截止时间（0 = 可用）。到点后自动重试 Edge TTS。 */
  const serverDownUntilRef = useRef(0)
  /** 当前音色（改口音即时生效，且不改变 speak 身份）。 */
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  /** 回退通知（保持稳定，用 ref 读最新）。 */
  const fallbackRef = useRef(onFallback)
  fallbackRef.current = onFallback
  /** 已取回的逐词时间戳缓存（`voice\ntext` → timings），与预热层共用同一份。 */
  const timingsCacheRef = useRef<Map<string, WordTiming[]>>(new Map())
  /** 当前播放的「到此为止」毫秒（听写整句模式下只播一个子块时用）。 */
  const stopMsRef = useRef<number | null>(null)
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

  /** 服务端 TTS 现在能不能用（出错后短暂降级）。 */
  const canUseServer = useCallback(() => Date.now() >= serverDownUntilRef.current, [])

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
    stopMsRef.current = null
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
   * `seekWordIndex` / `stopWordIndex` 给定时，按逐词时间戳从该词播到该词（点词起播 / 听写子块）；
   * 也可直接用 `seekMs` / `stopMs` 指定毫秒区间。
   */
  const playText = useCallback(
    (
      text: string,
      onEnd?: () => void,
      rate = 1,
      seekMs = 0,
      seekWordIndex?: number,
      stopWordIndex?: number,
      stopMs?: number,
    ) => {
      const t = text.trim()
      if (!t) {
        onEnd?.()
        return
      }
      stopMedia()
      setTtsState('loading')
      const tkey = timingKey(voiceRef.current, t)
      const cachedTimings = timingsCacheRef.current.get(tkey)
      // 有缓存时间戳：直接把「起 / 止」换算成毫秒；没有则等取回后按词下标换算。
      let effSeek = seekMs
      if (cachedTimings && seekWordIndex != null) effSeek = cachedTimings[seekWordIndex]?.start ?? effSeek
      stopMsRef.current =
        stopMs ?? (cachedTimings && stopWordIndex != null ? (cachedTimings[stopWordIndex]?.end ?? null) : null)
      setNowPlaying({ text: t, wordTimings: cachedTimings ?? [], ms: effSeek })
      const token = tokenRef.current

      const useBrowser = () => playBrowser(t, onEnd, rate)
      // 离线引擎也走服务端，但不能被 Edge 的临时降级连坐。
      const offline = isOfflineTtsVoice(voiceRef.current)

      if (!offline && !canUseServer()) {
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
      /** 时间戳可用（缓存或刚取回）→ 缓存、点亮高亮，必要时按词下标换算起止。 */
      const onTimings = (timings: WordTiming[]) => {
        timingsCacheRef.current.set(tkey, timings)
        if (token !== tokenRef.current) return
        setNowPlaying((np) => (np && np.text === t ? { ...np, wordTimings: timings } : np))
        if (seekWordIndex != null) {
          const ms = timings[seekWordIndex]?.start
          if (ms != null && ms > 0) {
            try {
              a.currentTime = ms / 1000
            } catch {
              // 忽略
            }
          }
        }
        if (stopWordIndex != null) {
          const end = timings[stopWordIndex]?.end
          if (end != null) stopMsRef.current = end
        }
      }
      a.onplaying = () => {
        if (token === tokenRef.current) setTtsState('playing')
      }
      a.ontimeupdate = () => {
        setMs(a.currentTime * 1000)
        const stop = stopMsRef.current
        if (stop != null && a.currentTime * 1000 >= stop) {
          stopMsRef.current = null
          try {
            a.pause()
          } catch {
            // 忽略
          }
          if (token === tokenRef.current) {
            setTtsState('idle')
            setNowPlaying(null)
            onEnd?.()
          }
        }
      }
      a.onloadedmetadata = () => {
        if (effSeek > 0) {
          try {
            a.currentTime = effSeek / 1000
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
        if (isOfflineTtsVoice(voiceRef.current)) {
          fallbackRef.current?.('local')
        } else {
          // 服务端暂时不可用：降级一段时间后自动重试 Edge（不再永久退回浏览器语音）
          const wasUp = canUseServer()
          serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
          if (wasUp) fallbackRef.current?.('server')
        }
        useBrowser()
      }
      // 逐词时间戳（服务端随音频一起生成）：有缓存直接用；没有才请求。离线引擎无时间戳，跳过。
      if (!cachedTimings && !isOfflineTtsVoice(voiceRef.current)) {
        // 空数组 / 失败 = 这次没拿到（Edge 可能降级到了本地引擎）；不缓存，之后还能再取。
        void fetchTimings(voiceRef.current, t).then((timings) => {
          if (timings) onTimings(timings)
        })
      }
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
              // 自动播放被拦：本次退回浏览器语音，但服务端仍可用（下次照旧试 Edge）
              fallbackRef.current?.('autoplay')
              useBrowser()
            } else if (isOfflineTtsVoice(voiceRef.current)) {
              fallbackRef.current?.('local')
              useBrowser()
            } else {
              const wasUp = canUseServer()
              serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
              if (wasUp) fallbackRef.current?.('server')
              useBrowser()
            }
          })
        }
      } catch {
        if (isOfflineTtsVoice(voiceRef.current)) {
          fallbackRef.current?.('local')
        } else {
          const wasUp = canUseServer()
          serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
          if (wasUp) fallbackRef.current?.('server')
        }
        useBrowser()
      }
    },
    [stopMedia, getAudio, playBrowser, canUseServer],
  )

  /** 停掉一切朗读（单句 + 整篇）。 */
  const stopReadAll = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    stopMedia()
  }, [stopMedia])

  /**
   * 一键尝试唤醒「假死」的浏览器语音，并清掉服务端临时降级（立刻重新用 Edge）。
   * 有服务端 Edge TTS 时基本用不上。
   */
  const resetSpeech = useCallback(() => {
    readAllRef.current = false
    setReadingAll(false)
    stopMedia()
    serverDownUntilRef.current = 0
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

  /** 从某个词开始朗读：优先用已缓存的时间戳同步 seek（仍在手势内，Edge 音频正常起播）。 */
  const speakFromWord = useCallback(
    (text: string, wordIndex: number) => {
      readAllRef.current = false
      setReadingAll(false)
      const t = text.trim()
      if (!t) return
      const cached = timingsCacheRef.current.get(timingKey(voiceRef.current, t))
      if (cached) {
        playText(t, undefined, 1, cached[wordIndex]?.start ?? 0)
      } else if (isOfflineTtsVoice(voiceRef.current)) {
        // 离线引擎没有逐词时间戳：截出「从这个词到句尾」直接合成，至少保证从该词起播
        const from = wordSpans(t)[wordIndex]?.start ?? 0
        playText(t.slice(from))
      } else {
        // 没时间戳：先从头播（在手势内，避免被自动播放策略拦），拿到时间戳后在 playText 里 seek
        playText(t, undefined, 1, 0, wordIndex)
      }
    },
    [playText],
  )

  /** 从整句音频里播一个「词区间」（听写整句模式）：完全复用整句缓存，零额外合成。 */
  const speakRange = useCallback(
    (text: string, startWord: number, endWord?: number) => {
      readAllRef.current = false
      setReadingAll(false)
      const t = text.trim()
      if (!t) return
      const cached = timingsCacheRef.current.get(timingKey(voiceRef.current, t))
      if (cached) {
        const s = cached[startWord]?.start ?? 0
        const e = endWord != null ? cached[endWord]?.end : undefined
        playText(t, undefined, 1, s, undefined, undefined, e)
      } else if (isOfflineTtsVoice(voiceRef.current)) {
        // 离线引擎没有时间戳：截出词区间文本直接合成（只播这一段，不会整句播完）
        const spans = wordSpans(t)
        const from = spans[startWord]?.start
        const to = endWord != null ? spans[endWord]?.end : undefined
        if (from == null) playText(t)
        else playText(t.slice(from, to))
      } else {
        // 没时间戳：先从头播（在手势内），时间戳回来后 onTimings 会 seek 并按 stopWordIndex 停
        playText(t, undefined, 1, 0, startWord, endWord)
      }
    },
    [playText],
  )

  /** 逐句朗读整篇。 */
  const startReadAll = useCallback(
    (sentences: Sentence[]) => {
      stopReadAll()
      const list = sentences.filter((s) => s.text.trim())
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
    },
    [stopReadAll, playText],
  )

  // 卸载时停声
  useEffect(() => {
    return () => stopMedia()
  }, [stopMedia])

  return {
    speak,
    speakFromWord,
    speakRange,
    startReadAll,
    stopReadAll,
    resetSpeech,
    readingAll,
    ttsState,
    nowPlaying,
    canUseServer,
    timingsCache: timingsCacheRef.current,
  }
}
