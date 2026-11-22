import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRecorder, listAudioInputs } from '../../adapters/browserAudio'
import {
  LEVEL_PUSH_MS,
  LOW_PEAK,
  MIN_TAKE_SEC,
  NOISE_FLOOR_INIT,
  VOICE_HANGOVER_MS,
  VOICE_LEVEL,
  recordCapMs,
  voiceThreshold,
} from '../../core/recording'
import { persistentBoolTrue, persistentString, useLocalStorageState } from './useLocalStorageState'

export interface MicDevice {
  deviceId: string
  label: string
}

export interface RecordedAudio {
  blob: Blob
  mimeType: string
  durationSec: number
  speechFrom?: number
  speechTo?: number
}

export interface UseRepeatRecorderOptions {
  /** 读完静音一段时间自动停（连续跟读用）；手动录音也开着，省得一直按。 */
  onAutoStop?: () => void
  /** 复读没开时不枚举麦克风（面板常驻，但大多数时候是关着的）。 */
  enabled?: boolean
}

/**
 * 复读的录音生命周期：开麦 → 电平/峰值/噪声底 → 停录（手动或静音自动）→ 交给调用方落库。
 *
 * 录音器本身复用跟读页的 `BrowserRecorder`（同一套原声/降噪、设备选择、首尾静音裁剪），
 * 这里只补复读需要的三件事：自动停、低麦判定、卸载时释放麦克风。
 */
export function useRepeatRecorder({ onAutoStop, enabled = true }: UseRepeatRecorderOptions = {}) {
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [lowMic, setLowMic] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [deviceId, setDeviceId] = useLocalStorageState('reader:repeatMic', '', persistentString)
  const [raw, setRaw] = useLocalStorageState('reader:repeatRawMic', true, persistentBoolTrue)

  const recRef = useRef<BrowserRecorder | null>(null)
  const recordingRef = useRef(false)
  const stoppingRef = useRef(false)
  /** 开麦是异步的（可能要等授权）：期间被取消/停止就作废这次 start。 */
  const tokenRef = useRef(0)
  const peakRef = useRef(0)
  const noiseRef = useRef(NOISE_FLOOR_INIT)
  const spokeRef = useRef(false)
  const lastVoiceRef = useRef(0)
  const lastPushRef = useRef(0)
  const autoStopRef = useRef(false)
  const capTimerRef = useRef<number | null>(null)
  const onAutoStopRef = useRef(onAutoStop)
  onAutoStopRef.current = onAutoStop

  const clearCap = () => {
    if (capTimerRef.current != null) {
      window.clearTimeout(capTimerRef.current)
      capTimerRef.current = null
    }
  }

  const refreshDevices = useCallback(() => {
    void listAudioInputs().then(setDevices)
  }, [])

  useEffect(() => {
    if (!enabled) return
    refreshDevices()
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return
    md.addEventListener('devicechange', refreshDevices)
    return () => md.removeEventListener('devicechange', refreshDevices)
  }, [enabled, refreshDevices])

  /** 录音中每帧电平：先更新统计（不受节流影响），再按 25fps 推给界面。 */
  const handleLevel = useCallback((v: number) => {
    if (!recordingRef.current) return
    if (v > peakRef.current) peakRef.current = v
    if (v < noiseRef.current) noiseRef.current = v

    const now = performance.now()
    if (now - lastPushRef.current >= LEVEL_PUSH_MS) {
      lastPushRef.current = now
      setLevel(v)
    }

    const threshold = voiceThreshold(noiseRef.current, VOICE_LEVEL)
    if (v > threshold) {
      spokeRef.current = true
      lastVoiceRef.current = now
      return
    }
    if (autoStopRef.current && spokeRef.current && now - lastVoiceRef.current >= VOICE_HANGOVER_MS) {
      autoStopRef.current = false // 只触发一次；stop 里的异步还没回来时别再排一次
      onAutoStopRef.current?.()
    }
  }, [])

  const start = useCallback(
    async (opts: { capSec: number; autoStop: boolean }): Promise<boolean> => {
      if (recordingRef.current) return true
      setError(null)
      setLowMic(false)
      const token = ++tokenRef.current
      const rec = (recRef.current ??= new BrowserRecorder())
      rec.configure({ raw, deviceId: deviceId || undefined })
      rec.onLevel(handleLevel)
      try {
        await rec.start()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
      // 等授权期间用户已经点了停止/切句：把刚开的麦关掉，别在后台录
      if (token !== tokenRef.current) {
        try {
          await rec.stop()
        } catch {
          // 已经停了：忽略
        }
        return false
      }
      recordingRef.current = true
      setRecording(true)
      void refreshDevices() // 授权后 label 才有名字
      peakRef.current = 0
      noiseRef.current = NOISE_FLOOR_INIT
      spokeRef.current = false
      lastVoiceRef.current = 0
      lastPushRef.current = 0
      autoStopRef.current = opts.autoStop
      clearCap()
      capTimerRef.current = window.setTimeout(() => {
        capTimerRef.current = null
        autoStopRef.current = false
        onAutoStopRef.current?.()
      }, recordCapMs(opts.capSec))
      return true
    },
    [deviceId, handleLevel, raw, refreshDevices],
  )

  const stop = useCallback(async (): Promise<RecordedAudio | null> => {
    tokenRef.current++
    if (!recordingRef.current || stoppingRef.current) return null
    stoppingRef.current = true
    recordingRef.current = false
    autoStopRef.current = false
    clearCap()
    setRecording(false)
    setLevel(0)
    try {
      const data = await recRef.current?.stop()
      if (!data || data.durationSec < MIN_TAKE_SEC) return null
      setLowMic(peakRef.current < LOW_PEAK)
      return data
    } catch (e) {
      setError(`停止录音失败：${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally {
      stoppingRef.current = false
    }
  }, [])

  /** 切句 / 退出时丢弃这次录音，不落库。 */
  const cancel = useCallback(async () => {
    tokenRef.current++
    if (!recordingRef.current) return
    recordingRef.current = false
    autoStopRef.current = false
    clearCap()
    setRecording(false)
    setLevel(0)
    try {
      await recRef.current?.stop()
    } catch {
      // 已经停了 / 设备拔了：忽略
    }
  }, [])

  useEffect(() => {
    return () => {
      clearCap()
      recRef.current?.release()
    }
  }, [])

  return {
    recording,
    level,
    lowMic,
    error,
    devices,
    deviceId,
    setDeviceId,
    raw,
    setRaw,
    start,
    stop,
    cancel,
  }
}
