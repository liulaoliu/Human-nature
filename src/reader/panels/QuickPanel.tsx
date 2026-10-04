import type { VocabItem } from '../../types/document'

export interface QuickPanelProps {
  /** 当前词；为 null 或越界时显示结算。 */
  current: VocabItem | null
  queueLength: number
  index: number
  revealed: boolean
  onClose: () => void
  onReveal: () => void
  onSpeak: (word: string) => void
  onGrade: (known: boolean) => void
  onRestart: () => void
}

/** 快刷：一次一个词，1/← 不认识，2/→ 认识，空格看释义。 */
export default function QuickPanel({
  current,
  queueLength,
  index,
  revealed,
  onClose,
  onReveal,
  onSpeak,
  onGrade,
  onRestart,
}: QuickPanelProps) {
  return (
    <div className="study quick">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <span className="muted">
          {Math.min(index + 1, queueLength)} / {queueLength}
        </span>
        <span className="muted">快刷：1/← 不认识 · 2/→ 认识 · 空格 看释义</span>
      </div>

      {current ? (
        <>
          <div className="study-card quick-card" onClick={onReveal}>
            <div className="study-word">
              {current.word}
              <button
                className="speak"
                onClick={(e) => {
                  e.stopPropagation()
                  onSpeak(current.word)
                }}
                title="朗读"
              >
                🔊
              </button>
            </div>
            {current.phonetic && <div className="study-phon">{current.phonetic}</div>}
            {revealed && (
              <div className="study-back">
                <div className="study-meaning">
                  {current.partOfSpeech && <span className="cell-pos">{current.partOfSpeech} </span>}
                  {current.meaning ?? '（无释义）'}
                </div>
                {current.usage.length > 0 && <div className="muted">{current.usage.join('；')}</div>}
              </div>
            )}
            {!revealed && <div className="muted quick-hint">空格 / 点击 = 看释义</div>}
          </div>
          <div className="bar study-actions">
            <button onClick={() => onGrade(false)}>
              不认识 <kbd>1</kbd>
            </button>
            <button className="primary" onClick={() => onGrade(true)}>
              认识 <kbd>2</kbd>
            </button>
          </div>
        </>
      ) : (
        <div className="study-done">
          <p>快刷完成，共 {queueLength} 个词。</p>
          <div className="bar">
            <button className="primary" onClick={onRestart}>
              再来一轮
            </button>
            <button onClick={onClose}>回到阅读</button>
          </div>
        </div>
      )}
    </div>
  )
}
