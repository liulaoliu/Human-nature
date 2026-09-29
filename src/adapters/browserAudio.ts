import type { AudioPlayerPort, MicOptions, RecorderPort, Take } from '../core/ports'
import { applyGain, matchGain, peakSafeGain, speechRms } from '../core/loudness'
import { floatToWav } from '../core/wav'

/** 提前 20ms 停，否则下一块的第一个字会被吃掉 */
const END_EPSILON = 0.02

export class BrowserPlayer implements AudioPlayerPort {
  private el: HTMLAudioElement
  private takeEl: HTMLAudioElement
  private objectUrl: string | null = null
  private takeUrl: string | null = null
  private raf = 0
  private endPending: (() => void) | null = null
  private _samples: Float32Array = new Float32Array(0)
  private _sampleRate = 0
  private _duration = 0
  /** 参考音的响度基准，用来把「我的录音」回放调到一样响 */
  private _refLevel = 0
  /** 录音回放的额外放大倍数（在响度对齐之后再乘） */
  private takeBoost = 1
  /** 按增益缩放后重编码的 WAV（按 take id 缓存），回放用它 */
  private takeBlobs = new Map<string, Blob>()

  constructor() {
    this.el = new Audio()
    this.el.preload = 'auto'
    this.takeEl = new Audio()
  }

  get duration() {
    return this._duration
  }
  get position() {
    return this.el.currentTime
  }
  get sampleRate() {
    return this._sampleRate
  }
  get samples() {
    return this._samples
  }

  async load(blob: Blob): Promise<void> {
    this.release()
    const ctx = new AudioContext()
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      this._samples = toMono(buf)
      this._sampleRate = buf.sampleRate
      this._duration = buf.duration
      this._refLevel = speechRms(this._samples, this._sampleRate)
    } finally {
      void ctx.close()
    }

    this.objectUrl = URL.createObjectURL(blob)
    this.el.src = this.objectUrl
    await new Promise<void>((resolve) => {
      if (this.el.readyState >= 1) return resolve()
      this.el.onloadedmetadata = () => resolve()
    })
  }

  playRange(start: number, end: number, rate: number): Promise<void> {
    this.pause()
    this.el.playbackRate = rate
    setPreservesPitch(this.el)
    this.el.currentTime = start

    return new Promise<void>((resolve) => {
      this.endPending = resolve
      this.el.play().catch(() => this.pause())

      const tick = () => {
        if (this.el.currentTime >= end - END_EPSILON) return this.pause()
        this.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
    })
  }

  playWhole(rate: number): Promise<void> {
    this.pause()
    this.el.playbackRate = rate
    setPreservesPitch(this.el)
    this.el.currentTime = 0
    return new Promise<void>((resolve) => {
      this.endPending = resolve
      this.el.play().catch(() => this.pause())
      this.el.onended = () => this.pause()
    })
  }

  setTakeBoost(mult: number): void {
    const v = Math.min(4, Math.max(0.5, mult))
    if (v === this.takeBoost) return
    this.takeBoost = v
    this.takeBlobs.clear() // 增益变了，缓存的重编码要作废
  }

  async playTake(take: Take, rate: number): Promise<void> {
    this.pause()
    // 先把「我的录音」缩放到和标准音一样响，重编码成 WAV 再播。
    // 解码/编码失败就退回原文件，至少能出声。
    const blob = await this.normalizedTake(take)
    if (this.takeUrl) URL.revokeObjectURL(this.takeUrl)
    this.takeUrl = URL.createObjectURL(blob)
    this.takeEl.src = this.takeUrl
    this.takeEl.playbackRate = rate
    setPreservesPitch(this.takeEl)

    return new Promise<void>((resolve) => {
      this.endPending = resolve
      this.takeEl.play().catch(() => this.pause())
      this.takeEl.onended = () => {
        cancelAnimationFrame(this.raf)
        this.endPending?.()
        this.endPending = null
      }
    })
  }

  /**
   * 把一条录音按增益缩放、重编码成 WAV（按 id 缓存）。
   * 增益 = 对齐标准音响度所需，再受「峰值不超过 0.99」约束，所以不会削波。
   */
  private async normalizedTake(take: Take): Promise<Blob> {
    const cached = this.takeBlobs.get(take.id)
    if (cached) return cached
    try {
      const ctx = new AudioContext()
      let buf: AudioBuffer
      try {
        buf = await ctx.decodeAudioData(await take.blob.arrayBuffer())
      } finally {
        void ctx.close()
      }
      const channels: Float32Array[] = []
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c))
      const wanted =
        (this._refLevel > 0 ? matchGain(this._refLevel, speechRms(toMono(buf), buf.sampleRate)) : 1) *
        this.takeBoost
      const gain = peakSafeGain(channels, wanted)
      const wav = floatToWav(channels.map((ch) => applyGain(ch, gain)), buf.sampleRate)
      this.takeBlobs.set(take.id, wav)
      return wav
    } catch {
      return take.blob
    }
  }

  pause(): void {
    this.el.pause()
    this.takeEl.pause()
    cancelAnimationFrame(this.raf)
    this.endPending?.()
    this.endPending = null
  }

  release(): void {
    this.pause()
    this.el.removeAttribute('src')
    this.takeEl.removeAttribute('src')
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    if (this.takeUrl) URL.revokeObjectURL(this.takeUrl)
    this.objectUrl = this.takeUrl = null
    this._samples = new Float32Array(0)
    this._sampleRate = 0
    this._duration = 0
    this._refLevel = 0
    this.takeBlobs.clear()
  }
}

