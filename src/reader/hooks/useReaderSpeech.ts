import { useMemo } from 'react'
import { buildTtsAccents } from '../../core/ttsVoices'
import type { ReaderDoc } from './useReaderDoc'
import { usePregenerate } from './usePregenerate'
import { useSpeaking } from './useSpeaking'
import { useTtsEngines } from './useTtsEngines'

interface ReaderSpeechArgs {
  doc: ReaderDoc | null
  selectedId: string | null
  ttsVoice: string
  flash: (message: string) => void
}

/**
 * 阅读页的语音栈：引擎探测 → 音色 → 朗读 → 整篇预生成。
 *
 * 这四件事共享 doc / voice / 播放状态，拆在一个 hook 里比散在组合根更好找。
 */
export function useReaderSpeech({ doc, selectedId, ttsVoice, flash }: ReaderSpeechArgs) {
  const ttsEngines = useTtsEngines()
  const ttsAccents = useMemo(() => buildTtsAccents(ttsEngines), [ttsEngines])
  const speaking = useSpeaking({
    doc,
    selectedId,
    voice: ttsVoice,
    onFallback: (reason) => {
      if (reason === 'server') {
        flash('服务端语音连不上，已改用浏览器语音；可在音色里选「离线 · 本地语音」（需安装 Piper）')
      } else if (reason === 'local') {
        flash('本地离线语音失败，已改用浏览器语音；请检查 Piper 是否可用')
      } else {
        flash('浏览器拦了自动播放，已改用浏览器语音（点一下页面再试）')
      }
    },
  })
  const pregenApi = usePregenerate({
    sentences: doc?.sentences ?? null,
    voice: ttsVoice,
  })
  return { ttsEngines, ttsAccents, speaking, pregenApi }
}
