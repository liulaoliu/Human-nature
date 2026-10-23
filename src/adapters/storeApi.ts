/** `/api/store/*` 的最小客户端：只做 HTTP，不掺领域逻辑。 */

type FetchLike = typeof fetch

export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoreUnavailableError'
  }
}

/**
 * 写冲突（HTTP 409）：这次写入**被服务端有意拒绝**，不是服务挂了。
 *
 * 必须和 StoreUnavailableError 分开：后者会触发「切到 IndexedDB」的降级，
 * 而冲突要保留在 SQLite 上、让用户知道「另一个页面改过了」。
 */
export class StoreConflictError extends Error {
  readonly updatedAt: string | null
  readonly count: number

  constructor(message: string, detail: { updatedAt?: string | null; count?: number } = {}) {
    super(message)
    this.name = 'StoreConflictError'
    this.updatedAt = detail.updatedAt ?? null
    this.count = detail.count ?? 0
  }
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike | null {
  if (fetchImpl) return fetchImpl
  return typeof fetch === 'function' ? fetch : null
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (ms > 0 && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      return AbortSignal.timeout(ms)
    }
  } catch {
    // 老浏览器没有 AbortSignal.timeout：不设超时
  }
  return undefined
}

/** 服务端 SQLite 是否可用；不可用（静态部署 / Node 太老 / 服务挂了）返回 false。 */
export async function storeHealth(fetchImpl?: FetchLike, timeoutMs = 600): Promise<boolean> {
  const f = resolveFetch(fetchImpl)
  if (!f) return false
  const signal = timeoutSignal(timeoutMs)
  try {
    const res = await f('/api/store/health', { cache: 'no-store', signal })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean }
    return data?.ok === true
  } catch {
    return false
  }
}

/** 调 `/api/store` 下的 JSON 接口；非 2xx / 断网统一抛 StoreUnavailableError。 */
export async function storeRequest<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl?: FetchLike,
  timeoutMs = 0,
): Promise<T> {
  const f = resolveFetch(fetchImpl)
  if (!f) throw new StoreUnavailableError('当前环境没有 fetch')
  const signal = init.signal ?? timeoutSignal(timeoutMs)
  let res: Response
  try {
    res = await f(`/api/store${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
      signal,
    })
  } catch (e) {
    throw new StoreUnavailableError(e instanceof Error ? e.message : '存储服务不可用')
  }
  if (res.status === 409) {
    // 版本冲突：把服务端那版的元信息带出去，调用方据此刷新/提示
    let body: { error?: string; updatedAt?: string | null; count?: number } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      // 不是 JSON 也照样按冲突处理
    }
    throw new StoreConflictError(body.error || '词库已被其它页面改过', body)
  }
  if (!res.ok) throw new StoreUnavailableError(`存储服务返回 ${res.status}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new StoreUnavailableError('存储服务返回的不是 JSON')
  }
}
