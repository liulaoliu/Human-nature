import { useMemo } from 'react'

/**
 * 装饰用的一条「鱼」：从 assets/imgs/fish 随机取一张，固定待在右下角。
 *
 * 纯装饰、且刻意不打扰：
 *   - pointer-events: none，不挡点击 / 不影响功能；
 *   - 半透明、贴在角落，基本不遮内容；
 *   - 不做满屏游动；
 *   - 目录不存在或为空时自动不渲染（不报错）。
 * 注意：fish 目录是本地素材（.gitignore），别的机器上可能没有 → 自然就没鱼。
 */
const FISH = import.meta.glob('../../assets/imgs/fish/*.{png,jpg,jpeg,gif,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export default function FishLayer() {
  const src = useMemo(() => {
    const urls = Object.values(FISH)
    return urls.length ? urls[Math.floor(Math.random() * urls.length)] : ''
  }, [])

  if (!src) return null
  return (
    <img
      className="fish"
      src={src}
      alt=""
      aria-hidden="true"
      style={{
        position: 'fixed',
        right: '14px',
        bottom: '12px',
        width: '104px',
        height: 'auto',
        opacity: 0.75,
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 20,
        borderRadius: '10px',
      }}
    />
  )
}
