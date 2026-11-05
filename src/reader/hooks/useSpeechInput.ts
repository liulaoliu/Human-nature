import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechResultLike {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}

interface SpeechEventLike {
  resultIndex: number
  results: ArrayLike<SpeechResultLike>
}

interface SpeechErrorLike {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechEventLike) => void) | null
  onerror: ((event: SpeechErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechCtor = new () => SpeechRecognitionLike

function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechCtor
    webkitSpeechRecognition?: SpeechCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface UseSpeechInputParams {
  lang?: string
  onText: (text: string) => void
}

/**
 * 浏览器语音输入（Web Speech API）。不支持时 `supported=false`，界面应隐藏按钮；
 * 只返回最终结果，不在每次 interim 时改答案，避免把半句话写进输入框。
 */
export function useSpeechInput({ lang = 'en-US', onText }: UseSpeechInputParams) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const supported = !!speechCtor()

  const stop = useCallback(() => {
    recRef.current?.stop()
    recRef.current = null
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = speechCtor()
    if (!Ctor) {
      setError('当前浏览器不支持语音输入，请直接打字')
      return
    }
    if (recRef.current) {
      stop()
      return
    }
    try {
      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = false
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = (event) => {
        const parts: string[] = []
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result?.isFinal) parts.push(result[0]?.transcript ?? '')
        }
        const text = parts.join(' ').trim()
        if (text) onText(text)
      }
      rec.onerror = (event) => {
        if (event.error !== 'aborted') {
          setError(
            event.error === 'not-allowed'
              ? '麦克风权限被拒绝'
              : `语音输入失败：${event.error ?? '未知错误'}`,
          )
        }
        setListening(false)
        recRef.current = null
      }
      rec.onend = () => {
        setListening(false)
        recRef.current = null
      }
      recRef.current = rec
      setError('')
      setListening(true)
      rec.start()
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setListening(false)
      recRef.current = null
    }
  }, [lang, onText, stop])

  useEffect(
    () => () => {
      recRef.current?.abort()
      recRef.current = null
    },
    [],
  )

  return { supported, listening, error, start, stop }
}
