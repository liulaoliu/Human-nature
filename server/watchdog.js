import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

/** 崩溃后是否重启：非 0 退出才重启；连续崩溃超过上限则停止。 */
export function restartDecision({ code, consecutive, maxRestarts }) {
  if (consecutive >= maxRestarts) {
    return { restart: false, message: `连续崩溃 ${maxRestarts} 次，停止自动重启` }
  }
  if (code !== 0) {
    return { restart: true, message: `退出码 ${code}，准备重启` }
  }
  return { restart: false, message: '正常退出' }
}

/** 守护进程：子进程崩溃自动重启。 */
export class Watchdog extends EventEmitter {
  constructor({ cmd, args, maxRestarts = 10, restartDelayMs = 2000 }) {
    super()
    this.cmd = cmd
    this.args = args
    this.maxRestarts = maxRestarts
    this.restartDelayMs = restartDelayMs
    this.consecutive = 0
    this.stopped = false
    this.child = null
    this.timer = null
  }

  start() {
    this.spawn()
    return this
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.child) this.child.kill()
  }

  spawn() {
    if (this.stopped) return
    this.child = spawn(this.cmd, this.args, { stdio: 'inherit', windowsHide: true })
    this.child.on('exit', (code) => this.onExit(code))
  }

  onExit(code) {
    if (this.stopped) return
    if (code === 0) {
      this.consecutive = 0
      this.emit('exit', { restart: false, message: '正常退出' })
      this.stopped = true
      return
    }
    const d = restartDecision({ code, consecutive: this.consecutive, maxRestarts: this.maxRestarts })
    this.consecutive += 1
    this.emit('exit', { restart: d.restart, message: d.message, code })
    if (!d.restart) {
      this.stopped = true
      return
    }
    this.timer = setTimeout(() => this.spawn(), this.restartDelayMs)
  }
}
