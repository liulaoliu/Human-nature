/** 仿写相关 AI 结果的统一粘贴入口：出题 / 批改共用一个折叠框。 */
export default function GoldenPasteBox({
  label,
  value,
  onChange,
  onApply,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onApply: () => void
  placeholder: string
}) {
  return (
    <details className="golden-exam-paste">
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
