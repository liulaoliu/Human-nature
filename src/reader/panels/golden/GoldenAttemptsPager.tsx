import type { GoldenImitationApi } from '../../hooks/useGoldenImitation'

/**
 * 同一题多次批改的翻页：◀ 上一次 / 下一次 ▶，只在有 2 次以上批改时出现。
 *
 * 数据来自 `useGoldenImitation.attempts`（同篇同句/同题同 focus，时间正序）；
 * 翻到历史时下面的批改是**只读**的，点「回到最新」或再交一稿就回到实时视图。
 */
export default function GoldenAttemptsPager({
  imitation,
  className = 'golden-attempts',
}: {
  imitation: GoldenImitationApi
  className?: string
}) {
  const { attempts, viewing, earlier, later, backToLive } = imitation
  if (attempts.length < 2) return null
  const index = viewing ? attempts.indexOf(viewing) : attempts.length - 1
  const shown = attempts[Math.max(0, index)]
  if (!shown) return null
  return (
    <div className={`bar ${className}`}>
      <button onClick={earlier} disabled={index <= 0} title="看更早一次批改">
        ◀ 上一次
      </button>
      <span className="muted">
        第 {index + 1}/{attempts.length} 次批改 · {new Date(shown.at).toLocaleString()}
        {viewing ? '（历史，只读）' : ''}
      </span>
      <button onClick={later} disabled={!viewing} title="看更新一次批改">
        下一次 ▶
      </button>
      {viewing && <button onClick={backToLive}>回到最新</button>}
    </div>
  )
}
