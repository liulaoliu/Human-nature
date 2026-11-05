import RoundSizeSelect from './RoundSizeSelect'

export interface RoundStartPromptProps {
  title: string
  hint?: string
  value: number
  options: readonly number[]
  onChange: (n: number) => void
  onStart: () => void
  onCancel: () => void
  startLabel?: string
  disabled?: boolean
  unit?: string
  allLabel?: string
  ariaLabel?: string
}

/**
 * 开始一轮之前的「数量确认条」：标题 + 题数下拉 + 开始 / 取消。
 *
 * 精读七种拷打、考试结算页「再来一轮」共用同一套交互；
 * 各模块只负责「用户确认后怎么开」，不各自再拼一遍下拉和按钮。
 */
export default function RoundStartPrompt({
  title,
  hint,
  value,
  options,
  onChange,
  onStart,
  onCancel,
  startLabel = '开始',
  disabled = false,
  unit,
  allLabel,
  ariaLabel,
}: RoundStartPromptProps) {
  return (
    <div className="round-start" role="group" aria-label={ariaLabel ?? title}>
      <b>{title}</b>
      {hint && <span className="muted">{hint}</span>}
      <RoundSizeSelect
        label="本次"
        ariaLabel={ariaLabel ? `${ariaLabel}每次题数` : `${title}每次题数`}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        unit={unit}
        allLabel={allLabel}
      />
      <button className="primary" onClick={onStart} disabled={disabled}>
        {startLabel}
      </button>
      <button onClick={onCancel}>取消</button>
    </div>
  )
}
