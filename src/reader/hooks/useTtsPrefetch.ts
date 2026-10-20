import { useCallback, useEffect, useRef } from 'react'
import type { Sentence } from '../../types/document'
import { isOfflineTtsVoice } from '../../core/ttsVoices'
import type { WordTiming } from '../../core/ttsTiming'
import { fetchTimings, prefetchAudio, timingKey } from '../../adapters/ttsCache'

/** 选中某句时，后台预热它之后最多几句（顺序渐进，给下一次点击/连播省合成时间）。 */
const PREFETCH_AHEAD = 4

export interface UseTtsPrefetchOptions {
  /** 当前文章（只用到句子列表）；没有文章时为 null。 */
  doc: { sentences: Sentence[] } | null
  /** 当前选中句（用于后台预热它之后的几句）。 */
  selectedId: string | null
  /** Edge TTS 音色 id（改口音要清缓存与队列）。 */
  voice: string
  /** 服务端 TTS 现在能不能用（播放层统一判定，避免两套降级口径）。 */
  canUseServer: () => boolean
  /** 与播放层共用的逐词时间戳缓存（`voice\ntext` → timings）。 */
  timingsCache: Map<string, WordTiming[]>
}

/**
 * 预热层：后台串行 HEAD 触发服务端合成（不下载正文），顺读时基本秒播；
 * 另外按需预取逐词时间戳（听写整句模式 seek 用）。
 *
 * 队列串行、按 `voice\ntext` 去重；服务端降级期暂停（队列留着，恢复后继续），离线引擎不受影响。
 */
export function useTtsPrefetch({ doc, selectedId, voice, canUseServer, timingsCache }: UseTtsPrefetchOptions) {
  /** 当前音色（预热回调身份稳定，读 ref 取最新）。 */
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  /** 后台预热的队列与去重集，串行执行（不抢用户点击的合成并发）。 */
  const prefetchQueueRef = useRef<string[]>([])
  const prefetchQueuedRef = useRef<Set<string>>(new Set())
  const prefetchDoneRef = useRef<Set<string>>(new Set())
  const prefetchingRef = useRef(false)
  /** 正在取时间戳的 key，避免同一句并发重复请求。 */
  const warmTimingsQueuedRef = useRef<Set<string>>(new Set())

  const pumpPrefetch = useCallback(async () => {
    if (prefetchingRef.current) return
    prefetchingRef.current = true
    try {
      while (prefetchQueueRef.current.length) {
        // 服务端在 Edge 降级期：先不预热，队列留着，恢复后自动继续；离线引擎不受影响
        if (!isOfflineTtsVoice(voiceRef.current) && !canUseServer()) break
        const t = prefetchQueueRef.current.shift()!
        const k = timingKey(voiceRef.current, t)
        if (prefetchDoneRef.current.has(k)) {
          prefetchQueuedRef.current.delete(k)
          continue
        }
        try {
          // 失败（网络层）不标完成，允许之后重试；服务端有响应就记完成。
          if (await prefetchAudio(voiceRef.current, t)) prefetchDoneRef.current.add(k)
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
        const k = timingKey(voiceRef.current, t)
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

  /** 预热「整句音频 + 逐词时间戳」：听写整句模式用它来 seek 播放（顺带把整句音频合成好）。 */
  const warmTimings = useCallback(
    (texts: string[]) => {
      const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
      for (const t of uniq) {
        const key = timingKey(voiceRef.current, t)
        if (timingsCache.has(key)) continue
        if (isOfflineTtsVoice(voiceRef.current)) continue
        if (!canUseServer()) return
        if (warmTimingsQueuedRef.current.has(key)) continue
        warmTimingsQueuedRef.current.add(key)
        void fetchTimings(voiceRef.current, t)
          .then((timings) => {
            if (timings) timingsCache.set(key, timings)
          })
          .finally(() => {
            warmTimingsQueuedRef.current.delete(key)
          })
      }
    },
    [canUseServer, timingsCache],
  )

  // 换音色：清缓存与队列（时间戳按 voice 作 key，不会错用；一并清掉省内存）
  useEffect(() => {
    timingsCache.clear()
    prefetchQueueRef.current = []
    prefetchQueuedRef.current.clear()
    prefetchDoneRef.current.clear()
    warmTimingsQueuedRef.current.clear()
  }, [voice, timingsCache])

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

  return { warmTexts, warmTimings }
}
