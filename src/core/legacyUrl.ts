/**
 * 老地址兼容：把 `index.html` / `reader.html#/...` 迁到单入口 SPA 的干净路径。
 *
 * 纯函数，输入 `window.location` 的三段、返回要 `replaceState` 的新地址；
 * 普通路径返回 `null`（不动地址栏）。抽出来是为了能直接测，不用起浏览器。
 */
export function normalizeLegacyUrl(pathname: string, search: string, hash: string): string | null {
  if (pathname === '/index.html') return '/' + search + hash
  if (pathname !== '/reader.html') return null
  const fromHash = hash.replace(/^#/, '')
  const path = fromHash && fromHash !== '/' ? fromHash : ''
  return '/reader' + path + search
}
