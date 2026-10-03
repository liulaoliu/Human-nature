import { readFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

function killByPidFile(file) {
  const p = join(here, file)
  if (!existsSync(p)) return false
  let pid = 0
  try {
    pid = Number(readFileSync(p, 'utf8').trim())
  } catch {
    pid = 0
  }
  try {
    rmSync(p, { force: true })
  } catch {
    // ignore
  }
  if (!pid) return false
  try {
    process.kill(pid)
    return true
  } catch {
    return false
  }
}

// 必须先杀 watchdog，否则它会把 appServer 重新拉起来
const a = killByPidFile('.watchdog.pid')
const b = killByPidFile('.appServer.pid')
console.log(a || b ? '服务已停止。' : '服务未在运行（或 PID 文件已失效）。')
