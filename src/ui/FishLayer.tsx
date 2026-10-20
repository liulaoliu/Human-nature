import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { FISH_POS_DEFAULT, FISH_SIZE_DEFAULT, clampFishPos, clampFishSize } from '../core/fishLayout'
import { readFishPos, readFishSize, saveFishLayout } from '../state/fishPrefs'

/**
 * 装饰用的一条「鱼」：从服务器上的 `/fish`（= assets/imgs/fish/）随机取一张，默认待在右下角。
 *
 * 图片是**静态资源**，由 Vite dev 中间件 / 静态服务提供，**不打进 bundle**：
 *   GET /fish            → 文件名数组
 *   GET /fish/<name>     → 图片
 * 目录不存在 / 为空时自动不渲染（不报错）。
 *
 * 交互（都持久化，按「页面」存本机）：
 *   - 左上角小手柄：拖动改位置
 *   - 右下角小手柄：拖动改大小、双击复位
 * 存哪、存多大由 `state/fishPrefs` 负责，范围夹取在 `core/fishLayout`（都有测试）；
 * 这个组件只管拖拽手势与渲染。
 * 图片本身 pointer-events:none，不挡点击。
 */
const FISH_BASE = '/fish'

let fishCache: Promise<string[]> | null = null
function loadFishNames(): Promise<string[]> {
  if (!fishCache) {
    fishCache = fetch(`${FISH_BASE}/manifest.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []))
      .catch(() => [])
  }
  return fishCache
}

export default function FishLayer({ pageKey = 'default' }: { pageKey?: string }) {
  const [url, setUrl] = useState('')
  const [size, setSize] = useState(() => readFishSize(pageKey))
  const [pos, setPos] = useState(() => readFishPos(pageKey))
  const sizeRef = useRef(size)
  const posRef = useRef(pos)
  const drag = useRef<
    | { kind: 'move'; x: number; y: number; startR: number; startB: number; moved: boolean }
    | { kind: 'size'; x: number; startW: number; moved: boolean }
    | null
  >(null)

  useEffect(() => {
    let alive = true
    void loadFishNames().then((names) => {
      if (!alive || !names.length) return
      const pick = names[Math.floor(Math.random() * names.length)]
      setUrl(`${FISH_BASE}/${encodeURIComponent(pick)}`)
    })
    return () => {
      alive = false
    }
  }, [])

  const applySize = (w: number) => {
    const s = clampFishSize(w)
    sizeRef.current = s
    setSize(s)
  }
  const applyPos = (right: number, bottom: number) => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200
    const height = typeof window !== 'undefined' ? window.innerHeight : 800
    const p = clampFishPos(right, bottom, sizeRef.current, { w: width, h: height })
    posRef.current = p
    setPos(p)
  }
  const persist = () => saveFishLayout(pageKey, sizeRef.current, posRef.current)

  if (!url) return null

  const onDown = (kind: 'move' | 'size') => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (kind === 'move') {
      drag.current = { kind, x: e.clientX, y: e.clientY, startR: posRef.current.right, startB: posRef.current.bottom, moved: false }
    } else {
      drag.current = { kind, x: e.clientX, startW: sizeRef.current, moved: false }
    }
  }
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'move') {
      applyPos(d.startR - (e.clientX - d.x), d.startB - (e.clientY - d.y))
    } else {
      applySize(d.startW - (e.clientX - d.x))
    }
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
    applySize(FISH_SIZE_DEFAULT)
    applyPos(FISH_POS_DEFAULT.right, FISH_POS_DEFAULT.bottom)
    persist()
  }

  const handleBase: CSSProperties = {
    position: 'absolute',
    width: '15px',
    height: '15px',
    padding: 0,
    minWidth: 0,
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.85)',
    background: 'var(--accent)',
    opacity: 0.85,
    pointerEvents: 'auto',
    touchAction: 'none',
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        right: `${pos.right}px`,
        bottom: `${pos.bottom}px`,
        zIndex: 20,
        pointerEvents: 'none',
        lineHeight: 0,
      }}
    >
      <img
        className="fish"
        src={url}
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
        className="fish-move"
        title="拖动改位置（双击复位）"
        onPointerDown={onDown('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={reset}
        style={{ ...handleBase, left: '-3px', top: '-3px', cursor: 'move' }}
      />
      <button
        className="fish-resize"
        title="拖动改大小（双击复位）"
        onPointerDown={onDown('size')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={reset}
        style={{ ...handleBase, right: '-3px', bottom: '-3px', cursor: 'nwse-resize' }}
      />
    </div>
  )
}

