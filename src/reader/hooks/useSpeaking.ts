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

/** 服务端 TTS 出错后暂时降级多久再自动重试（避免一次抖动就永久退回浏览器语音）。 */
const SERVER_RETRY_MS = 20000
/** 选中某句时，后台预热它之后最多几句（顺序渐进，给下一次点击/连播省合成时间）。 */
const PREFETCH_AHEAD = 4

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
  /** 当前选中句（用于后台预热它之后的几句）。 */
  selectedId: string | null
  /** Edge TTS 音色 id（改口音就是改它）。 */
  voice?: string
}

/**
 * 朗读（TTS）。**优先用服务端 Edge TTS（/api/tts）+ `<audio>` 播放**，
 * 彻底绕开浏览器 `speechSynthesis` 的假死；服务端不可用时自动退回浏览器语音。
 *
 * 三个降低「点一下等两秒」和「时而 Chrome 时而 Edge」的点：
 *  - 时间戳缓存：逐词时间戳只取一次，之后点词跳播同步 seek（也就不会因 await 丢手势）；
 *  - 服务端降级是**临时的**（出错后 20 秒自动重试 Edge），不再一次失败就永久用浏览器语音；
 *  - 选中句子后**后台预热**其后几句（HEAD 触发服务端合成，不下载正文），顺读时基本秒播。
 *
 * `speak` 身份稳定（useCallback 空依赖链），调用方可在任意位置引用。
 */
