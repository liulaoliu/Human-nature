import type { SessionState } from '../state/sessionConfig'

/**
 * 「连续跟读」那一行：开关 + 说完静音多久算读完 + 这一轮走到哪一步了。
 *
 * `hangoverMs` 是本机偏好（下拉框选中的值），`activeHangoverMs` 是 store 里
 * 正在生效的值 —— 两者短暂不同步是正常的，别合成一个。
 */
export function CycleRow({
  autoCycle,
  hangoverMs,
  activeHangoverMs,
  autoRecordMs,
  cycleStep,
  onToggle,
  onHangover,
}: {
  autoCycle: boolean
  hangoverMs: number
  activeHangoverMs: number
  autoRecordMs: number
  cycleStep: SessionState['cycleStep']
  onToggle: (on: boolean) => void
  onHangover: (ms: number) => void
}) {
  return (
    <div className="row">
      <label className="check" title="一圈下来：标准音 → 自动录音 → 自动回放。手动录音按 R 停录后也会自动回放">
        <input type="checkbox" checked={autoCycle} onChange={(e) => onToggle(e.target.checked)} />
        连续跟读（标准音 → 录音 → 回放）
      </label>
      {autoCycle && (
        <>
          <span className="lab">说完静音</span>
          <select
            value={String(hangoverMs)}
            onChange={(e) => onHangover(Number(e.target.value))}
            title="连续跟读里，说完之后静多久算「读完」并自动进回放。读得慢、句中有停顿就调长"
          >
            <option value="1600">1.6s</option>
            <option value="2500">2.5s</option>
            <option value="4000">4s</option>
            <option value="6000">6s</option>
          </select>
          <span className="lab">算读完</span>
        </>
      )}
      {autoCycle && cycleStep === 'rec' && (
        <span className="lab">
          录音中 · 说完停 {(activeHangoverMs / 1000).toFixed(1)} 秒自动结束（最长{' '}
          {Math.round(autoRecordMs / 1000)} 秒），按空格或 R 直接结束并回放
        </span>
      )}
      {autoCycle && cycleStep === 'ref' && <span className="lab">正在放标准音…</span>}
      {autoCycle && cycleStep === 'playback' && <span className="lab">回放中（我的录音）…</span>}
    </div>
  )
}
