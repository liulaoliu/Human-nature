/**
 * dev server 的 SPA 回落（纯函数，便于直接测）。
 *
 * `/reader`、`/reader/**` 和旧地址 `/reader.html` 交给同一份 `index.html`；
 * **带扩展名的缺失资源必须保持原样**，否则浏览器会把一段 HTML 当 JS 解析。
 */
export function devSpaRewrite(url) {
  const [path, query] = url.split('?')
  // 旧入口 `/reader.html` 例外；其余带扩展名的路径（缺 JS/CSS）必须原样返回 404，
  // 不能回落成 HTML（浏览器会把 HTML 当 JS 解析）。
  if (path !== '/reader.html' && /\.[a-z0-9]+$/i.test(path)) return url
  if (path === '/reader' || path.startsWith('/reader/') || path === '/reader.html') {
    return '/index.html' + (query ? `?${query}` : '')
  }
  return url
}
