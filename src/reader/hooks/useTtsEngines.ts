import { useEffect, useState } from 'react'
import type { TtsEngineInfo } from '../../core/ttsVoices'

export interface TtsEngines extends TtsEngineInfo {
  edge: boolean
}

/**
 * 探测服务端可用的 TTS 引擎（离线系统语音 SAPI / Linux Piper）。
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
