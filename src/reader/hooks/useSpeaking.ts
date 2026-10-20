import { useCallback, useEffect } from 'react'
import type { Sentence } from '../../types/document'
import { DEFAULT_TTS_VOICE } from '../../core/ttsVoices'
import { useTtsPlayback, type NowPlaying, type WordTiming } from './useTtsPlayback'
import { useTtsPrefetch } from './useTtsPrefetch'

export type { NowPlaying, WordTiming }

export interface UseSpeakingOptions {
  /** 当前文章（只用到句子列表）；没有文章时为 null。 */
  doc: { sentences: Sentence[] } | null
  /** 当前选中句（用于后台预热它之后的几句）。 */
  selectedId: string | null
  /** Edge TTS 音色 id（改口音就是改它）。 */
  voice?: string
  /** 从服务端语音退回浏览器语音时通知（server=服务端连不上；local=本机离线语音失败；autoplay=自动播放被拦）。 */
  onFallback?: (reason: 'server' | 'local' | 'autoplay') => void
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
 * 本 hook 只做接线：播放（`useTtsPlayback`）+ 预热（`useTtsPrefetch`）各管一段，
 * 逐词时间戳缓存由播放层持有、传给预热层复用（同一份缓存，不各存一套）。
 * `speak` 身份稳定（useCallback 空依赖链），调用方可在任意位置引用。
 */
export function useSpeaking({ doc, selectedId, voice = DEFAULT_TTS_VOICE, onFallback }: UseSpeakingOptions) {
  const {
    speak,
    speakFromWord,
    speakRange,
    startReadAll: startReadAllSentences,
    stopReadAll,
    resetSpeech,
    readingAll,
    ttsState,
    nowPlaying,
    canUseServer,
    timingsCache,
  } = useTtsPlayback({ voice, onFallback })

  const { warmTexts, warmTimings } = useTtsPrefetch({ doc, selectedId, voice, canUseServer, timingsCache })

  /** 逐句朗读整篇（文章为空时不动）。 */
  const startReadAll = useCallback(
    () => startReadAllSentences(doc?.sentences ?? []),
    [doc, startReadAllSentences],
  )

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
