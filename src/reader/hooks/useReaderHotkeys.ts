import type { MutableRefObject } from 'react'
import { useHotkeys } from '../useHotkeys'
import type { useSessionServices } from './useSessionServices'

type HotkeyServices = Pick<ReturnType<typeof useSessionServices>, 'studyQueue' | 'quizQueue' | 'quickQueue'>

interface ReaderHotkeysArgs {
  services: HotkeyServices
  panels: { speedReadOpen: boolean }
  dictQueue: unknown
  langOpen: boolean
  listenOpen: boolean
  backOpen: boolean
  toggleVocabRef: MutableRefObject<() => void>
  navVocabRef: MutableRefObject<(dir: 1 | -1) => void>
}

/**
 * 阅读页全局键盘：W / 数字 1 切换选词模式，A/D 在有生词的句子间跳。
 * 输入框里、全屏会话里、带修饰键时一律不抢。
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
}: ReaderHotkeysArgs) {
  useHotkeys(
    (e) => {
      // 全屏练习/速读/语言点编辑打开时，别抢键盘（它们各有自己的按键）
      if (services.studyQueue || services.quizQueue || services.quickQueue || dictQueue) return
      if (panels.speedReadOpen || listenOpen || backOpen || langOpen) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      // 只认主键盘区的数字 1（小键盘 1 不抢）；W 照旧
      if (k === 'w' || e.code === 'Digit1') toggleVocabRef.current()
      else if (k === 'a') navVocabRef.current(-1)
      else if (k === 'd') navVocabRef.current(1)
    },
    true,
    10,
  )
}
