import { useCallback, useEffect, useRef, useState } from 'react'

export interface PregenState {
  done: number
  total: number
  running: boolean
  allCached: boolean
}

const EMPTY: PregenState = { done: 0, total: 0, running: false, allCached: false }

export interface UsePregenerateParams {
  /** 当前文章句子（只取 text）；换文章要重算。 */
  sentences: readonly { text: string }[] | null
  /** 当前音色；换音色缓存不再成立。 */
  voice: string
}

/**
 * 整篇朗读预生成：先查缓存、只补缺的句子（增量），带进度、可取消。
 *
 * `fetch` 是可选能力（本地 TTS 服务）：查询失败按「未缓存」处理，单句合成失败不打断整篇。
 * 这段原来散在 `ReaderApp` 里直接 `fetch('/api/tts')`，抽出来便于单测并发/取消/增量。
 */
export function usePregenerate({ sentences, voice }: UsePregenerateParams) {
  const [pregen, setPregen] = useState<PregenState>(EMPTY)
  const abortRef = useRef(false)

  // 换音色 / 换文章后，「已全部缓存」不再成立
  useEffect(() => {
    setPregen((p) => (p.allCached ? { ...p, allCached: false } : p))
  }, [voice, sentences])

  const pregenerateAll = useCallback(async () => {
    const list = (sentences ?? []).map((s) => s.text.trim()).filter(Boolean)
    if (!list.length) return
    const v = voice
    abortRef.current = false
    setPregen({ done: 0, total: list.length, running: true, allCached: false })

    // 1) 查缓存（不合成）——找出缺哪几句
    let ci = 0
    const missing: string[] = []
    await Promise.all(
      Array.from({ length: Math.min(8, list.length) }, async () => {
        for (;;) {
          if (abortRef.current) return
          const i = ci++
          if (i >= list.length) return
          let cached = false
          try {
            const r = await fetch(
              `/api/tts?check=1&voice=${encodeURIComponent(v)}&text=${encodeURIComponent(list[i])}`,
            )
            const j = r.ok ? await r.json() : null
            cached = !!(j && j.cached)
          } catch {
            // 查询失败按未缓存处理，后面合成时会再报错
            cached = false
          }
          if (!cached) missing.push(list[i])
          setPregen((p) => ({ ...p, done: Math.min(i + 1, list.length) }))
        }
      }),
    )
    if (abortRef.current) {
      setPregen((p) => ({ ...p, running: false }))
      return
    }
    if (!missing.length) {
      setPregen({ done: list.length, total: list.length, running: false, allCached: true })
      return
    }

    // 2) 只合成缺的（并发 3）
    setPregen({ done: 0, total: missing.length, running: true, allCached: false })
    let next = 0
    let done = 0
    await Promise.all(
      Array.from({ length: Math.min(3, missing.length) }, async () => {
        for (;;) {
          if (abortRef.current) return
          const idx = next++
          if (idx >= missing.length) return
          try {
            await fetch(`/api/tts?voice=${encodeURIComponent(v)}&text=${encodeURIComponent(missing[idx])}`)
          } catch {
            // 单句失败不打断整篇
          }
          done++
          setPregen((p) => ({ ...p, done }))
        }
      }),
    )
    setPregen((p) => ({ ...p, running: false }))
  }, [sentences, voice])

  const cancelPregenerate = useCallback(() => {
    abortRef.current = true
  }, [])

  return { pregen, pregenerateAll, cancelPregenerate }
}
