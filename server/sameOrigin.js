/**
 * 本地服务的同源 / 跨站判断（dev 插件与静态服务共用）。
 *
 * 背景：服务只监听 127.0.0.1，但没有登录态。浏览器里任意网页都能向
 * `http://localhost:5173/api/...` 发简单请求：
 *   - POST `/api/ai/run`（花 API 额度）
 *   - GET `/api/tts`（写缓存 / 吃 CPU）
 *   - POST `/__state`（写文件）
 * 所以所有「有副作用」的入口都要过这一层。
 *
 * 规则：
 *   - 带 Origin 的：Host 必须是本机名（localhost / 127.0.0.1 / [::1]），
 *     且 Origin.host 必须等于 Host；
 *   - 浏览器明确标记 `Sec-Fetch-Site: cross-site` 的：拒绝（覆盖无 Origin 的 GET）；
 *   - curl / 脚本不带 Origin：放行（本机工具链要用）。
 *
 * 只比 `Origin.host === Host` 防不住 DNS 重绑定：把 evil.com 解析到 127.0.0.1 后，
 * 浏览器发来的 Host / Origin 都是 evil.com，两者相等但根本不是本机页面。
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Host / URL.hostname 是不是本机名（端口不参与判断，端口由 Origin 与 Host 相等来保证）。 */
export function isLocalHost(host) {
  if (!host) return false
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

export function isSameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host || ''
  if (!isLocalHost(host)) return false
  try {
    const o = new URL(origin)
    return o.host === host && isLocalHost(o.host)
  } catch {
    return false
  }
}

/** 浏览器跨站请求（现代浏览器都会带；老浏览器没有这个头）。 */
export function isCrossSiteRequest(req) {
  return req.headers['sec-fetch-site'] === 'cross-site'
}

/** 有副作用 / 会花钱 / 会写盘的请求是否允许。 */
export function allowLocalRequest(req) {
  return isSameOrigin(req) && !isCrossSiteRequest(req)
}
