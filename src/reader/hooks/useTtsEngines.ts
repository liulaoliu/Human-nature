import { useEffect, useState } from 'react'

export interface TtsEngineVoice {
  /** 形如 sapi:Microsoft Zira Desktop */
  id: string
  name: string
  gender?: string
  lang?: string
}

export interface TtsEngines {
  edge: boolean
  sapi: { available: boolean; voices: TtsEngineVoice[] }
}

/**
 * 探测服务端可用的 TTS 引擎（主要用来发现「离线系统语音 SAPI」）。
 * 服务端没起 / 探测失败时返回 null，此时只用 Edge 在线音色。
 */
export function useTtsEngines(): TtsEngines | null {
  const [engines, setEngines] = useState<TtsEngines | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/tts/engines')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j === 'object') setEngines(j as TtsEngines)
      })
      .catch(() => {
        // 忽略：不显示离线引擎
      })
    return () => {
      alive = false
    }
  }, [])
  return engines
}
