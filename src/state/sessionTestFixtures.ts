/**
 * `SessionStore` 脚本相关测试的夹具（**仅供测试**）：假播放器 / 假录音 / 假仓储 + 建店。
 */
import { SessionStore } from './session'
import type {
  AudioPlayerPort,
  Calibration,
  CalibrationRepoPort,
  RecorderPort,
  ScriptEditRepoPort,
  ScriptRepoPort,
  TakeRepoPort,
} from '../core/ports'
import { buildSignal } from '../core/testSignals'

export class FakePlayer implements AudioPlayerPort {
  duration = 0
  sampleRate = 0
  samples: Float32Array = new Float32Array(0)

  async load() {
    // 5 段 0.5s 语音，间隔 0.6s
    const s = buildSignal([
      ['speech', 0.5],
      ['silence', 0.6],
      ['speech', 0.6],
      ['silence', 0.6],
      ['speech', 0.5],
    ])
    this.samples = s.samples
    this.sampleRate = s.sampleRate
    this.duration = 2.7
  }
  async playRange() {}
  async playWhole() {}
  async playTake() {}
  pause() {}
  position = 0
  release() {}
  get isLoaded() {
    return true
  }
}

export class FakeRecorder implements RecorderPort {
  async start() {}
  async stop() {
    return { blob: new Blob(['x']), mimeType: 'audio/webm', durationSec: 3.2 }
  }
  onLevel(_cb: (v: number) => void) {}
  release() {}
}

export class FakeRepo implements TakeRepoPort {
  async save() {}
  async listByFile() {
    return []
  }
  async remove() {}
  async clear() {}
}

export function makeStore(
  scripts?: ScriptRepoPort,
  calibration?: CalibrationRepoPort,
  scriptEdits?: ScriptEditRepoPort,
) {
  const store = new SessionStore({
    player: new FakePlayer(),
    recorder: new FakeRecorder(),
    repo: new FakeRepo(),
    scripts,
    calibration,
    scriptEdits,
    abGapMs: 0,
  })
  return { store }
}

export class FakeScriptRepo implements ScriptRepoPort {
  /** library=false 用来测「库没取到」那条路 */
  constructor(
    private book: Record<string, string> = {},
    private library = true,
  ) {}
  async find(fileName: string) {
    if (!this.library) return { text: null, library: false }
    return { text: this.book[fileName] ?? null, library: true }
  }
}

/** 模拟 localStorage：同一个对象喂给两个 store，等价于「刷新后新建 store」 */
export class FakeCalibration implements CalibrationRepoPort {
  map = new Map<string, Calibration>()
  get(fileName: string) {
    return this.map.get(fileName)
  }
  set(fileName: string, value: Calibration) {
    this.map.set(fileName, value)
  }
}

export const blob = new Blob(['audio'])
export const SCRIPT =
  'The Kenyan government has a problem. Its banks will not lend cheaply. ' +
  'Tired of asking nicely, the government has taken matters into its own hands. ' +
  'This month it will put a cap on commercial interest rates.'
