import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findQuietestSec } from '../core/chunkEdits'
import type { Chunk } from '../core/ports'

/**
 * 当前块的波形 + 刀口编辑器（像音频剪辑软件那样用）。
 *
 * 交互：
 * - 波形可以**左右拖动**，Ctrl+滚轮缩放（看长块里的细节）；
 * - **点一下就从那儿放声音**（不是只画条线），再点别处就从新位置放；
 * - 试听长度可调：1s / 2s / 5s / 到块尾，勾「循环」就一直放，手动停；
 * - 快捷键：空格 从播放头播放/暂停 · Enter 在播放头**撕开** ·
 *   ← → 播放头 ±10ms（Shift ±50ms）· Esc 收起。
 *
 * 刀口默认落在这块最安静处（气口），随便拖。
 */

const PREVIEW_OPTIONS = [1, 2, 5, 0] as const // 0 = 到块尾
const MIN_VIEW_SEC = 0.2
const CANVAS_H = 120

interface Columns {
  lo: Float32Array
  hi: Float32Array
  peak: number
}

/**
 * 把可视区间降采样成「每像素的 min/max」。用 useMemo 缓存，
 * 只在视图/宽度/音频变了时重扫一次。
 */
function useColumns(
  samples: Float32Array,
  sampleRate: number,
  viewStart: number,
  viewLen: number,
  width: number,
): Columns | null {
  return useMemo(() => {
    if (samples.length === 0 || sampleRate <= 0) return null
    const a = Math.max(0, Math.floor(viewStart * sampleRate))
    const b = Math.min(samples.length, Math.ceil((viewStart + viewLen) * sampleRate))
    if (b <= a) return null

    const lo = new Float32Array(width)
    const hi = new Float32Array(width)
    const perPx = Math.max(1, Math.floor((b - a) / width))
    let peak = 0
    for (let x = 0; x < width; x++) {
      const from = a + x * perPx
      const to = Math.min(b, from + perPx)
      let l = 0
      let h = 0
      for (let i = from; i < to; i++) {
        const v = samples[i]
        if (v < l) l = v
        if (v > h) h = v
      }
      lo[x] = l
      hi[x] = h
      const abs = Math.max(Math.abs(l), Math.abs(h))
      if (abs > peak) peak = abs
    }
    return { lo, hi, peak }
  }, [samples, sampleRate, viewStart, viewLen, width])
}

