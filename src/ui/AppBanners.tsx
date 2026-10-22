import type { SessionState } from '../state/sessionConfig'

/**
 * 页面顶部的几条提示：通用 notice、麦克风电平过低、解码中、打不开。
 * 只在页面上摆位置，状态仍由 `App` 持有 —— 这里一个 `useState` 都没有。
 */
export function AppBanners({
  notice,
  onDismissNotice,
  lowMic,
  onDismissLowMic,
  status,
  error,
}: {
  notice: string | null
  onDismissNotice: () => void
  lowMic: boolean
  onDismissLowMic: () => void
  status: SessionState['status']
  error: string | null
}) {
  return (
    <>
      {notice && (
        <div className="banner">
          {notice}
          <button className="ghost sm" onClick={onDismissNotice}>
            知道了
          </button>
        </div>
      )}

      {lowMic && (
        <div className="banner">
          麦克风电平很低（录音峰值 &lt; 0.03），录出来会又小又难判定。去系统「声音 → 输入」把这个麦的
          音量 / 增强调大，或在下拉里换一个设备端点（同名设备常有好几个）再试。
          <button className="ghost sm" onClick={onDismissLowMic}>
            知道了
          </button>
        </div>
      )}

      {status === 'loading' && <div className="banner">解码中…</div>}
      {status === 'error' && <div className="banner err">打不开：{error}</div>}
      {error && status === 'ready' && (
        <div className="banner err">
          {error}
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      )}
    </>
  )
}
