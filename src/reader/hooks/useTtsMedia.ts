import { useCallback, useEffect, useRef, useState } from 'react'
import { isOfflineTtsVoice } from '../../core/ttsVoices'
import type { WordTiming } from '../../core/ttsTiming'
import { fetchTimings, timingKey } from '../../adapters/ttsCache'
import { playBrowserSpeech } from './browserSpeech'

/** 当前正在朗读的句子：文本 + 逐词时间 + 已播到哪（毫秒）。 */
export interface NowPlaying {
  text: string
  wordTimings: WordTiming[]
  ms: number
}

/** 服务端 TTS 出错后暂时降级多久再自动重试（避免一次抖动就永久退回浏览器语音）。 */
const SERVER_RETRY_MS = 20000

export interface UseTtsMediaOptions {
  /** Edge TTS 音色 id（改口音就是改它）。 */
  voice: string
  /** 从服务端语音退回浏览器语音时通知（server=服务端连不上；local=本机离线语音失败；autoplay=自动播放被拦）。 */
  onFallback?: (reason: 'server' | 'local' | 'autoplay') => void
}

/**
 * 出声层：`<audio>`（服务端 Edge TTS）/ 浏览器语音兜底 / 逐词时间戳。
 *
 * 只管媒体元素与一次播放的生命周期；整篇连播、点词起播等会话动作在 useTtsPlayback。
 */
export function useTtsMedia({ voice, onFallback }: UseTtsMediaOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
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

      const speakInBrowser = () => playBrowserSpeech({ utterRef, setState: setTtsState, text: t, onEnd, rate })
      // 离线引擎也走服务端，但不能被 Edge 的临时降级连坐。
      const offline = isOfflineTtsVoice(voiceRef.current)

      if (!offline && !canUseServer()) {
        speakInBrowser()
        return
      }

      const a = getAudio()
      if (!a) {
        speakInBrowser()
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
        speakInBrowser()
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
              speakInBrowser()
            } else if (isOfflineTtsVoice(voiceRef.current)) {
              fallbackRef.current?.('local')
              speakInBrowser()
            } else {
              const wasUp = canUseServer()
              serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
              if (wasUp) fallbackRef.current?.('server')
              speakInBrowser()
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
        speakInBrowser()
      }
    },
    [stopMedia, getAudio, canUseServer],
  )

  /** 清掉服务端临时降级，并唤醒可能假死的浏览器语音。 */
  const resetServerAndSpeech = useCallback(() => {
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
  }, [])

  // 卸载时停声
  useEffect(() => {
    return () => stopMedia()
  }, [stopMedia])

  return {
    playText,
    stopMedia,
    canUseServer,
    resetServerAndSpeech,
    ttsState,
    nowPlaying,
    timingsCache: timingsCacheRef.current,
  }
}
