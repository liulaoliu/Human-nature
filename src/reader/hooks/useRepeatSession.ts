import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
import {
  REPEAT_IDLE,
  REPEAT_LOOPS,
  REPEAT_RATES,
  loopLabel,
  repeatNext,
  repeatStepLabel,
  type RepeatState,
} from '../../core/repeatCycle'
import { repeatTakeId, type RepeatTake } from '../../core/repeatTake'
import { BrowserPlayer } from '../../adapters/browserAudio'
import { useHotkeys } from '../useHotkeys'
import { isRepeatHotkey } from '../repeatKeys'
import { persistentBoolTrue, persistentNumberIn, useLocalStorageState } from './useLocalStorageState'
import { useRepeatRecorder } from './useRepeatRecorder'
import { useRepeatTakes } from './useRepeatTakes'

export type RepeatMode = 'single' | 'ab' | 'cycle'

export interface UseRepeatSessionOptions {
  /** 复读开关（面板里的「🎧 复读」）。 */
  open: boolean
  sentences: Sentence[]
  index: number
  sentence: Sentence | undefined
  /** 文章标识：录音按它分篇（不要用正文签名，改一句不该让整篇录音作废）。 */
  articleKey: string
  go: (dir: 1 | -1) => void
  /** 关掉复读模式（不关速读）。 */
  onExit: () => void
  playSentence: (text: string, opts?: { onEnd?: () => void; rate?: number }) => void
  stopSpeech: () => void
  warmTexts?: (texts: string[]) => void
  langEditorOpen: boolean
}

/**
 * 速读里的复读会话：播放标准音 / 录音 / 回放 / A-B / 连续跟读。
 *
 * 「当前练哪一句」不归这里管——用速读的 `index` 和 `go`，一套游标两处共用，
 * 复读翻句就是速读翻句，退出再进来进度也一致。
 *
 * 连续跟读用 `core/repeatCycle` 的状态机：步骤一变，下面的 effect 执行对应动作，
 * 不再靠一层层回调串起来（那样最容易出现「停不掉 / 停两次」）。
 */
