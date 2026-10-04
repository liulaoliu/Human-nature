import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, rmSync } from 'node:fs'
import { Watchdog } from './watchdog.js'
import { resolveChild, loadMode } from './mode.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const watchdogPid = join(here, '.watchdog.pid')
const childPid = join(here, '.child.pid')

writeFileSync(watchdogPid, String(process.pid), 'utf8')
const cleanup = () => {
  for (const f of [watchdogPid, childPid]) {
    try {
      rmSync(f, { force: true })
    } catch {
      // ignore
    }
  }
}
process.on('exit', cleanup)

const mode = loadMode(root)
const child = resolveChild(root, mode)
console.log(`[service] mode=${mode}`)

const wd = new Watchdog({
  cmd: child.cmd,
  args: child.args,
  // 固定在项目根跑：否则从 server/ 启动时 Vite 的 root 会变成 server/，页面全 404
  cwd: root,
  maxRestarts: 10,
  restartDelayMs: 2000,
})
wd.on('spawn', (pid) => {
  try {
    writeFileSync(childPid, String(pid), 'utf8')
  } catch {
    // ignore
  }
})
wd.on('exit', (info) => {
  console.log(`[watchdog] ${info.message}${info.code != null ? ` (code ${info.code})` : ''}`)
})
wd.start()
