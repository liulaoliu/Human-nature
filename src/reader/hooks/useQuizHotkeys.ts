import { useHotkeys } from '../useHotkeys'
import type { QuizQuestion } from '../../core/quiz'

export interface UseQuizHotkeysParams {
  queue: QuizQuestion[] | null
  index: number
  checked: boolean
  spellMiss: unknown
  onEscape: () => void
  onAckSpellMiss: () => void
  onCheck: (answerOverride?: string) => void
  onNext: () => void
  setInput: (value: string) => void
}

/**
 * 考试的快捷键：回车 提交 / 下一题；词形辨析可用 1/2/3 选选项；Esc 退出。
 *
 * 优先级 60 与其它会话一致；`spellMiss` 未确认时回车只做「确认」，不切题。
 */
export function useQuizHotkeys({
  queue,
  index,
  checked,
  spellMiss,
  onEscape,
  onAckSpellMiss,
  onCheck,
  onNext,
  setInput,
}: UseQuizHotkeysParams): void {
  useHotkeys(
    (e) => {
      if (!queue) return
      if (e.key === 'Escape') {
        onEscape()
        return
      }
      const q = queue[index]
      if (e.key === 'Enter') {
        e.preventDefault()
        if (spellMiss) {
          onAckSpellMiss()
          return
        }
        if (index >= queue.length) return
        if (!checked) onCheck()
        else onNext()
        return
      }
      if (q?.options && !checked) {
        const n = Number(e.key)
        if (n >= 1 && n <= q.options.length) {
          e.preventDefault()
          const opt = q.options[n - 1]
          setInput(opt)
          onCheck(opt)
        }
      }
    },
    !!queue,
    60,
  )
}
