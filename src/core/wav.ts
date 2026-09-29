/**
 * 把 float32 采样编码成 16-bit PCM 的 WAV Blob。
 *
 * 用途：把「我的录音」按计算好的增益缩放后重新编码，直接交给 `<audio>` 播。
 * 这样不依赖 WebAudio 的 MediaElementSource 增益链路（那条路一旦建不起来就没声、
 * 也测不了），而且这里是纯数据变换，能单测。几秒的 WAV 也就几百 KB。
 */

export function floatToWav(channels: Float32Array[], sampleRate: number): Blob {
  const numCh = channels.length
  const frames = numCh > 0 ? channels[0].length : 0
  const blockAlign = numCh * 2
  const dataBytes = frames * blockAlign
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)

  writeStr(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(view, 8, 'WAVE')
  writeStr(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let off = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = clamp(channels[c][i] ?? 0)
      view.setInt16(off, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true)
      off += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

function clamp(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
}
