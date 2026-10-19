/** `/api/store/*` 的最小客户端：只做 HTTP，不掺领域逻辑。 */

type FetchLike = typeof fetch

export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoreUnavailableError'
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
  if (!res.ok) throw new StoreUnavailableError(`存储服务返回 ${res.status}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new StoreUnavailableError('存储服务返回的不是 JSON')
  }
}
