import { GRANULARITY_LABEL, type Granularity } from '../core/ports'
import type { SessionState } from '../state/sessionConfig'

const RATES = [0.5, 0.75, 1, 1.5, 2]
const GRANS: Granularity[] = ['short', 'normal', 'long']

/**
 * 播放控制区：上一块 / 播放（连续跟读时变「跟读一轮」）/ 下一块，
 * 外加语速、切块档位、撕开面板开关。
 *
 * 播放按钮的文字是三种状态揉在一起的三元表达式，抽出来单独看会短很多。
 */
export function TransportBar({
  current,
  chunkCount,
  playing,
  autoCycle,
  cycleStep,
  rate,
  granularity,
  splitOpen,
  chunkEditCount,
  onPrev,
  onPlay,
  onNext,
  onRate,
  onGranularity,
  onToggleSplit,
}: {
  current: number
  chunkCount: number
  playing: boolean
  autoCycle: boolean
  cycleStep: SessionState['cycleStep']
  rate: number
  granularity: Granularity
  splitOpen: boolean
  chunkEditCount: number
  onPrev: () => void
  onPlay: () => void
  onNext: () => void
  onRate: (rate: number) => void
  onGranularity: (g: Granularity) => void
  onToggleSplit: () => void
}) {
  const playLabel = autoCycle
    ? cycleStep === 'idle'
      ? '▶ 跟读一轮（空格）'
      : '⏹ 停止本轮（空格）'
    : playing
      ? '⏸ 暂停（空格）'
      : '▶ 标准音（空格）'

  return (
    <>
      <div className="row">
        <button onClick={onPrev} disabled={current === 0} title="上一块（A，或方向键 ↑），并像按空格一样直接跑">
          A ← 上一块
        </button>
        <button className="primary" onClick={onPlay} title="再按一次暂停；暂停后按空格是接着播，不是重头">
          {playLabel}
        </button>
        <button
          onClick={onNext}
          disabled={current === chunkCount - 1}
          title="下一块（D，或方向键 ↓），并像按空格一样直接跑"
        >
          下一块 → D
        </button>
      </div>

      <div className="row">
        <span className="lab">语速</span>
        {RATES.map((r) => (
          <button key={r} className={rate === r ? 'chip on' : 'chip'} onClick={() => onRate(r)}>
            {r}x
          </button>
        ))}
        <span className="lab">切块</span>
        {GRANS.map((g) => (
          <button
            key={g}
            className={granularity === g ? 'chip on' : 'chip'}
            onClick={() => onGranularity(g)}
          >
            {GRANULARITY_LABEL[g]}
          </button>
        ))}
        <button
          className={splitOpen ? 'chip on' : 'chip'}
          onClick={onToggleSplit}
          title="打开波形，把这一大块手动撕成两段（X）"
        >
          撕开 / 微调（X）
        </button>
        {chunkEditCount > 0 && <span className="off">已手动切 {chunkEditCount} 处</span>}
      </div>
    </>
  )
}

/** A/B 对比那行：标准音 → 我的、循环对比、停下、整篇连播。 */
export function AbCompareRow({
  abPlaying,
  onCompare,
  onLoopCompare,
  onStop,
  onPlayWhole,
}: {
  abPlaying: boolean
  onCompare: () => void
  onLoopCompare: () => void
  onStop: () => void
  onPlayWhole: () => void
}) {
  return (
    <div className="row">
      <button onClick={onCompare}>标准 → 我的</button>
      <button onClick={onLoopCompare}>循环对比</button>
      {abPlaying && (
        <button className="warn" onClick={onStop}>
          停下
        </button>
      )}
      <button className="ghost" onClick={onPlayWhole}>
        整篇连播
      </button>
    </div>
  )
}
