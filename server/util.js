import { extname, resolve, sep } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

export function contentType(file) {
  return TYPES[extname(file).toLowerCase()] || 'application/octet-stream'
}

const SLASH = String.fromCharCode(47)
const BACKSLASH = String.fromCharCode(92)

/** 去掉开头的 / 或 \，不依赖正则（避免转义坑）。 */
export function stripLeadingSlashes(p) {
  let s = p
  while (s.startsWith(SLASH) || s.startsWith(BACKSLASH)) s = s.slice(1)
  return s
}

/** 把 URL 路径安全拼到 root 下；越界（..）返回 null。 */
export function safeJoin(root, urlPath) {
  let decoded = urlPath
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const rel = stripLeadingSlashes(decoded.split('?')[0].split('#')[0])
  const full = resolve(root, rel)
  const base = resolve(root)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}
