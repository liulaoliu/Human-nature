import type { Calibration, CalibrationRepoPort } from '../core/ports'

const KEY = 'shadowing.calibration.v1'

/**
 * 文本对齐校准的持久化。
 *
 * 只存「文件名 → {平移词数, 起始块}」，一篇就两个整数，用 localStorage 足够，
 * 不值得为它上 IndexedDB，更不值得引 SQLite（浏览器里要 WASM 运行时 + 异步存储，
 * 为了两个整数代价太大）。
 *
 * localStorage 和 IndexedDB 一样按「来源」隔离，vite 端口是锁死的（见 vite.config.ts），
 * 所以刷新、重开都在同一条记录上。
 *
 * 隐私模式下 localStorage 可能直接抛错：存不了就当这次没持久化，不影响用。
 */
export class LocalCalibrationRepo implements CalibrationRepoPort {
  private read(): Record<string, Calibration> {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Record<string, Calibration>) : {}
    } catch {
      return {}
    }
  }

  private write(all: Record<string, Calibration>): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      // 存不下就静默放弃：下次打开校准回默认，不报错
    }
  }

  get(fileName: string): Calibration | undefined {
    return this.read()[fileName]
  }

  set(fileName: string, value: Calibration): void {
    const all = this.read()
    all[fileName] = value
    this.write(all)
  }
}

/** 没有 localStorage 时（单测 / 特殊环境）退化成内存版，行为一致。 */
export class MemoryCalibrationRepo implements CalibrationRepoPort {
  private map = new Map<string, Calibration>()

  get(fileName: string): Calibration | undefined {
    return this.map.get(fileName)
  }

  set(fileName: string, value: Calibration): void {
    this.map.set(fileName, value)
  }
}

export function createCalibrationRepo(): CalibrationRepoPort {
  try {
    if (typeof localStorage === 'undefined') return new MemoryCalibrationRepo()
    return new LocalCalibrationRepo()
  } catch {
    return new MemoryCalibrationRepo()
  }
}
