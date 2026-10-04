import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * 装饰用的一条「鱼」：从 assets/imgs/fish 随机取一张，固定待在右下角。
 *
 * 交互：
 *   - 右下角有个小手柄，**拖拽**改大小（双击手柄复位）；
 *   - 尺寸按**页面**持久化（localStorage，key = `fish:size:<pageKey>`）。
 *
 * 纯装饰、不打扰：
 *   - 图片本身 pointer-events:none，不挡点击；只有小手柄可交互；
 *   - 半透明、贴角，基本不遮内容；
 *   - 目录不存在 / 为空时自动不渲染（不报错）。
 * 注意：fish 目录是本地素材（.gitignore），别的机器上可能没有 → 自然就没鱼。
 */
const FISH = import.meta.glob('../../assets/imgs/fish/*.{png,jpg,jpeg,gif,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const DEFAULT_SIZE = 104
const MIN_SIZE = 40
const MAX_SIZE = 380

function loadSize(key: string): number {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n >= MIN_SIZE && n <= MAX_SIZE ? n : DEFAULT_SIZE
  } catch {
    return DEFAULT_SIZE
  }
}

export default function FishLayer({ pageKey = 'default' }: { pageKey?: string }) {
  const key = `fish:size:${pageKey}`
  const src = useMemo(() => {
    const urls = Object.values(FISH)
    return urls.length ? urls[Math.floor(Math.random() * urls.length)] : ''
  }, [])
  const [size, setSize] = useState(() => loadSize(key))
  const sizeRef = useRef(size)
  const drag = useRef<{ x: number; startW: number; moved: boolean } | null>(null)

  const apply = (w: number) => {
    const s = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, w)))
    sizeRef.current = s
    setSize(s)
  }
  const persist = () => {
    try {
      localStorage.setItem(key, String(sizeRef.current))
    } catch {
      // 忽略
    }
  }

  if (!src) return null

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, startW: sizeRef.current, moved: false }
  }
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    // 右下角锚定：往左拖 = 变大
    apply(d.startW - (e.clientX - d.x))
    d.moved = true
  }
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 忽略
    }
    if (d?.moved) persist()
  }
  const reset = () => {
    apply(DEFAULT_SIZE)
    persist()
  }

  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', right: '14px', bottom: '12px', zIndex: 20, pointerEvents: 'none', lineHeight: 0 }}
    >
      <img
        className="fish"
        src={src}
        alt=""
        style={{
          width: `${size}px`,
          height: 'auto',
          display: 'block',
          opacity: 0.75,
          borderRadius: '10px',
          userSelect: 'none',
        }}
      />
      <button
        className="fish-resize"
        title="拖动改大小（双击复位）"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={reset}
        style={{
          position: 'absolute',
          right: '-3px',
          bottom: '-3px',
          width: '15px',
          height: '15px',
          padding: 0,
          minWidth: 0,
          borderRadius: '4px',
          border: '1px solid rgba(255,255,255,0.85)',
          background: 'var(--accent)',
          opacity: 0.85,
          cursor: 'nwse-resize',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
      />
    </div>
  )
}