export function useRepeatSession({
  open,
  sentences,
  index,
  sentence,
  articleKey,
  go,
  onExit,
  playSentence,
  stopSpeech,
  warmTexts,
  langEditorOpen,
}: UseRepeatSessionOptions) {
  const [rate, setRate] = useLocalStorageState('reader:repeatRate', 1, persistentNumberIn(REPEAT_RATES, 1))
  const [loop, setLoop] = useLocalStorageState('reader:repeatLoop', 1, persistentNumberIn(REPEAT_LOOPS, 1))
  const [autoNext, setAutoNext] = useLocalStorageState('reader:repeatAutoNext', true, persistentBoolTrue)
  const [boost, setBoost] = useLocalStorageState('reader:repeatBoost', 1.5, persistentNumberIn([1, 1.5, 2], 1.5))

  const [abLoop, setAbLoop] = useState(false)
  const [playing, setPlaying] = useState<'ref' | 'take' | null>(null)
  const [cycle, setCycle] = useState<RepeatState>(REPEAT_IDLE)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { take, loading: loadingTake, save, remove } = useRepeatTakes({ articleKey, sentence, enabled: open })
  const stopRecRef = useRef<() => Promise<void>>(async () => {})
  const recorder = useRepeatRecorder({ onAutoStop: () => void stopRecRef.current(), enabled: open })

  /** 播放器懒建：复读关着时不起 `<audio>`，也不碰媒体接口（测试/首屏都轻）。 */
  const playerRef = useRef<BrowserPlayer | null>(null)
  const boostRef = useRef(boost)
  boostRef.current = boost
  const getPlayer = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = new BrowserPlayer()
      playerRef.current.setTakeBoost(boostRef.current)
    }
    return playerRef.current
  }, [])

  const sentenceRef = useRef(sentence)
  sentenceRef.current = sentence
  const takeRef = useRef(take)
  takeRef.current = take
  const rateRef = useRef(rate)
  rateRef.current = rate
  const loopRef = useRef(loop)
  loopRef.current = loop
  const autoNextRef = useRef(autoNext)
  autoNextRef.current = autoNext
  const goRef = useRef(go)
  goRef.current = go
  const stopSpeechRef = useRef(stopSpeech)
  stopSpeechRef.current = stopSpeech
  const playSentenceRef = useRef(playSentence)
  playSentenceRef.current = playSentence
  const hasNextRef = useRef(index < sentences.length - 1)
  hasNextRef.current = index < sentences.length - 1
  const modeRef = useRef<RepeatMode>('single')
  const loopLeftRef = useRef(1)
  const cycleRef = useRef(cycle)
  cycleRef.current = cycle
  const advancingRef = useRef(false)

  const stopAudio = useCallback(() => {
    stopSpeechRef.current()
    playerRef.current?.pause()
    // 作废还在路上的 onEnd（浏览器语音 cancel 后可能还会回调一次）
    modeRef.current = 'single'
    setPlaying(null)
  }, [])

  const { cancel: cancelRecording, start: startRecording, stop: stopRecording } = recorder

  const stopAll = useCallback(() => {
    stopAudio()
    void cancelRecording()
    setAbLoop(false)
    modeRef.current = 'single'
    setCycle(REPEAT_IDLE)
  }, [cancelRecording, stopAudio])

  // ── 手动播放（单句 / A-B） ─────────────────────────────────────────
  const playRefOnceRef = useRef<(mode: RepeatMode) => void>(() => {})
  const playTakeRef = useRef<(mode?: RepeatMode) => void>(() => {})

  /** 一次播放结束：A-B 接着放我的；还在循环里就再来一遍；否则停。 */
  const onRefEnd = useCallback(() => {
    if (modeRef.current === 'ab') {
      playTakeRef.current('ab')
      return
    }
    if (loopLeftRef.current > 1) {
      loopLeftRef.current -= 1
      playRefOnceRef.current('single')
      return
    }
    setPlaying(null)
  }, [])

  /** 播一次，不动循环计数（重播走这里，别把计数重置回起点）。 */
  const playRefOnce = useCallback(
    (mode: RepeatMode) => {
      const s = sentenceRef.current
      if (!s) return
      modeRef.current = mode
      setAbLoop(mode === 'ab')
      stopSpeechRef.current()
      getPlayer().pause()
      setPlaying('ref')
      playSentenceRef.current(s.text, { rate: rateRef.current, onEnd: onRefEnd })
    },
    [getPlayer, onRefEnd],
  )
  playRefOnceRef.current = playRefOnce

  const playRef = useCallback(
    (mode: RepeatMode = 'single') => {
      if (cycleRef.current.step !== 'idle') setCycle(REPEAT_IDLE)
      loopLeftRef.current = loopRef.current === 0 ? Infinity : loopRef.current
      playRefOnce(mode)
    },
    [playRefOnce],
  )

  const playTake = useCallback(
    (mode: RepeatMode = 'single') => {
      const t = takeRef.current
      if (!t) return
      modeRef.current = mode
      stopSpeechRef.current()
      setPlaying('take')
      void getPlayer().playTake(t, rateRef.current).then(() => {
        if (modeRef.current === 'ab') {
          playRefOnce('ab')
          return
        }
        setPlaying(null)
      })
    },
    [getPlayer, playRefOnce],
  )
  playTakeRef.current = playTake

  // ── 录音 ───────────────────────────────────────────────────────────
  const startRec = useCallback(async () => {
    const s = sentenceRef.current
    if (!s) return false
    stopSpeechRef.current()
    getPlayer().pause()
    setPlaying(null)
    const words = s.text.trim().split(/\s+/).filter(Boolean).length
    return startRecording({ capSec: Math.max(3, words * 0.6), autoStop: true })
  }, [getPlayer, startRecording])
  const startRecRef = useRef(startRec)
  startRecRef.current = startRec

  const stopRec = useCallback(async () => {
    const inCycle = cycleRef.current.step === 'rec'
    const data = await stopRecording()
    if (!data) {
      if (inCycle) setCycle((c) => repeatNext(c, 'fail', { hasNext: hasNextRef.current }).state)
      return
    }
    const s = sentenceRef.current
    if (!s) return
    const next: RepeatTake = {
      id: repeatTakeId(articleKey, s.id),
      articleKey,
      sentenceId: s.id,
      sentenceText: s.text,
      blob: data.blob,
      mimeType: data.mimeType,
      durationSec: data.durationSec,
      speechFrom: data.speechFrom,
      speechTo: data.speechTo,
      createdAt: Date.now(),
    }
    try {
      await save(next)
      takeRef.current = next
      setSaveError(null)
    } catch (e) {
      setSaveError(`录音保存失败（存储空间可能已满）：${e instanceof Error ? e.message : String(e)}`)
      if (inCycle) setCycle((c) => repeatNext(c, 'fail', { hasNext: hasNextRef.current }).state)
      return
    }
    if (inCycle) setCycle((c) => repeatNext(c, 'recEnd', { hasNext: hasNextRef.current }).state)
  }, [articleKey, save, stopRecording])
  stopRecRef.current = stopRec

  // ── 连续跟读：步骤一变就执行对应动作 ───────────────────────────────
  useEffect(() => {
    if (cycle.step !== 'ref') return
    let alive = true
    modeRef.current = 'cycle'
    loopLeftRef.current = loopRef.current === 0 ? Infinity : loopRef.current
    const play = () => {
      const s = sentenceRef.current
      if (!s || !alive) {
        setCycle(REPEAT_IDLE)
        return
      }
      setPlaying('ref')
      playSentenceRef.current(s.text, {
        rate: rateRef.current,
        onEnd: () => {
          if (!alive) return
          if (loopLeftRef.current > 1) {
            loopLeftRef.current -= 1
            play()
            return
          }
          setCycle((c) => repeatNext(c, 'refEnd', { hasNext: hasNextRef.current }).state)
        },
      })
    }
    play()
    return () => {
      alive = false
      stopSpeechRef.current()
    }
  }, [cycle.step, sentence?.id])

  useEffect(() => {
    if (cycle.step !== 'rec') return
    let alive = true
    void (async () => {
      const ok = await startRecRef.current()
      if (!ok && alive) setCycle((c) => repeatNext(c, 'fail', { hasNext: hasNextRef.current }).state)
    })()
    return () => {
      alive = false
      // 用户刚点连续跟读又立刻停（或切句）时，麦克风可能还在授权中：
      // 这里收掉，别让「已经退出」的会话还在后台录。
      void cancelRecording()
    }
  }, [cancelRecording, cycle.step])

  useEffect(() => {
    if (cycle.step !== 'take') return
    const t = takeRef.current
    if (!t) {
      setCycle(REPEAT_IDLE)
      return
    }
    modeRef.current = 'cycle'
    setPlaying('take')
    void getPlayer().playTake(t, rateRef.current).then(() => {
      setPlaying(null)
      if (cycleRef.current.step !== 'take') return
      const next = repeatNext(cycleRef.current, 'takeEnd', { hasNext: hasNextRef.current })
      if (next.action === 'next') {
        if (!autoNextRef.current) {
          setCycle(REPEAT_IDLE)
          return
        }
        advancingRef.current = true
        goRef.current(1)
      }
      setCycle(next.state)
    })
  }, [cycle.step, getPlayer, take?.id])

  // 切句：停声音、丢未完成的录音；连续跟读自己翻句时不要停。
  // 复读关着时什么都不做，别影响普通速读的 R 朗读。
  useEffect(() => {
    if (!open) return
    if (advancingRef.current) {
      advancingRef.current = false
      return
    }
    stopAudio()
    void cancelRecording()
    setAbLoop(false)
    modeRef.current = 'single'
    setCycle(REPEAT_IDLE)
  }, [cancelRecording, open, sentence?.id, stopAudio])

  // 关面板 / 卸载：把声音和麦克风收掉
  const wasOpenRef = useRef(open)
  useEffect(() => {
    if (wasOpenRef.current && !open) stopAll()
    wasOpenRef.current = open
  }, [open, stopAll])
  useEffect(() => {
    return () => {
      stopSpeechRef.current()
      playerRef.current?.release()
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    playerRef.current?.setTakeBoost(boost)
  }, [boost])

  // 打开复读就预热当前句和后面两句，连播/翻句时少等合成
  useEffect(() => {
    if (!open) return
    warmTexts?.(
      sentences
        .slice(index, index + 3)
        .map((s) => s.text)
        .filter(Boolean),
    )
  }, [open, index, sentences, warmTexts])

  // ── 按钮动作 ───────────────────────────────────────────────────────
  const toggleAb = useCallback(() => {
    if (abLoop) {
      setAbLoop(false)
      stopAudio()
      return
    }
    if (!takeRef.current) return
    playRef('ab')
  }, [abLoop, playRef, stopAudio])

  const toggleCycle = useCallback(() => {
    if (cycleRef.current.step !== 'idle') {
      stopAll()
      return
    }
    setAbLoop(false)
    stopAudio()
    setCycle((c) => repeatNext(c, 'start', { hasNext: hasNextRef.current }).state)
  }, [stopAll, stopAudio])

  const toggleRecord = useCallback(() => {
    if (recorder.recording) {
      void stopRec()
      return
    }
    stopAudio()
    setAbLoop(false)
    setCycle(REPEAT_IDLE)
    void startRec()
  }, [recorder.recording, startRec, stopAudio, stopRec])

  const removeTake = useCallback(() => {
    if (playing === 'take') stopAudio()
    void remove()
  }, [playing, remove, stopAudio])

  const exit = useCallback(() => {
    stopAll()
    onExit()
  }, [onExit, stopAll])

  // ── 键盘：复读开着时接管，速读的处理器看到这些键会让开 ───────────────
  useHotkeys(
    (e) => {
      if (langEditorOpen || !isRepeatHotkey(e)) return
      e.preventDefault()
      const k = e.key.toLowerCase()
      if (k === 'escape') return exit()
      if (k === ' ') {
        if (recorder.recording) return void stopRec()
        if (playing) return stopAudio()
        if (cycleRef.current.step !== 'idle') return stopAll()
        return playRef('single')
      }
      if (k === 'r') return toggleRecord()
      if (k === 'b') return toggleAb()
      if (k === 'c') return toggleCycle()
      if (k === 'arrowleft' || k === 'a') {
        stopAll()
        go(-1)
        return
      }
      if (k === 'arrowright' || k === 'd') {
        stopAll()
        go(1)
      }
    },
    open && !langEditorOpen,
    25,
  )

  return {
    rate,
    setRate,
    rates: REPEAT_RATES,
    loop,
    setLoop,
    loopText: loopLabel(loop),
    autoNext,
    setAutoNext,
    boost,
    setBoost,
    abLoop,
    playing,
    cycleStep: cycle.step,
    cycleLabel: repeatStepLabel(cycle.step),
    cycleOn: cycle.step !== 'idle',
    take,
    loadingTake,
    recording: recorder.recording,
    level: recorder.level,
    lowMic: recorder.lowMic,
    error: saveError ?? recorder.error,
    devices: recorder.devices,
    deviceId: recorder.deviceId,
    setDeviceId: recorder.setDeviceId,
    raw: recorder.raw,
    setRaw: recorder.setRaw,
    playRef,
    playTake,
    toggleAb,
    toggleCycle,
    toggleRecord,
    removeTake,
    stop: stopAll,
    exit,
  }
}

export type RepeatSessionApi = ReturnType<typeof useRepeatSession>
