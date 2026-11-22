import type { Sentence } from '../../types/document'
import type { RepeatSessionApi } from '../hooks/useRepeatSession'
import { loopLabel } from '../../core/repeatCycle'

export interface SpeedRepeatPanelProps {
  api: RepeatSessionApi
  sentence: Sentence | undefined
  index: number
  total: number
  ttsState: 'idle' | 'loading' | 'playing'
  onPrev: () => void
  onNext: () => void
}

/**
 * 速读右侧的复读控制列：标准音 / 语速 / 循环 / 录音 / 连续跟读。
 *
 * 纯展示：状态与动作都在 `useRepeatSession`，这里只把视图模型摊成按钮。
 * 当前句不在这里选——翻句走速读的 `go`，一套游标两处共用。
 *
 * 录音只有「录」一个状态：每按一次就重新录一条、覆盖这一句的上一次录音；
 * 不做 A/B 和删除（再录一遍就是最直接的「删掉重来」）。
 */
export default function SpeedRepeatPanel({
  api,
  sentence,
  index,
  total,
  ttsState,
  onPrev,
  onNext,
}: SpeedRepeatPanelProps) {
  const busy = api.playing === 'ref' && ttsState === 'loading'
  const refLabel = api.playing === 'ref' ? (busy ? '合成中…' : '■ 停止') : '▶ 标准音'

  return (
    <aside className="speed-repeat" aria-label="复读">
      <div className="speed-repeat-head">
        <b>🎧 复读</b>
        <button onClick={api.exit} title="退出复读模式（Esc）；速读本身不关">
          关闭
        </button>
      </div>

      <div className="speed-repeat-nav">
        <button onClick={onPrev} disabled={index <= 0} title="上一句（A / ←）">
          ‹
        </button>
        <span className="muted">
          第 {Math.min(index + 1, total)} / {total} 句
        </span>
        <button onClick={onNext} disabled={index >= total - 1} title="下一句（D / →）">
          ›
        </button>
      </div>

      <div className="speed-repeat-row">
        <button
          className={api.playing === 'ref' ? 'primary' : ''}
          onClick={() => (api.playing === 'ref' ? api.stop() : api.playRef())}
          disabled={!sentence}
          title="播放这一句的 TTS 标准音（空格）"
        >
          {refLabel}
        </button>
        <button onClick={api.stop} disabled={!api.playing && !api.recording} title="停止播放/录音">
          ■
        </button>
      </div>

      <div className="speed-repeat-row">
        <label className="check-inline" title="标准音和我的录音都用这个语速">
          语速
          <select value={String(api.rate)} onChange={(e) => api.setRate(Number(e.target.value))}>
            {api.rates.map((r) => (
              <option key={r} value={String(r)}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <label className="check-inline" title="标准音连听几遍；「不限」要手动停">
          循环
          <select value={String(api.loop)} onChange={(e) => api.setLoop(Number(e.target.value))}>
            {[1, 3, 5, 0].map((n) => (
              <option key={n} value={String(n)}>
                {loopLabel(n)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="speed-repeat-sep" />

      <button
        className={'speed-rec' + (api.recording ? ' danger' : '')}
        onClick={api.toggleRecord}
        disabled={!sentence}
        title="录这一句（R）；读完停一下自动结束；再按一次会覆盖上一次录音"
      >
        {api.recording ? '■ 停止录音' : '● 录音'}
      </button>
      <div className="speed-level" title="输入电平">
        <div style={{ width: `${Math.min(100, Math.round(api.level * 400))}%` }} />
      </div>
      {api.lowMic && <div className="speed-repeat-hint">麦克风声音偏小：把系统输入音量调大，或换个麦</div>}

      {api.take ? (
        <div className="speed-repeat-row">
          <button onClick={() => api.playTake()} title="回放我这一句（空格停止）">
            ▶ 我的
          </button>
          <span className="muted">
            {api.take.durationSec.toFixed(1)}s ·{' '}
            {new Date(api.take.createdAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>
      ) : (
        <div className="speed-repeat-hint">{api.loadingTake ? '读取录音…' : '这一句还没有录音'}</div>
      )}

      <div className="speed-repeat-sep" />

      <button
        className={'speed-cycle' + (api.cycleOn ? ' primary' : '')}
        onClick={api.toggleCycle}
        disabled={!sentence}
        title="标准音 → 录音 → 回放 → 下一句（C）"
      >
        {api.cycleOn ? '■ 停止连续跟读' : '▶ 连续跟读'}
      </button>
      {api.cycleLabel && <div className="speed-repeat-hint">{api.cycleLabel}</div>}
      <label className="check-inline" title="回放完自动翻到下一句；关掉就停在这一句">
        <input type="checkbox" checked={api.autoNext} onChange={(e) => api.setAutoNext(e.target.checked)} />
        回放完自动下一句
      </label>

      <details className="speed-repeat-settings">
        <summary>录音设置</summary>
        <label className="check-inline" title="换麦是排查「发闷」最快的一步">
          麦克风
          <select value={api.deviceId} onChange={(e) => api.setDeviceId(e.target.value)}>
            <option value="">系统默认</option>
            {api.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-inline" title="关掉浏览器的降噪/回声消除，音色更真；嘈杂环境可以取消">
          <input type="checkbox" checked={api.raw} onChange={(e) => api.setRaw(e.target.checked)} />
          原声（关降噪）
        </label>
        <label className="check-inline" title="录音回放的额外放大（在响度对齐之后再乘）">
          回放音量
          <select value={String(api.boost)} onChange={(e) => api.setBoost(Number(e.target.value))}>
            {[1, 1.5, 2].map((v) => (
              <option key={v} value={String(v)}>
                {v}×
              </option>
            ))}
          </select>
        </label>
      </details>

      {api.error && <div className="speed-banner">{api.error}</div>}
      <div className="speed-repeat-keys muted">
        空格 播放/停 · R 录音 · C 连读 · Esc 退出复读
      </div>
    </aside>
  )
}
