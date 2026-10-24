import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface RestartDecision {
  restart: boolean
  message: string
}

/** 崩溃后是否重启：非 0 退出才重启；连续崩溃超过上限则停止。 */
export function restartDecision({
  code,
  consecutive,
  maxRestarts,
}: {
  code: number | null
  consecutive: number
  maxRestarts: number
}): RestartDecision {
  if (consecutive >= maxRestarts) {
    return { restart: false, message: `连续崩溃 ${maxRestarts} 次，停止自动重启` }
  }
  if (code !== 0) {
    return { restart: true, message: `退出码 ${code}，准备重启` }
  }
  return { restart: false, message: '正常退出' }
}

export interface WatchdogOptions {
  cmd: string
  args: string[]
  cwd?: string
  maxRestarts?: number
  restartDelayMs?: number
}

/** 守护进程：子进程崩溃自动重启。 */
export class Watchdog extends EventEmitter {
  cmd: string
  args: string[]
  cwd: string | undefined
  maxRestarts: number
  restartDelayMs: number
  consecutive: number
  stopped: boolean
  child: ChildProcess | null
  timer: ReturnType<typeof setTimeout> | null

  constructor({ cmd, args, cwd = undefined, maxRestarts = 10, restartDelayMs = 2000 }: WatchdogOptions) {
    super()
    this.cmd = cmd
    this.args = args
    this.cwd = cwd
    this.maxRestarts = maxRestarts
    this.restartDelayMs = restartDelayMs
    this.consecutive = 0
    this.stopped = false
    this.child = null
    this.timer = null
  }

  start(): this {
    this.spawn()
    return this
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.child) this.child.kill()
  }

  spawn(): void {
    if (this.stopped) return
    this.child = spawn(this.cmd, this.args, { stdio: 'inherit', windowsHide: true, cwd: this.cwd })
    this.emit('spawn', this.child.pid)
    this.child.on('exit', (code) => this.onExit(code))
  }

  onExit(code: number | null): void {
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
