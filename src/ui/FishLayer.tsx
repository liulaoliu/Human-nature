import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { clampFishPos, clampFishSize, nextFishSize } from '../core/fishLayout'
import { readFishPos, readFishSize, saveFishLayout } from '../state/fishPrefs'

/**
 * 装饰用的一条「鱼」：从服务器上的 `/fish`（= assets/imgs/fish/）随机取一张，默认待在右下角。
 *
 * 图片是**静态资源**，由 Vite dev 中间件 / 静态服务提供，**不打进 bundle**：
 *   GET /fish            → 文件名数组
 *   GET /fish/<name>     → 图片
 * 目录不存在 / 为空时自动不渲染（不报错）。
 *
 * 交互（拖拽 / 缩放 / 双击都持久化，按「页面」存本机）：
 *   - 图片上滚轮：缩放（向上放大、向下缩小，夹在 `FISH_SIZE_MIN`–`MAX`）
 *   - 图片上按住左键：拖动改位置（悬停变「手」形，按住变抓取）
 *   - 左上角小手柄：拖动改位置
 *   - 右下角小手柄：拖动改大小
 *   - 双击图片 / 任一手柄：尺寸循环「最小 → 50% → 最大 → 最小」（位置不动）
 *   - 图片右上角单击（不拖动）：在 `/fish` 列表里切到下一张（循环；不持久化）
 * 存哪、存多大由 `state/fishPrefs` 负责，范围夹取在 `core/fishLayout`（都有测试）；
 * 这个组件只管拖拽手势与渲染。
 *
 * 注意：图片现在是可交互的（`pointer-events: auto`），压在鱼身上的点击不会再落到
 * 正文上——这是滚轮/拖动必须付出的代价；两个手柄之外没有扩大热区。
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
  /** 按住图片拖动时把光标切成「抓取」态。 */
  const [grabbing, setGrabbing] = useState(false)
  const sizeRef = useRef(size)
  const posRef = useRef(pos)
  const imgRef = useRef<HTMLImageElement | null>(null)
  /** `/fish` 里的全部鱼名（加载后填入），用于右上角点击「下一张」时循环取下一个。 */
  const namesRef = useRef<string[]>([])
  /** 当前显示的鱼在 namesRef 里的下标；加载时随机选，点击右上角 +1 循环。 */
  const idxRef = useRef(-1)
  /** 上一次指针交互是否发生了拖动：拖动后的 click 不该切换图片。 */
  const lastMoved = useRef(false)
  /** 滚轮缩放很密集，落盘做 200ms 防抖，别每格滚轮都写一次 localStorage。 */
  const persistTimer = useRef<number | null>(null)
  const drag = useRef<
    | { kind: 'move'; x: number; y: number; startR: number; startB: number; moved: boolean }
    | { kind: 'size'; x: number; startW: number; moved: boolean }
    | null
  >(null)

  useEffect(() => {
    let alive = true
    void loadFishNames().then((names) => {
      if (!alive) return
      namesRef.current = names
      if (!names.length) return
      const idx = Math.floor(Math.random() * names.length)
      idxRef.current = idx
      setUrl(`${FISH_BASE}/${encodeURIComponent(names[idx])}`)
    })
    return () => {
      alive = false
    }
  }, [])

  const viewport = () => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  })
  const applySize = (w: number) => {
    const s = clampFishSize(w)
    sizeRef.current = s
    setSize(s)
    // 尺寸变了要按新尺寸重新夹位置，否则放大后鱼可能顶出左/上边
    const p = clampFishPos(posRef.current.right, posRef.current.bottom, s, viewport())
    posRef.current = p
    setPos(p)
  }
  const applyPos = (right: number, bottom: number) => {
    const p = clampFishPos(right, bottom, sizeRef.current, viewport())
    posRef.current = p
    setPos(p)
  }
  const persist = () => saveFishLayout(pageKey, sizeRef.current, posRef.current)
  /** 滚轮/拖动结束后的防抖落盘。 */
  const schedulePersist = () => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null
      persist()
    }, 200)
  }

  /**
   * 滚轮缩放。必须用原生监听并 `passive: false`：React 的 onWheel 在根节点上是
   * passive 的，`preventDefault` 无效，滚鱼的时候页面会跟着滚。
   */
  useEffect(() => {
    const el = imgRef.current
    if (!el || !url) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport().h : 1
      // 向上滚（deltaY < 0）放大；按比例缩放，触控板的小增量也不会跳
      applySize(sizeRef.current * Math.exp(-e.deltaY * unit * 0.0015))
      schedulePersist()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pageKey])

  /** 卸载前把还没落盘的缩放写回去。 */
  useEffect(
    () => () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current)
        persistTimer.current = null
        saveFishLayout(pageKey, sizeRef.current, posRef.current)
      }
    },
    [pageKey],
  )

  if (!url) return null

  const onDown = (kind: 'move' | 'size') => (e: ReactPointerEvent<HTMLElement>) => {
    // 只接左键（触屏 pointerType 不是 mouse，button 也是 0）
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (kind === 'move') {
      setGrabbing(true)
      drag.current = { kind, x: e.clientX, y: e.clientY, startR: posRef.current.right, startB: posRef.current.bottom, moved: false }
    } else {
      drag.current = { kind, x: e.clientX, startW: sizeRef.current, moved: false }
    }
  }
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'move') {
      applyPos(d.startR - (e.clientX - d.x), d.startB - (e.clientY - d.y))
    } else {
      applySize(d.startW - (e.clientX - d.x))
    }
    d.moved = true
  }
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    drag.current = null
    setGrabbing(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 忽略
    }
    lastMoved.current = d?.moved ?? false
    if (d?.moved) persist()
  }
  /** 双击切换尺寸：最小 → 50% → 最大 → 最小；只改大小，不动位置。 */
  const cycleSize = () => {
    applySize(nextFishSize(sizeRef.current))
    persist()
  }
  /** 右上角点击：在 `/fish` 列表里切到下一张（循环）。少于 2 张时等于不切。 */
  const switchFish = () => {
    const names = namesRef.current
    if (names.length < 2) return
    const next = (idxRef.current + 1) % names.length
    idxRef.current = next
    setUrl(`${FISH_BASE}/${encodeURIComponent(names[next])}`)
  }
  /** 图片单击：不是拖动收尾、且点在右上角（右 65% 以上、上 35% 以内）就切下一张。 */
  const onImageClick = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (lastMoved.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x >= rect.width * 0.65 && y <= rect.height * 0.35) {
      e.stopPropagation()
      switchFish()
    }
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
        ref={imgRef}
        className="fish"
        src={url}
        alt=""
        draggable={false}
        title="滚轮缩放 · 按住拖动 · 双击切换大小 · 右上角切换下一张"
        onPointerDown={onDown('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={cycleSize}
        onClick={onImageClick}
        style={{
          width: `${size}px`,
          height: 'auto',
          display: 'block',
          opacity: 0.75,
          borderRadius: '10px',
          userSelect: 'none',
          // 图片本身要能接滚轮 / 拖动（外层容器仍是 none，别扩大热区）
          pointerEvents: 'auto',
          cursor: grabbing ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      />
      <button
        className="fish-move"
        title="拖动改位置（双击切换大小）"
        onPointerDown={onDown('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={cycleSize}
        style={{ ...handleBase, left: '-3px', top: '-3px', cursor: 'move' }}
      />
      <button
        className="fish-resize"
        title="拖动改大小（双击切换大小）"
        onPointerDown={onDown('size')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={cycleSize}
        style={{ ...handleBase, right: '-3px', bottom: '-3px', cursor: 'nwse-resize' }}
      />
    </div>
  )
}

