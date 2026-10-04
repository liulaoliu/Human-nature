import { MISTAKE_LABEL, mistakeCounts, type MistakeEntry } from '../../core/mistakes'
import type { ReadyRow } from '../../core/readiness'

export interface SideOverviewProps {
  mistakes: MistakeEntry[]
  readyRows: ReadyRow[]
  /** 按 row.key 找对应的动作按钮（label + run）；没有则不显示按钮。 */
  boardAction: (key: string) => { label: string; run: () => void } | null
  onRetryVocab: () => void
  onRetryListen: () => void
  onRetryDict: () => void
  onClearMistakes: () => void
}

/** 总览 Tab：错题本 + 各能力就绪度仪表盘。 */
export default function SideOverview({
  mistakes,
  readyRows,
  boardAction,
  onRetryVocab,
  onRetryListen,
  onRetryDict,
  onClearMistakes,
}: SideOverviewProps) {
  return (
    <div className="side-sec" data-sec="overview">
      <div className="board">
        {mistakes.length > 0 &&
          (() => {
            const c = mistakeCounts(mistakes)
            const rows: { k: 'vocab' | 'listen' | 'dict'; run: () => void }[] = [
              { k: 'vocab', run: onRetryVocab },
              { k: 'listen', run: onRetryListen },
              { k: 'dict', run: onRetryDict },
            ]
            return (
              <div className="board-group">
                <div className="side-label">错题本（{mistakes.length}）</div>
                {rows.map(({ k, run }) => (
                  <div className="board-row partial" key={k}>
                    <span className="dot" />
                    <div className="board-body">
                      <div className="board-head">
                        <b>{MISTAKE_LABEL[k]}</b>
                        <span className="muted">{c[k]} 条</span>
                      </div>
                    </div>
                    <button className="board-act" onClick={run} disabled={c[k] === 0}>
                      重练
                    </button>
                  </div>
                ))}
                <button className="danger" onClick={onClearMistakes}>
                  清空错题本
                </button>
              </div>
            )
          })()}
        {['读', '词', '听', '写'].map((g) => {
          const rows = readyRows.filter((r) => r.group === g)
          if (!rows.length) return null
          return (
            <div key={g} className="board-group">
              <div className="side-label">{g}</div>
              {rows.map((r) => {
                const action = boardAction(r.key)
                return (
                  <div key={r.key} className={'board-row ' + r.level}>
                    <span className="dot" />
                    <div className="board-body">
                      <div className="board-head">
                        <b>{r.label}</b>
                        <span className="muted">{r.detail}</span>
                      </div>
                      {r.hint && <div className="board-hint">{r.hint}</div>}
                    </div>
                    {action && (
                      <button className="board-act" onClick={action.run}>
                        {action.label}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
