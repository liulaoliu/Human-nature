/**
 * 仿写相关 AI 结果的统一粘贴入口：出题 / 批改 / 语言点造句共用一个折叠框。
 *
 * 展开状态由调用方（`useGoldenPasteBox`）统一管理：手动复制提示词后展开，
 * 应用成功后收起；这里只负责渲染和把 summary 的点击回传。
 */
export default function GoldenPasteBox({
  label,
  value,
  onChange,
  onApply,
  placeholder,
  open,
  onOpenChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onApply: () => void
  placeholder: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <details
      className="golden-exam-paste"
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
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
