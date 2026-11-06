import { useEffect, useRef, type ReactNode, type Ref, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ModalShellProps {
  title: string
  onClose: () => void
  children: ReactNode
  panelClassName?: string
  /** 跑批中不允许关（点遮罩/Esc 都无效）。 */
  busy?: boolean
  /** 少数面板自己持有 ref（例如要滚到某处），传进来复用。 */
  panelRef?: RefObject<HTMLDivElement | null>
}

/**
 * 全屏弹层壳：`role="dialog"` + aria-modal + 初始焦点/焦点循环/Esc/关闭还原。
 * 只统一行为，不接管各面板自己的布局和按钮。
 */
export default function ModalShell({
  title,
  onClose,
  children,
  panelClassName = '',
  busy = false,
  panelRef,
}: ModalShellProps) {
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef ?? localRef

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const panel = ref.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()
    return () => prev?.focus?.()
  }, [ref])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (busy) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = ref.current
      if (!panel) return
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!nodes.length) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [busy, onClose, ref])

  return (
    <div className="plan-overlay" onClick={busy ? undefined : onClose}>
      <div
        ref={ref as Ref<HTMLDivElement>}
        className={`plan-panel ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
