/** 常规考试 / 新一轮的通用档位；0 = 全部。 */
export const COMMON_ROUND_OPTIONS = [5, 10, 15, 20, 30, 50, 0] as const

export interface RoundSizeSelectProps {
  value: number
  options: readonly number[]
  onChange: (n: number) => void
  /** 下拉前的说明（如「本次」）。 */
  label?: string
  ariaLabel: string
  /** 数字后面的单位，默认「题」。 */
  unit?: string
  /** 0 显示什么，默认「全部」。 */
  allLabel?: string
  /** 自定义每一档的文字（如听写要显示「每轮 10 题」）。 */
  formatLabel?: (n: number) => string
  disabled?: boolean
  title?: string
}

/**
 * 「本轮多少题 / 多少词」的通用下拉。
 *
 * 不自己持有状态、不决定默认值：各模块传自己的 options 和持久化值；
 * 默认值 / 档位 / 坏数据兜底仍在各自的设置 hook 里。
 *
 * 当前值不在 options 里也照样显示（比如恢复的旧会话是 25 题），不会变成空白。
 */
export default function RoundSizeSelect({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  unit = '题',
  allLabel = '全部',
  formatLabel,
  disabled = false,
  title,
}: RoundSizeSelectProps) {
  const nums = [...new Set([...options, value])].sort((a, b) => {
    if (a === 0) return 1
    if (b === 0) return -1
    return a - b
  })

  return (
    <label className="round-size" title={title}>
      {label && <span className="muted">{label}</span>}
      <select
        aria-label={ariaLabel}
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        {nums.map((n) => (
          <option key={n} value={n}>
            {formatLabel ? formatLabel(n) : n === 0 ? allLabel : `${n} ${unit}`}
          </option>
        ))}
      </select>
    </label>
  )
}
