import { useCallback, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import { isOfflineTtsVoice } from '../../core/ttsVoices'
import { wordSpans } from '../../core/wordSelect'
import type { WordTiming } from '../../core/ttsTiming'
import { timingKey } from '../../adapters/ttsCache'
import { useTtsMedia } from './useTtsMedia'

export type { WordTiming }
export type { NowPlaying } from './useTtsMedia'

export interface UseTtsPlaybackOptions {
  /** Edge TTS 音色 id（改口音就是改它）。 */
  voice: string
  /** 从服务端语音退回浏览器语音时通知（server=服务端连不上；local=本机离线语音失败；autoplay=自动播放被拦）。 */
  onFallback?: (reason: 'server' | 'local' | 'autoplay') => void
}

/**
 * 播放层：`<audio>`（服务端 Edge TTS）/ 浏览器语音兜底 / 逐词时间戳 / 单句与整篇朗读。
 *
 * 只管「怎么出声」，不关心预热与当前文章；媒体元素和一次播放的生命周期在 `useTtsMedia`，
 * 这里只做点词 seek、词区间停止、整篇连播与停止/复位。逐词时间戳缓存通过 `timingsCache` 暴露给预热层复用。
 * `speak` 等回调身份稳定（空依赖链），调用方可在任意位置引用。
 */
export function useTtsPlayback({ voice, onFallback }: UseTtsPlaybackOptions) {
  const { playText, stopMedia, canUseServer, resetServerAndSpeech, ttsState, nowPlaying, timingsCache } =
    useTtsMedia({ voice, onFallback })
  const readAllRef = useRef(false)
  /** 点词 / 词区间起播读最新音色，但不改变回调身份（和拆开前一致）。 */
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const [readingAll, setReadingAll] = useState(false)

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
    resetServerAndSpeech()
  }, [stopMedia, resetServerAndSpeech])

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
      const v = voiceRef.current
      const cached = timingsCache.get(timingKey(v, t))
      if (cached) {
        playText(t, undefined, 1, cached[wordIndex]?.start ?? 0)
      } else if (isOfflineTtsVoice(v)) {
        // 离线引擎没有逐词时间戳：截出「从这个词到句尾」直接合成，至少保证从该词起播
        const from = wordSpans(t)[wordIndex]?.start ?? 0
        playText(t.slice(from))
      } else {
        // 没时间戳：先从头播（在手势内，避免被自动播放策略拦），拿到时间戳后在 playText 里 seek
        playText(t, undefined, 1, 0, wordIndex)
      }
    },
    [playText, timingsCache],
  )

  /** 从整句音频里播一个「词区间」（听写整句模式）：完全复用整句缓存，零额外合成。 */
  const speakRange = useCallback(
    (text: string, startWord: number, endWord?: number) => {
      readAllRef.current = false
      setReadingAll(false)
      const t = text.trim()
      if (!t) return
      const v = voiceRef.current
      const cached = timingsCache.get(timingKey(v, t))
      if (cached) {
        const s = cached[startWord]?.start ?? 0
        const e = endWord != null ? cached[endWord]?.end : undefined
        playText(t, undefined, 1, s, undefined, undefined, e)
      } else if (isOfflineTtsVoice(v)) {
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
    [playText, timingsCache],
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
    timingsCache,
  }
}
