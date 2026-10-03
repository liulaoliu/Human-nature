import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 服务子进程命令：
 *   dev（默认）= 实时开发服务器（Vite，HMR）。AI/人改代码即时生效，同端口同数据。
 *   static     = 构建产物静态服务（dist/，不会热更新，适合不想被打扰时）。
 */
export function resolveChild(root, mode) {
  if (mode === 'static') {
    return { cmd: process.execPath, args: [join(root, 'server', 'appServer.js')] }
  }
  const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  if (existsSync(viteBin)) return { cmd: process.execPath, args: [viteBin] }
  return { cmd: process.execPath, args: [join(root, 'server', 'appServer.js')] }
}

export function loadMode(root) {
  if (process.env.SERVE_MODE === 'static') return 'static'
  if (process.env.SERVE_MODE === 'dev') return 'dev'
  try {
    const c = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
    if (c.mode === 'static') return 'static'
  } catch {
    // ignore
  }
  return 'dev'
}
