import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// 后台静默启动 watchdog（崩溃自动重启）。
// detached + windowsHide + stdio ignore：完全脱离控制台，关掉命令行窗口不影响运行。
export function spawnDetachedServer(spawnFn = spawn) {
  const child = spawnFn(process.execPath, [join(here, 'watchdog-cli.js')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    // 从项目根启动：silent-start.vbs 会把 cwd 设成 server/，这里纠正回来
    cwd: join(here, '..'),
  })
  child.unref()
  return child
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  spawnDetachedServer()
  console.log('服务器已后台启动（独立进程，关闭本窗口不影响运行）。')
}