export function ChunkSplitter({
  samples,
  sampleRate,
  chunk,
  editCount,
  canMergeNext,
  onAudition,
  onStop,
  getPosition,
  onSplit,
  onMergeNext,
  onReset,
  onClose,
}: {
  samples: Float32Array
  sampleRate: number
  chunk: Chunk
  editCount: number
  canMergeNext: boolean
  onAudition: (start: number, end: number) => Promise<void>
  onStop: () => void
  getPosition: () => number
  onSplit: (at: number) => void
  onMergeNext: () => void
  onReset: () => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)

  const chunkLen = Math.max(MIN_VIEW_SEC, chunk.end - chunk.start)
  const [viewStart, setViewStart] = useState(chunk.start)
  const [viewLen, setViewLen] = useState(chunkLen)
  const [head, setHead] = useState(() => findQuietestSec(samples, sampleRate, chunk.start, chunk.end))
  const [previewLen, setPreviewLen] = useState<number>(2)
  const [loop, setLoop] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  const playingRef = useRef(false)
  const tokenRef = useRef(0)
  const dragRef = useRef<{ startX: number; startView: number; moved: boolean } | null>(null)
  // App 每次渲染都会传新的箭头函数，直接进 deps 会让 effect 每帧重跑（甚至停掉播放）。
  // 统一放 ref 里取最新值。
  const cbs = useRef({ onAudition, onStop, getPosition })
  useEffect(() => {
    cbs.current = { onAudition, onStop, getPosition }
  })

  const zoomed = viewLen < chunkLen - 1e-6

  // 换块：视图和播放头都归位；顺手把还在放的试听停掉（否则换了块声音还在跑）
  useEffect(() => {
    setViewStart(chunk.start)
    setViewLen(Math.max(MIN_VIEW_SEC, chunk.end - chunk.start))
    setHead(findQuietestSec(samples, sampleRate, chunk.start, chunk.end))
    tokenRef.current++
    playingRef.current = false
    setPlaying(false)
    setProgress(null)
    cbs.current.onStop()
    // cbs 是 ref，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, sampleRate, chunk.start, chunk.end])

  // 容器宽度。注意：canvas 的显示尺寸完全由 CSS 决定（width:100% / 固定高），
  // 这里只拿它当**绘制缓冲**的尺寸依据 —— 不然 buffer 又会影响布局，越画越宽。
  // 量 canvas 自己的宽度（不是外层，外层含 padding）。
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(240, el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- 视图边界 ----
  const clampStart = useCallback(
    (s: number) => Math.min(Math.max(s, chunk.start), Math.max(chunk.start, chunk.end - viewLen)),
    [chunk.start, chunk.end, viewLen],
  )
  const setView = useCallback(
    (start: number, len: number) => {
      const l = Math.min(Math.max(len, MIN_VIEW_SEC), chunkLen)
      setViewLen(l)
      setViewStart(Math.min(Math.max(start, chunk.start), Math.max(chunk.start, chunk.end - l)))
    },
    [chunk.start, chunk.end, chunkLen],
  )

  // 这两个要稳定引用：draw 依赖它们，放进 deps 才不会每次渲染都重画
  const timeAtRatio = useCallback(
    (r: number) => viewStart + Math.min(1, Math.max(0, r)) * viewLen,
    [viewStart, viewLen],
  )
  const ratioAtTime = useCallback((t: number) => (t - viewStart) / viewLen, [viewStart, viewLen])

  // ---- 播放 ----
  const stop = useCallback(() => {
    tokenRef.current++
    playingRef.current = false
    setPlaying(false)
    setProgress(null)
    cbs.current.onStop()
  }, [])

  const playFrom = useCallback(
    async (at: number) => {
      const end = previewLen <= 0 ? chunk.end : Math.min(chunk.end, at + previewLen)
      if (end - at < 0.05) return
      const token = ++tokenRef.current
      playingRef.current = true
      setPlaying(true)
      setProgress(at)
      do {
        cbs.current.onStop()
        await cbs.current.onAudition(at, end)
        // 播完这一段；循环且没被打断就接着放
      } while (playingRef.current && token === tokenRef.current && loop)
      if (token === tokenRef.current) {
        playingRef.current = false
        setPlaying(false)
        setProgress(null)
      }
    },
    [chunk.end, previewLen, loop],
  )

  // 播放时让进度线跟着走；必要时把视图带过去（缩放过才需要）
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const p = cbs.current.getPosition()
      setProgress(p)
      if (viewLen < chunkLen - 1e-6 && p > viewStart + viewLen * 0.85) {
        setViewStart(Math.min(Math.max(p - viewLen * 0.35, chunk.start), chunk.end - viewLen))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, viewLen, chunkLen, viewStart, chunk.start, chunk.end])

  // 收起时把声音停掉，并且让还在 await 的循环别再重启
  useEffect(
    () => () => {
      tokenRef.current++
      playingRef.current = false
      cbs.current.onStop()
    },
    [],
  )

  // 波形本身：只在「视图/宽度/音频」变了时重扫。播放头/进度线在 draw 里叠加。
  const cols = useColumns(samples, sampleRate, viewStart, viewLen, width)

  // ---- 绘制 ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    // buffer 只在尺寸真的变了时才重设：重设会清空画布内容。
    const bufW = Math.round(width * dpr)
    const bufH = Math.round(CANVAS_H * dpr)
    if (canvas.width !== bufW) canvas.width = bufW
    if (canvas.height !== bufH) canvas.height = bufH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, CANVAS_H)

    ctx.fillStyle = '#0e1014'
    ctx.fillRect(0, 0, width, CANVAS_H)

    // 每像素的 min/max 来自 useColumns：只在视图/宽度变了时重扫。
    // 播放时 progress 每帧变、视图不动 —— 直接重扫的话每帧要扫可视范围内的
    // 全部采样（缩放到整块时 ~100 万次），而波形本身一次都没变。
    if (!cols) {
      ctx.fillStyle = '#8b93a1'
      ctx.font = '12px system-ui'
      ctx.fillText('这段没有可用的采样', 10, CANVAS_H / 2)
      return
    }
    const { lo, hi, peak } = cols
    const gain = peak > 0 ? 0.92 / peak : 1

    const mid = CANVAS_H / 2
    // 播放头左侧淡淡压暗，当"已经过"的提示
    const headX = ratioAtTime(head) * width
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
    ctx.fillRect(0, 0, Math.max(0, Math.min(width, headX)), CANVAS_H)

    ctx.fillStyle = '#4a9eff'
    for (let x = 0; x < width; x++) {
      const y1 = mid - hi[x] * gain * (mid - 5)
      const y2 = mid - lo[x] * gain * (mid - 5)
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1))
    }

    ctx.strokeStyle = 'rgba(139, 147, 161, 0.35)'
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(width, mid)
    ctx.stroke()

    // 播放进度（绿）
    if (progress != null && playing) {
      const px = ratioAtTime(progress) * width
      if (px >= 0 && px <= width) {
        ctx.strokeStyle = '#35c98a'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, CANVAS_H)
        ctx.stroke()
      }
    }

    // 播放头 / 刀口（黄）
    ctx.strokeStyle = '#ffd23f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(headX, 0)
    ctx.lineTo(headX, CANVAS_H)
    ctx.stroke()
    ctx.fillStyle = '#ffd23f'
    ctx.beginPath()
    ctx.moveTo(headX - 5, 0)
    ctx.lineTo(headX + 5, 0)
    ctx.lineTo(headX, 8)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#ffd23f'
    ctx.font = '11px system-ui'
    const label = fmtRel(head - chunk.start)
    const tw = ctx.measureText(label).width
    const lx = Math.min(width - tw - 4, Math.max(4, headX + 6))
    ctx.fillText(label, lx, 16)
  }, [cols, width, head, progress, playing, chunk.start, ratioAtTime])

  useEffect(() => {
    draw()
  }, [draw])

  // ---- 鼠标 ----
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startView: viewStart, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d || !zoomed) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 3) d.moved = true
    if (d.moved) {
      const rect = e.currentTarget.getBoundingClientRect()
      const secPerPx = viewLen / Math.max(1, rect.width)
      setViewStart(clampStart(d.startView - dx * secPerPx))
    }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.moved && zoomed) return // 刚才是拖动视图，不是点播放
    const rect = e.currentTarget.getBoundingClientRect()
    const at = timeAtRatio((e.clientX - rect.left) / Math.max(1, rect.width))
    setHead(at)
    void playFrom(at)
  }

  // 滚轮：左右平移；Ctrl/⌘ + 滚轮缩放（以鼠标为锚）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const cx = (e.clientX - rect.left) / Math.max(1, rect.width)
        const anchor = viewStart + cx * viewLen
        const next = Math.min(chunkLen, Math.max(MIN_VIEW_SEC, viewLen * (e.deltaY > 0 ? 1.25 : 0.8)))
        setView(anchor - cx * next, next)
      } else {
        const secPerPx = viewLen / Math.max(1, rect.width)
        const step = (e.deltaY + e.deltaX) * secPerPx * 2
        setViewStart((s) => clampStart(s + step))
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [viewStart, viewLen, chunkLen, clampStart, setView])

  // 快捷键（捕获阶段，抢在 App 的全局键之前；只处理自己这几个键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(t.tagName)) return
      if (e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        if (playingRef.current) stop()
        else void playFrom(head)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onSplit(head)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        const step = (e.shiftKey ? 50 : 10) / 1000
        setHead((h) => Math.min(chunk.end - 0.02, Math.max(chunk.start + 0.02, h + (e.key === 'ArrowLeft' ? -step : step))))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [head, playing, chunk.start, chunk.end, playFrom, stop, onSplit, onClose])

  const nudgeHead = (ms: number) =>
    setHead((h) => Math.min(chunk.end - 0.02, Math.max(chunk.start + 0.02, h + ms / 1000)))

  const zoomBy = (factor: number) => {
    const next = Math.min(chunkLen, Math.max(MIN_VIEW_SEC, viewLen * factor))
    const cx = ratioAtTime(head)
    setView(head - cx * next, next)
  }

  const sliderMax = Math.max(1e-6, chunkLen - viewLen)

  return (
    <div className="splitter" ref={wrapRef}>
      <div className="split-head">
        <b>撕开第 {chunk.index + 1} 块</b>
        <span className="lab">
          {fmtRel(chunk.start)} – {fmtRel(chunk.end)}（{chunkLen.toFixed(2)}s）
        </span>
        <span className="grow" />
        <span className="lab">视图 {(viewLen).toFixed(2)}s</span>
        <button className="chip" onClick={() => zoomBy(1.6)} title="缩小（看更长的一段）">
          −
        </button>
        <button className="chip" onClick={() => zoomBy(0.6)} title="放大（看更细）">
          ＋
        </button>
        <button className="chip" onClick={() => setView(chunk.start, chunkLen)} title="回到整块">
          全块
        </button>
        <button className="ghost sm" onClick={onClose} title="收起（Esc）">
          收起
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className={zoomed ? 'wave zoomed' : 'wave'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="点一下从这儿放；放大后可以左右拖"
      />

      <div className="row view-row">
        <span className="lab">视图</span>
        <input
          type="range"
          min={chunk.start}
          max={chunk.start + sliderMax}
          step={0.01}
          value={viewStart}
          disabled={!zoomed}
          onChange={(e) => setViewStart(Number(e.target.value))}
          title={zoomed ? '左右移动视图' : '先放大，才需要移动'}
        />
      </div>

      <div className="row">
        <span className="lab">播放头</span>
        <span className="off">{fmtRel(head - chunk.start)}</span>
        <button className="chip" onClick={() => nudgeHead(-50)} title="← Shift">
          −50
        </button>
        <button className="chip" onClick={() => nudgeHead(-10)} title="←">
          −10
        </button>
        <button className="chip" onClick={() => nudgeHead(10)} title="→">
          +10
        </button>
        <button className="chip" onClick={() => nudgeHead(50)} title="→ Shift">
          +50
        </button>
        <button
          className="ghost sm"
          onClick={() => setHead(findQuietestSec(samples, sampleRate, chunk.start, chunk.end))}
          title="回到这块最安静的地方（气口）"
        >
          回到气口
        </button>
        <span className="grow" />
        <button className="primary" onClick={() => onSplit(head)} title="Enter">
          在此撕开（Enter）
        </button>
      </div>

      <div className="row">
        <span className="lab">试听长度</span>
        {PREVIEW_OPTIONS.map((v) => (
          <button
            key={v}
            className={previewLen === v ? 'chip on' : 'chip'}
            onClick={() => setPreviewLen(v)}
            title={v === 0 ? '一直放到这块结束' : `点一下只放 ${v} 秒`}
          >
            {v === 0 ? '到块尾' : `${v}s`}
          </button>
        ))}
        <label className="check" title="循环播放这一小段，方便反复判断切点">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          循环
        </label>
        <button className="chip" onClick={() => (playing ? stop() : void playFrom(head))} title="空格">
          {playing ? '■ 停' : '▶ 从播放头放（空格）'}
        </button>
        <span className="grow" />
        <button
          className="chip"
          disabled={!canMergeNext}
          onClick={onMergeNext}
          title="把这一块和下一块并起来（可以拿来撤销一次撕开）"
        >
          合并下一块
        </button>
      </div>

      <div className="row">
        <span className="lab">
          {editCount > 0
            ? `已手动切分 ${editCount} 处（换个切块档位也还在）`
            : '点波形试听，Enter 在播放头处撕开；刀口落在气口上最自然'}
        </span>
        {editCount > 0 && (
          <button className="ghost sm" onClick={onReset}>
            清除手动切分
          </button>
        )}
        <span className="grow" />
        <span className="saved" title="撕开/合并会自动写进本机（localStorage），刷新、换切块档位都还在">
          🔒 自动存本机
        </span>
      </div>
    </div>
  )
}

function fmtRel(sec: number) {
  const sign = sec < 0 ? '-' : ''
  const s = Math.abs(sec)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${sign}${m}:${rest.toFixed(2).padStart(5, '0')}`
}