export function useSpeaking({ doc, selectedId, voice = DEFAULT_TTS_VOICE }: UseSpeakingOptions) {
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
  /** 已取回的逐词时间戳缓存（`voice\ntext` → timings）。 */
  const timingsCacheRef = useRef<Map<string, WordTiming[]>>(new Map())
  /** 当前播放的文本（异步 seek 用 ref，避免读到过期的 state）。 */
  const curTextRef = useRef<string | null>(null)
  /** 当前播放的「到此为止」毫秒（听写整句模式下只播一个子块时用）。 */
  const stopMsRef = useRef<number | null>(null)
  /** 后台预热的队列与去重集，串行执行（不抢用户点击的合成并发）。 */
  const prefetchQueueRef = useRef<string[]>([])
  const prefetchQueuedRef = useRef<Set<string>>(new Set())
  const prefetchDoneRef = useRef<Set<string>>(new Set())
  const prefetchingRef = useRef(false)
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
    curTextRef.current = null
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
      curTextRef.current = t
      setTtsState('loading')
      const tkey = `${voiceRef.current}\n${t}`
      const cachedTimings = timingsCacheRef.current.get(tkey)
      // 有缓存时间戳：直接把「起 / 止」换算成毫秒；没有则等取回后按词下标换算。
      let effSeek = seekMs
      if (cachedTimings && seekWordIndex != null) effSeek = cachedTimings[seekWordIndex]?.start ?? effSeek
      stopMsRef.current =
        stopMs ?? (cachedTimings && stopWordIndex != null ? (cachedTimings[stopWordIndex]?.end ?? null) : null)
      setNowPlaying({ text: t, wordTimings: cachedTimings ?? [], ms: effSeek })
      const token = tokenRef.current

      const useBrowser = () => playBrowser(t, onEnd, rate)

      if (!canUseServer()) {
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
            curTextRef.current = null
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
          curTextRef.current = null
          setTtsState('idle')
          setNowPlaying(null)
          onEnd?.()
        }
      }
      a.onerror = () => {
        if (token !== tokenRef.current) return
        // 服务端暂时不可用：降级一段时间后自动重试 Edge（不再永久退回浏览器语音）
        serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
        useBrowser()
      }
      // 逐词时间戳（服务端随音频一起生成）：有缓存直接用；没有才请求。sapi 无时间戳，跳过。
      if (!cachedTimings && !voiceRef.current.startsWith('sapi:')) {
        fetch(`/api/tts/words?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (Array.isArray(j)) onTimings(alignTimings(t, j))
          })
          .catch(() => {
            // 忽略：拿不到时间戳就不高亮
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
              useBrowser()
            } else {
              serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
              useBrowser()
            }
          })
        }
      } catch {
        serverDownUntilRef.current = Date.now() + SERVER_RETRY_MS
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
      const cached = timingsCacheRef.current.get(`${voiceRef.current}\n${t}`)
      if (cached) {
        playText(t, undefined, 1, cached[wordIndex]?.start ?? 0)
      } else {
        // 没时间戳：先从头播（在手势内，避免被自动播放策略拦），拿到时间戳后在 playText 里 seek
        playText(t, undefined, 1, 0, wordIndex)
      }
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

  // ---- 后台预热：串行 HEAD 触发服务端合成（不下载正文），顺读时基本秒播 ----

  const pumpPrefetch = useCallback(async () => {
    if (prefetchingRef.current) return
    prefetchingRef.current = true
    try {
      while (prefetchQueueRef.current.length) {
        // 服务端在降级期：先不预热，队列留着，恢复后自动继续
        if (!canUseServer()) break
        const t = prefetchQueueRef.current.shift()!
        const k = `${voiceRef.current}\n${t}`
        if (prefetchDoneRef.current.has(k)) {
          prefetchQueuedRef.current.delete(k)
          continue
        }
        try {
          await fetch(`/api/tts?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(t)}`, {
            method: 'HEAD',
          })
          prefetchDoneRef.current.add(k)
        } catch {
          // 失败：不标完成，允许之后重试
        } finally {
          prefetchQueuedRef.current.delete(k)
        }
      }
    } finally {
      prefetchingRef.current = false
    }
  }, [canUseServer])

  const enqueuePrefetch = useCallback(
    (texts: string[]) => {
      let added = false
      for (const t of texts) {
        const k = `${voiceRef.current}\n${t}`
        if (prefetchQueuedRef.current.has(k) || prefetchDoneRef.current.has(k)) continue
        prefetchQueuedRef.current.add(k)
        prefetchQueueRef.current.push(t)
        added = true
      }
      if (added) void pumpPrefetch()
    },
    [pumpPrefetch],
  )

  /** 预热任意文本的音频（后台 HEAD，不下载正文）。填空并段用它把「块」也缓存上。 */
  const warmTexts = useCallback(
    (texts: string[]) => enqueuePrefetch(texts.map((t) => t.trim()).filter(Boolean)),
    [enqueuePrefetch],
  )

  /** 正在取时间戳的 key，避免同一句并发重复请求。 */
  const warmTimingsQueuedRef = useRef<Set<string>>(new Set())

  /** 预热「整句音频 + 逐词时间戳」：听写整句模式用它来 seek 播放（顺带把整句音频合成好）。 */
  const warmTimings = useCallback(
    (texts: string[]) => {
      const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
      for (const t of uniq) {
        const key = `${voiceRef.current}\n${t}`
        if (timingsCacheRef.current.has(key)) continue
        if (voiceRef.current.startsWith('sapi:')) continue
        if (!canUseServer()) return
        if (warmTimingsQueuedRef.current.has(key)) continue
        warmTimingsQueuedRef.current.add(key)
        void fetch(`/api/tts/words?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (Array.isArray(j)) timingsCacheRef.current.set(key, alignTimings(t, j))
          })
          .catch(() => {
            // 忽略
          })
          .finally(() => {
            warmTimingsQueuedRef.current.delete(key)
          })
      }
    },
    [canUseServer],
  )

  /** 从整句音频里播一个「词区间」（听写整句模式）：完全复用整句缓存，零额外合成。 */
  const speakRange = useCallback(
    (text: string, startWord: number, endWord?: number) => {
      readAllRef.current = false
      setReadingAll(false)
      const t = text.trim()
      if (!t) return
      const cached = timingsCacheRef.current.get(`${voiceRef.current}\n${t}`)
      if (cached) {
        const s = cached[startWord]?.start ?? 0
        const e = endWord != null ? cached[endWord]?.end : undefined
        playText(t, undefined, 1, s, undefined, undefined, e)
      } else {
        // 没时间戳：先从头播（在手势内），时间戳回来后 onTimings 会 seek 并按 stopWordIndex 停
        playText(t, undefined, 1, 0, startWord, endWord)
      }
    },
    [playText],
  )

  // 换音色：清缓存与队列（时间戳按 voice 作 key，不会错用；一并清掉省内存）
  useEffect(() => {
    timingsCacheRef.current.clear()
    prefetchQueueRef.current = []
    prefetchQueuedRef.current.clear()
    prefetchDoneRef.current.clear()
  }, [voice])

  // 选中某句 → 预热它和其后几句，顺读时下一次点击基本秒播
  useEffect(() => {
    if (!doc || !selectedId) return
    const list = doc.sentences
    const idx = list.findIndex((s) => s.id === selectedId)
    if (idx < 0) return
    const ahead = list
      .slice(idx, idx + 1 + PREFETCH_AHEAD)
      .map((s) => s.text.trim())
      .filter(Boolean)
    enqueuePrefetch(ahead)
  }, [doc, selectedId, enqueuePrefetch])

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

  return {
    speak,
    speakFromWord,
    speakRange,
    startReadAll,
    stopReadAll,
    resetSpeech,
    warmTexts,
    warmTimings,
    readingAll,
    ttsState,
    nowPlaying,
  }
}
