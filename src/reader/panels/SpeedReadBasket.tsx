/** 「本页加入」清单里的一项：词/词组 + 来源句（跨句累积、持久化）。 */
export interface CollectedItem {
  word: string
  sentenceId: string | null
  sentenceText: string
}

export interface SpeedReadBasketProps {
  collected: CollectedItem[]
  collectedOpen: boolean
  showCollected: boolean
  confirmIdx: number | null
  onToggleOpen: () => void
  onShowChange: (show: boolean) => void
  onTapDelete: (i: number) => void
}

/** 速读右上角「本页加入」清单：折叠 / 显示已加入 / 两步删除。 */
export default function SpeedReadBasket({
  collected,
  collectedOpen,
  showCollected,
  confirmIdx,
  onToggleOpen,
  onShowChange,
  onTapDelete,
}: SpeedReadBasketProps) {
  if (!collected.length) return null
  return (
    <div className={'speed-basket-panel' + (collectedOpen ? '' : ' collapsed')}>
      <div className="speed-basket-head">
        <b>本页加入（{collected.length}）</b>
        <label className="check-inline" title="开=显示已加入生词本的单词；关=列表显示为空">
          <input type="checkbox" checked={showCollected} onChange={(e) => onShowChange(e.target.checked)} />
          显示已加入
        </label>
        <button onClick={onToggleOpen} title={collectedOpen ? '折叠清单' : '展开清单'}>
          {collectedOpen ? '▾ 折叠' : '▸ 展开'}
        </button>
      </div>
      <div className="speed-basket-body">
        {showCollected ? (
          <div className="speed-basket-list">
            {collected.map((it, i) => (
              <div className="speed-basket-row" key={`${it.sentenceId}|${it.word}|${i}`}>
                <span className="speed-basket-word">{it.word}</span>
                {it.sentenceText && (
                  <span className="muted ellipsis" title={it.sentenceText}>
                    {it.sentenceText}
                  </span>
                )}
                <button
                  className={confirmIdx === i ? 'danger' : ''}
                  onClick={() => onTapDelete(i)}
                  title={confirmIdx === i ? '再点一次确认移出（两步确认）' : '从生词本移出（剔除误加）'}
                  aria-label={confirmIdx === i ? `确认移出 ${it.word}` : `从生词本移出 ${it.word}`}
                >
                  {confirmIdx === i ? '确认删除' : '删除'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted speed-basket-empty">已加入的单词已隐藏（勾选「显示已加入」查看）</div>
        )}
      </div>
    </div>
  )
}

export interface SpeedReadDoneProps {
  summary: { count: number; avgWpm: number; slow: number; drillTotal: number; drillCorrect: number }
  onRestart: () => void
  onClose: () => void
}

/** 速读结算：读完句数 / 平均速度 / 拷打正确率 + 再来一遍。 */
export function SpeedReadDone({ summary, onRestart, onClose }: SpeedReadDoneProps) {
  return (
    <div className="study-done speed-summary">
      <p>
        读完 <b>{summary.count}</b> 句 · 平均 <b>{summary.avgWpm}</b> 词/分 · 超时 <b>{summary.slow}</b> 句
        {summary.drillTotal > 0 ? ` · 拷打对 ${summary.drillCorrect}/${summary.drillTotal}` : ''}
      </p>
      <div className="bar">
        <button className="primary" onClick={onRestart}>
          再来一遍
        </button>
        <button onClick={onClose}>回到阅读</button>
      </div>
    </div>
  )
}
