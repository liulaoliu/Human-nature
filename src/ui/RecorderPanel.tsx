/**
 * 录制区两行：录音按钮 + 电平表，以及麦克风/音质/回放放大设置。
 *
 * 全是受控值和回调 —— 采集参数（`raw`/`deviceId`）真正生效是在
 * `App` 的 useEffect 里转交给 store 的，这里只管显示与回传。
 */
export function RecorderPanel({
  recording,
  level,
  micDevice,
  inputs,
  micRaw,
  takeBoost,
  onToggleRecord,
  onMicDevice,
  onMicRaw,
  onTestMic,
  onTakeBoost,
}: {
  recording: boolean
  level: number
  micDevice: string
  inputs: Array<{ deviceId: string; label: string }>
  micRaw: boolean
  takeBoost: number
  onToggleRecord: () => void
  onMicDevice: (deviceId: string) => void
  onMicRaw: (raw: boolean) => void
  onTestMic: () => void
  onTakeBoost: (boost: number) => void
}) {
  return (
    <>
      <div className="row rec">
        <button
          className={recording ? 'rec on' : 'rec'}
          onClick={onToggleRecord}
          title="开始/停止录音；停止后自动回放刚录的这条"
        >
          {recording ? '■ 停止并回放（R）' : '● 录音（R）'}
        </button>
        <div className="meter">
          <div className="bar" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        <span className="lv" title="当前输入电平（峰值）。说话时应明显高于安静时的数">
          {level.toFixed(2)}
        </span>
      </div>

      <div className="row mic">
        <span className="lab">麦克风</span>
        <select
          value={micDevice}
          onChange={(e) => onMicDevice(e.target.value)}
          title="换一个输入设备试试——蓝牙耳麦只有窄带，天生发闷"
        >
          <option value="">系统默认</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="lab">音质</span>
        <button
          className={micRaw ? 'chip on' : 'chip'}
          onClick={() => onMicRaw(true)}
          title="关掉浏览器的降噪 / 回声消除，保真优先（发闷通常就是降噪干的）；自动增益保留，保证音量"
        >
          原声
        </button>
        <button
          className={!micRaw ? 'chip on' : 'chip'}
          onClick={() => onMicRaw(false)}
          title="打开浏览器那套降噪，嘈杂环境用"
        >
          降噪
        </button>
        <button
          className="ghost sm"
          onClick={onTestMic}
          disabled={recording}
          title="录 2.5 秒马上回放，用来对比不同设备/音质。不会占当前块的录音"
        >
          试录 2.5 秒
        </button>
        <span className="lab">回放放大</span>
        <select
          value={String(takeBoost)}
          onChange={(e) => onTakeBoost(Number(e.target.value))}
          title="录音回放的额外音量（在「对齐标准音」之上再乘）。觉得还是小就往大调；太大可能削波"
        >
          <option value="1">不放大</option>
          <option value="1.5">+50%</option>
          <option value="2">+100%</option>
          <option value="3">+200%</option>
          <option value="4">+300%</option>
        </select>
        <span className="lab">
          {micRaw ? '原声（推荐）' : '降噪'} · 蓝牙麦换有线常有奇效
        </span>
      </div>
    </>
  )
}
