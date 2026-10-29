import { useState } from 'react'

/**
 * 仿写相关 AI 结果的统一粘贴入口：出题 / 批改 / 语言点造句共用一个折叠框。
 *
 * 默认展开（多数人是「先复制提示词 → 拿结果 → 直接粘回来」），但可以手动收起；
 * 用受控 `open` 而不是裸 `open` 属性：重渲染不会把它弹回去。
 */
export default function GoldenPasteBox({
  label,
  value,
  onChange,
  onApply,
  placeholder,
  defaultOpen = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onApply: () => void
  placeholder: string
  /** 默认是否展开（默认 true） */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      className="golden-exam-paste"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{label}</summary>
      <textarea
        className="study-input"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      <button onClick={onApply} disabled={!value.trim()}>应用</button>
    </details>
  )
}
