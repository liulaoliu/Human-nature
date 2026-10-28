import type { Sentence } from '../../types/document'
import { hasModifier, isComposing, isEditableTarget } from '../hotkeys'
import { useHotkeys } from '../useHotkeys'
import { useSpeedReadFlow } from './useSpeedReadFlow'
import { useSpeedReadState } from './useSpeedReadState'

export interface UseSpeedReadSessionOptions {
  sentences: Sentence[]
  /** 文章键（`core/docSignature.articleKey`：标识 + 正文签名），由面板算好传入。 */
  docKey: string
  onClose: () => void
  /** 这篇过完（推到结尾）时回调一次（「读完」目标记一笔）。 */
  onFinishRead?: () => void
  /** 朗读一句（R 键，与面板里的「读本句」共用）。 */
  onSpeak?: (text: string) => void
  /** 语言点编辑器打开时不抢键盘。 */
  langEditorOpen: boolean
  /** 数字 1：切换「选词模式」（阅读页 / 速读页共用同一个状态）。 */
  onToggleVocabMode?: () => void
}

/**
 * 速读会话状态机：逐句计时 → 揭示 → 超时拷打 → 下一句，以及翻句 / 结算 / 快捷键。
 * 只关心「读到哪、处于哪个阶段」，选词与渲染分别在 `useSpeedReadWords` 和面板里。
 *
 * 状态/计时在 `useSpeedReadState`，阶段推进在 `useSpeedReadFlow`；这里只接键盘并返回同形 API。
 */
export function useSpeedReadSession({
  sentences,
  docKey,
  onClose,
  onFinishRead,
  onSpeak,
  langEditorOpen,
  onToggleVocabMode,
}: UseSpeedReadSessionOptions) {
  const state = useSpeedReadState({ sentences, docKey, onFinishRead })
  const { advance, go, chooseDrill, restart, close } = useSpeedReadFlow({ state, onClose })
  const { phase, sentence, drill } = state.api

  useHotkeys(
    (e) => {
      // 正在输入框里打字时，不要触发空格翻页 / 数字选项
      if (langEditorOpen || isComposing(e)) return
      if (isEditableTarget(e.target) || hasModifier(e)) return
      /**
       * 翻页滚动：速读的正文可以很长，只手够鼠标太别扭。
       * W/S 与 ↑/↓/PageUp/PageDown 都走这里 —— **滚的是 `.reader-main`**（真正的滚动容器，
       * 和吸顶吸底同一套口径），不是窗口；没有它才退回 window。
       */
      const scrollPage = (dir: -1 | 1, page: boolean) => {
        const box = document.querySelector<HTMLElement>('.reader-main')
        const step = page ? (box?.clientHeight ?? window.innerHeight) * 0.85 : 120
        if (box) box.scrollBy({ top: dir * step, behavior: 'smooth' })
        else window.scrollBy({ top: dir * step, behavior: 'smooth' })
      }
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.code === 'PageUp') {
        e.preventDefault()
        scrollPage(-1, e.key === 'PageUp' || e.code === 'PageUp')
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.code === 'PageDown') {
        e.preventDefault()
        scrollPage(1, e.key === 'PageDown' || e.code === 'PageDown')
        return
      }
      // 数字 1 = 选词模式（与阅读页一致）；拷打阶段 1–4 是选项，优先给选项。
      if (e.code === 'Digit1' && phase !== 'drill' && onToggleVocabMode) {
        e.preventDefault()
        onToggleVocabMode()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'r' && sentence && onSpeak) {
        e.preventDefault()
        onSpeak(sentence.text)
        return
      }
      // W/S 翻页滚动（W 原本也绑了「上一句」，和 W/S 上下滚的直觉打架，已让出）
      if (k === 'w') {
        e.preventDefault()
        scrollPage(-1, true)
        return
      }
      if (k === 's') {
        e.preventDefault()
        scrollPage(1, true)
        return
      }
      if (k === 'a') {
        e.preventDefault()
        go(-1)
        return
      }
      if (k === 'd') {
        e.preventDefault()
        go(1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (phase === 'drill' && drill) {
        const k = Number(e.key)
        if (k >= 1 && k <= drill.options.length) {
          e.preventDefault()
          chooseDrill(drill.options[k - 1])
          return
        }
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        advance()
      }
    },
    !langEditorOpen,
    25,
  )

  return { ...state.api, advance, go, chooseDrill, restart, close }
}
