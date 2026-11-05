import { useSpeechInput } from '../hooks/useSpeechInput'

export interface VoiceInputButtonProps {
  lang: string
  onText: (text: string) => void
  label?: string
}

/** 语音输入按钮；不支持的浏览器直接隐藏，不占位置。 */
export default function VoiceInputButton({ lang, onText, label = '🎙 语音输入' }: VoiceInputButtonProps) {
  const speech = useSpeechInput({ lang, onText })
  if (!speech.supported) return null
  return (
    <span className="voice-input">
      <button
        type="button"
        className={speech.listening ? 'voice-listening' : undefined}
        onClick={speech.listening ? speech.stop : speech.start}
        title={speech.error || '用麦克风输入；只写最终识别结果'}
      >
        {speech.listening ? '⏹ 停止听写' : label}
      </button>
      {speech.error && <span className="muted voice-error">{speech.error}</span>}
    </span>
  )
}
