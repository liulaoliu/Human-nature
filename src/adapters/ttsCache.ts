import { alignTimings, type WordTiming } from '../core/ttsTiming'

/**
 * 服务端 TTS 的两类小请求：逐词时间戳 + 后台预热（HEAD）。
 *
 * 抽到 adapters 的原因：URL 拼装、`fetch` 失败/形状不符的兜底都在这里，
 * hook 只负责「拿到结果后要不要高亮/缓存」。时间戳失败一律返回 null（朗读照常，只是不高亮）。
 */

/** 时间戳缓存 key：音色 + 文本（同一句换音色时间轴不同，不能混用）。 */
export function timingKey(voice: string, text: string): string {
  return `${voice}\n${text}`
}

/**
 * 取逐词时间戳。
 * 空数组 = 服务端这次降级到了本地引擎，按「没拿到」处理（不缓存，等 Edge 恢复）。
 */
export async function fetchTimings(
  voice: string,
  text: string,
  f: typeof fetch = fetch,
): Promise<WordTiming[] | null> {
  try {
    const r = await f(`/api/tts/words?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`)
    if (!r.ok) return null
    const j: unknown = await r.json()
    return Array.isArray(j) && j.length ? alignTimings(text, j) : null
  } catch {
    return null
  }
}

/**
 * 后台预热一句音频（HEAD 让服务端先合成，不下载正文）。
 * 返回 true = 这次请求已发出并得到响应（失败也标记完成，保持原有「不反复重试」的口径）。
 */
export async function prefetchAudio(
  voice: string,
  text: string,
  f: typeof fetch = fetch,
): Promise<boolean> {
  try {
    await f(`/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`, {
      method: 'HEAD',
    })
    return true
  } catch {
    return false
  }
}
