import { useEffect, useMemo, useState } from 'react'
import {
  clozeParts,
  shuffledWords,
  type ProductionTarget,
} from '../../core/production'

export interface ProductionHintProps {
  mode: 'cloze' | 'reorder'
  model: string
  targets: readonly ProductionTarget[]
  value: string
  onChange: (value: string) => void
  seed: string
}

/**
 * 挖空 / 词序题的交互提示：
 * - 挖空：按目标块切成输入格，填完自动拼回整句（仍可在下面改）；
 * - 词序：点打乱的词往答案里追加，不用手打整句。
 */
export default function ProductionHint({
  mode,
  model,
  targets,
  value,
  onChange,
  seed,
}: ProductionHintProps) {
  const parts = useMemo(() => clozeParts(model, targets), [model, targets])
  const blankCount = parts.filter((p) => p.target).length
  const [values, setValues] = useState<string[]>(() => Array(blankCount).fill(''))

  useEffect(() => {
    setValues(Array(blankCount).fill(''))
  }, [model, blankCount])

  if (mode === 'cloze') {
    let blankIndex = 0
    const apply = (next: string[]) => {
      let i = 0
      const text = parts.map((p) => (p.target ? (next[i++] ?? '_____') : p.text)).join('')
      onChange(text)
    }
    return (
      <div className="production-cloze">
        <b>挖空：</b>
        {parts.map((part, i) => {
          if (!part.target) return <span key={`${i}-text`}>{part.text}</span>
          const index = blankIndex++
          return (
            <input
              key={`${i}-${part.text}`}
              aria-label={`第${index + 1}空`}
              value={values[index] ?? ''}
              onChange={(e) => {
                const next = values.slice()
                next[index] = e.target.value
                setValues(next)
                apply(next)
              }}
              size={Math.max(4, part.text.length)}
            />
          )
        })}
        {!blankCount && <span className="muted">参考句里没有匹配到目标块，按普通写作输入。</span>}
      </div>
    )
  }

  const words = shuffledWords(model, seed)
  const append = (word: string) => onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${word}`)
  return (
    <div className="production-wordbank">
      <b>词序：</b>
      {words.map((word, i) => (
        <button key={`${word}-${i}`} className="production-word" onClick={() => append(word)}>
          {word}
        </button>
      ))}
      <button onClick={() => onChange('')}>清空</button>
    </div>
  )
}
