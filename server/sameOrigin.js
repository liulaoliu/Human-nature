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
 *   - 带 Origin 的：Origin.host 必须等于 Host；
 *   - 浏览器明确标记 `Sec-Fetch-Site: cross-site` 的：拒绝（覆盖无 Origin 的 GET）；
 *   - curl / 脚本不带 Origin：放行（本机工具链要用）。
 */
export function isSameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === (req.headers.host || '')
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