function toMono(buf: AudioBuffer): Float32Array {
  const ch = buf.numberOfChannels
  const out = new Float32Array(buf.length)
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i] / ch
  }
  return out
}

function setPreservesPitch(el: HTMLAudioElement) {
  // Chrome/Firefox 有，Safari 较新版本才有。没有的话变速会变调，可接受。
  const w = el as HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean }
  if ('preservesPitch' in el) w.preservesPitch = true
  else if ('mozPreservesPitch' in w) w.mozPreservesPitch = true
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm',
  'audio/mp4',
]

export function pickRecordingMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

/**
 * 列出可用的麦克风。首次授权前 label 多半是空的，所以拿不到名字时给个序号占位。
 * 换麦是排查「发闷」最快的一步：蓝牙耳麦只有窄带，换有线/USB 麦立刻不一样。
 */
export async function listAudioInputs(): Promise<Array<{ deviceId: string; label: string }>> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` }))
  } catch {
    return []
  }
}

export class BrowserRecorder implements RecorderPort {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sink: GainNode | null = null
  private raf = 0
  private startedAt = 0
  private levelCb: ((v: number) => void) | null = null
  private opts: MicOptions = {}

  onLevel(cb: (v: number) => void): void {
    this.levelCb = cb
  }

  configure(opts: MicOptions): void {
    this.opts = { ...this.opts, ...opts }
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        location.protocol === 'file:'
          ? 'file:// 下浏览器不给麦克风权限。改用 localhost：在项目目录跑 npx vite，再访问终端里的地址。'
          : '这个浏览器不支持录音',
      )
    }
    // 「原声」只关掉浏览器那套降噪/回声消除（Chrome 的 noiseSuppression 会把高频泛音
    // 削掉，录出来发闷、像隔一层）。**自动增益始终开**：它只管音量、不改音色，
    // 关掉的话小声音会被「说完了」判定误伤，回放也明显偏小。
    const audio: MediaTrackConstraints = {
      echoCancellation: !this.opts.raw,
      noiseSuppression: !this.opts.raw,
      autoGainControl: true,
    }
    if (this.opts.deviceId) audio.deviceId = { exact: this.opts.deviceId }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio })

    const mime = pickRecordingMime()
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined)
    this.chunks = []
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.rec.start(250)
    this.startedAt = performance.now()
    this.startMeter()
  }

  async stop(): Promise<{ blob: Blob; mimeType: string; durationSec: number }> {
    const rec = this.rec
    if (!rec) throw new Error('没有在录音')
    const mimeType = rec.mimeType || pickRecordingMime() || 'audio/webm'
    const durationSec = (performance.now() - this.startedAt) / 1000

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }))
      rec.stop()
    })
    this.teardown()
    return { blob, mimeType, durationSec }
  }

  private startMeter() {
    if (!this.stream) return
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024

    // Chrome 要求录音链路有连接到 destination 才录得到声音。
    // Gain 置 0，避免自己听到自己。
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0

    src.connect(this.analyser)
    src.connect(this.sink)
    this.sink.connect(this.ctx.destination)

    const buf = new Float32Array(this.analyser.fftSize)
    const loop = () => {
      if (!this.analyser) return
      this.analyser.getFloatTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i])
        if (a > peak) peak = a
      }
      this.levelCb?.(Math.min(1, peak))
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  private teardown() {
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
    this.analyser = null
    if (this.sink) this.sink.disconnect()
    this.sink = null
    if (this.ctx) void this.ctx.close()
    this.ctx = null
    this.levelCb?.(0)
  }

  release(): void {
    if (this.rec && this.rec.state !== 'inactive') {
      this.rec.onstop = null
      this.rec.stop()
    }
    this.teardown()
  }
}
