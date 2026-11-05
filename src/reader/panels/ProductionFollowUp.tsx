import { useState } from 'react'
import type { ProductionFollowUpItem } from '../hooks/useProductionFollowUp'
import VoiceInputButton from './VoiceInputButton'

export interface ProductionFollowUpProps {
  items: ProductionFollowUpItem[]
  asking: boolean
  error: string
  onAsk: (question: string) => void | Promise<void>
}

/** 批改后的追问框：一问一答留在当前题里，换题自动清空。 */
export default function ProductionFollowUp({ items, asking, error, onAsk }: ProductionFollowUpProps) {
  const [text, setText] = useState('')
  const submit = () => {
    const q = text.trim()
    if (!q) return
    setText('')
    void onAsk(q)
  }
  return (
    <div className="production-followup">
      <b>追问 D老师</b>
      <div className="bar">
        <input
          aria-label="追问 D老师"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="例如：为什么这里必须用 a？还能更自然吗？"
        />
        <VoiceInputButton
          lang="zh-CN"
          label="🎙 语音提问"
          onText={(t) => setText(`${text}${text.trim() ? ' ' : ''}${t}`)}
        />
        <button onClick={submit} disabled={asking || !text.trim()}>
          {asking ? '回答中…' : '问'}
        </button>
      </div>
      {items.map((it, i) => (
        <div key={`${i}-${it.q}`} className="production-followup-item">
          <div className="production-followup-q">问：{it.q}</div>
          <div className="production-followup-a">{it.a}</div>
        </div>
      ))}
      {error && <div className="production-error">{error}</div>}
    </div>
  )
}
