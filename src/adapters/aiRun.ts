/**
 * 「一键跑批」的服务端客户端：`POST /api/ai/run` 起跑 → 轮询进度。
 *
 * 只做 HTTP 与轮询策略（有界、可取消），进度反馈交给调用方；
 * 编排（串联多轮、写进度状态）留在 `reader/hooks/useAiPack`。
 */

import type { AiResultEntry } from '../core/aiPackage'

type FetchLike = typeof fetch

/** 一条待跑任务（只需要发给服务端的三个字段）。 */
export interface AiRunJob {
  id: string
  task: string
  prompt: string
}

export interface AiRunFailed {
  id: string
  error: string
}

export interface AiRunOutcome {
  results: AiResultEntry[]
  failed: AiRunFailed[]
}

/** 用户点「取消」时抛的消息（调用方据此不当错误显示）。 */
export const CANCEL_MESSAGE = '已取消跑批'

/** 轮询间隔；上限 40 分钟（正常一篇的跑批远到不了）。 */
const POLL_INTERVAL_MS = 1500
const MAX_POLL_MS = 40 * 60 * 1000
/** 连续取不到进度（服务端失联）的容忍次数，约 30 秒。 */
const MAX_POLL_MISSES = 20

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl
  if (typeof fetch === 'function') return fetch
  throw new Error('当前环境没有 fetch')
}

/** 可被 abort 打断的 sleep：取消时立刻返回，不把定时器留在后台。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(CANCEL_MESSAGE))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error(CANCEL_MESSAGE))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 问一次服务端：AI key 配没配（接口只回布尔，不回 key）。失败一律当没配。 */
export async function fetchAiStatus(fetchImpl?: FetchLike): Promise<boolean> {
  try {
    const res = await resolveFetch(fetchImpl)('/api/ai/status')
    if (!res.ok) return false
    const data = (await res.json()) as { configured?: boolean } | null
    return !!data?.configured
  } catch {
    return false
  }
}

/**
 * 把一批任务发给服务端跑，轮询到结束为止。
 *
 * 有界：40 分钟超时；连续 20 次取不到进度判失联。
 * 可取消：`signal` abort 后抛 `CANCEL_MESSAGE`，定时器清干净。
 */
export async function runAiBatch(
  jobs: AiRunJob[],
  opts: { signal: AbortSignal; onProgress?: (done: number) => void; fetchImpl?: FetchLike },
): Promise<AiRunOutcome> {
  const f = resolveFetch(opts.fetchImpl)
  const { signal, onProgress } = opts

  const res = await f('/api/ai/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobs: jobs.map((j) => ({ id: j.id, task: j.task, prompt: j.prompt })) }),
    signal,
  })
  if (!res.ok) {
    const info = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    throw new Error(
      info.error === 'no-key'
        ? '服务端未配置 key：把 key 填进 config.local.json 的 ai.apiKey'
        : '启动失败：' + (info.message || res.status),
    )
  }
  const { runId } = (await res.json()) as { runId: string }

  const startedAt = Date.now()
  let misses = 0
  for (;;) {
    await sleep(POLL_INTERVAL_MS, signal)
    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error('跑批超时（40 分钟没有结果）：请稍后重试，或改用网页版工作包')
    }
    let p: {
      state?: string
      done?: number
      results?: AiResultEntry[]
      failed?: AiRunFailed[]
      error?: string
    } | null = null
    try {
      p = await (await f('/api/ai/run?id=' + encodeURIComponent(runId), { signal })).json()
    } catch {
      if (signal.aborted) throw new Error(CANCEL_MESSAGE)
      misses += 1
      if (misses >= MAX_POLL_MISSES) {
        throw new Error('与服务端失联（约 30 秒取不到进度）：确认服务还在运行后重试')
      }
      continue
    }
    misses = 0
    if (!p) continue
    onProgress?.(p.done ?? 0)
    if (p.state === 'done') return { results: p.results ?? [], failed: p.failed ?? [] }
    if (p.state === 'error') throw new Error('跑批出错：' + (p.error || '未知错误'))
  }
}
