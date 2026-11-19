import type { MutableRefObject } from 'react'
import { nextSpeakToggle } from '../../core/speakToggle'
import { hasModifier, isComposing, isEditableTarget } from '../hotkeys'
import { useHotkeys } from '../useHotkeys'
import type { useSessionServices } from './useSessionServices'
import type { useSpeaking } from './useSpeaking'

type HotkeyServices = Pick<ReturnType<typeof useSessionServices>, 'studyQueue' | 'quizQueue' | 'quickQueue'>
/** 只用到朗读栈的这几个口子（和工具栏「读本句」同一个 speak / stopReadAll）。 */
type HotkeySpeech = Pick<
  ReturnType<typeof useSpeaking>,
  'speak' | 'stopReadAll' | 'ttsState' | 'nowPlaying' | 'readingAll'
>

interface ReaderHotkeysArgs {
  services: HotkeyServices
  panels: { speedReadOpen: boolean }
  dictQueue: unknown
  langOpen: boolean
  listenOpen: boolean
  backOpen: boolean
  toggleVocabRef: MutableRefObject<() => void>
  navVocabRef: MutableRefObject<(dir: 1 | -1) => void>
  /** 朗读栈（R 键与工具栏「读本句」复用同一套播放入口）。 */
  speech: HotkeySpeech
  /** 当前选中句的文本；没有选中句时 R 不动当前播放。 */
  sentenceText: string | null
}

/**
 * 阅读页全局键盘：W / 数字 1 切换选词模式，A/D 在有生词的句子间跳，
 * R 读选中句（再按停止，再按从头读）。输入框里、全屏会话里、带修饰键时一律不抢。
 */
export function useReaderHotkeys({
  services,
  panels,
  dictQueue,
  langOpen,
  listenOpen,
  backOpen,
  toggleVocabRef,
  navVocabRef,
  speech,
  sentenceText,
}: ReaderHotkeysArgs) {
  useHotkeys(
    (e) => {
      // 全屏练习/速读/语言点编辑打开时，别抢键盘（它们各有自己的按键）
      if (services.studyQueue || services.quizQueue || services.quickQueue || dictQueue) return
      if (panels.speedReadOpen || listenOpen || backOpen || langOpen) return
      if (isComposing(e) || hasModifier(e) || isEditableTarget(e.target)) return
      const k = e.key.toLowerCase()
      // 只认主键盘区的数字 1（小键盘 1 不抢）；W 照旧
      if (k === 'w' || e.code === 'Digit1') toggleVocabRef.current()
      else if (k === 'a') navVocabRef.current(-1)
      else if (k === 'd') navVocabRef.current(1)
      else if (k === 'r') {
        const action = nextSpeakToggle({
          text: sentenceText,
          playingText: speech.nowPlaying?.text,
          state: speech.ttsState,
          readingAll: speech.readingAll,
        })
        if (action?.type === 'stop') speech.stopReadAll()
        else if (action) speech.speak(action.text)
      }
    },
    true,
    10,
  )
}
