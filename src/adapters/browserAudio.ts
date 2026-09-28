import type { AudioPlayerPort, RecorderPort, Take } from '../core/ports'

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

  playTake(take: Take, rate: number): Promise<void> {
    this.pause()
    if (this.takeUrl) URL.revokeObjectURL(this.takeUrl)
    this.takeUrl = URL.createObjectURL(take.blob)
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

  onLevel(cb: (v: number) => void): void {
    this.levelCb = cb
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        location.protocol === 'file:'
          ? 'file:// 下浏览器不给麦克风权限。改用 localhost：在项目目录跑 npx vite，再访问终端里的地址。'
          : '这个浏览器不支持录音',
      )
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })

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
