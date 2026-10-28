import type { MutableRefObject } from 'react'

/**
 * 浏览器语音兜底：播一段文本，结束/失败都回调。
 * 放在普通函数里，避免 `useTtsMedia` 为了这一个动作再包一层 useCallback。
 */
export function playBrowserSpeech({
  utterRef,
  setState,
  text,
  onEnd,
  rate = 1,
}: {
  utterRef: MutableRefObject<SpeechSynthesisUtterance | null>
  setState: (state: 'idle' | 'playing') => void
  text: string
  onEnd?: () => void
  rate?: number
}): void {
  try {
    if (typeof speechSynthesis === 'undefined') {
      onEnd?.()
      return
    }
    speechSynthesis.cancel()
    if (speechSynthesis.paused) speechSynthesis.resume()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = rate
    u.onstart = () => {
      if (utterRef.current === u) setState('playing')
    }
    u.onend = () => {
      if (utterRef.current === u) {
        utterRef.current = null
        setState('idle')
        onEnd?.()
      }
    }
    u.onerror = () => {
      if (utterRef.current === u) {
        utterRef.current = null
        setState('idle')
        onEnd?.()
      }
    }
    utterRef.current = u
    speechSynthesis.speak(u)
  } catch {
    onEnd?.()
  }
}
