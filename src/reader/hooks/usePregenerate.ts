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
 *
 * 换文章 / 换音色 / 卸载都必须**真正停掉旧 run**：旧请求继续跑不仅白烧 CPU，
 * 还会把进度写到新文章上。这里用 `runId + AbortController` 双保险：
 *   - runId 不一致 → 旧 run 的所有 setState 直接丢弃；
 *   - signal 传给每个 fetch → 能取消的请求立刻断开。
 */
export function usePregenerate({ sentences, voice }: UsePregenerateParams) {
  const [pregen, setPregen] = useState<PregenState>(EMPTY)
  const runIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  /** 结束当前 run：旧 run 之后的任何 setState 都会被 runId 挡掉。 */
  const stopRun = useCallback(() => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  // 换音色 / 换文章：停掉旧 run，「已全部缓存」也不再成立
  useEffect(() => {
    stopRun()
    setPregen((p) => (p.running || p.allCached ? { ...p, running: false, allCached: false } : p))
  }, [voice, sentences, stopRun])

  // 卸载：停掉所有在途请求，之后不再 setState
  useEffect(() => stopRun, [stopRun])

  const pregenerateAll = useCallback(async () => {
    const list = (sentences ?? []).map((s) => s.text.trim()).filter(Boolean)
    if (!list.length) return
    const v = voice
    stopRun()
    const runId = runIdRef.current
    const ac = new AbortController()
    abortRef.current = ac
    const alive = () => runId === runIdRef.current && !ac.signal.aborted
    const update = (fn: (p: PregenState) => PregenState) => {
      if (alive()) setPregen(fn)
    }
    setPregen({ done: 0, total: list.length, running: true, allCached: false })

    // 1) 查缓存（不合成）——找出缺哪几句
    let ci = 0
    const missing: string[] = []
    await Promise.all(
      Array.from({ length: Math.min(8, list.length) }, async () => {
        for (;;) {
          if (!alive()) return
          const i = ci++
          if (i >= list.length) return
          let cached = false
          try {
            const r = await fetch(
              `/api/tts?check=1&voice=${encodeURIComponent(v)}&text=${encodeURIComponent(list[i])}`,
              { signal: ac.signal },
            )
            const j = r.ok ? await r.json() : null
            cached = !!(j && j.cached)
          } catch {
            // 查询失败按未缓存处理，后面合成时会再报错
            cached = false
          }
          if (!alive()) return
          if (!cached) missing.push(list[i])
          update((p) => ({ ...p, done: Math.min(i + 1, list.length) }))
        }
      }),
    )
    if (!alive()) return
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
          if (!alive()) return
          const idx = next++
          if (idx >= missing.length) return
          try {
            await fetch(`/api/tts?voice=${encodeURIComponent(v)}&text=${encodeURIComponent(missing[idx])}`, {
              signal: ac.signal,
            })
          } catch {
            // 单句失败 / 被取消都不打断整篇
          }
          if (!alive()) return
          done++
          update((p) => ({ ...p, done }))
        }
      }),
    )
    update((p) => ({ ...p, running: false }))
  }, [sentences, voice, stopRun])

  const cancelPregenerate = useCallback(() => {
    stopRun()
    setPregen((p) => (p.running ? { ...p, running: false } : p))
  }, [stopRun])

  return { pregen, pregenerateAll, cancelPregenerate }
}
