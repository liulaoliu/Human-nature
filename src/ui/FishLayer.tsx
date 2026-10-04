import { useMemo } from 'react'

/**
 * 装饰用的「鱼」：从 assets/imgs/fish 随机取几张图，**静止**摆在页面背景的几个位置。
 *
 * 纯装饰，且刻意不打扰：
 *   - pointer-events: none，不挡点击 / 不影响功能；
 *   - 放在内容下层（背景），不覆盖文字 / 面板；
 *   - 不做满屏游动，只静静待在边上；
 *   - 目录不存在或为空时自动不渲染（不报错）。
 * 注意：fish 目录是本地素材（.gitignore），别的机器上可能没有 → 自然就没鱼。
 */
const FISH = import.meta.glob('../../assets/imgs/fish/*.{png,jpg,jpeg,gif,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** 固定摆位（贴着边角，尽量避开中间的内容列）。 */
const SPOTS: { left: string; top: string }[] = [
  { left: '2%', top: '10%' },
  { left: '89%', top: '16%' },
  { left: '3%', top: '64%' },
  { left: '90%', top: '72%' },
  { left: '72%', top: '3%' },
  { left: '18%', top: '91%' },
]

export default function FishLayer() {
  const fish = useMemo(() => {
    const urls = Object.values(FISH)
    if (!urls.length) return []
    return SPOTS.map((s) => ({
      ...s,
      src: urls[Math.floor(Math.random() * urls.length)],
      size: 30 + Math.random() * 30,
      flip: Math.random() < 0.5,
    }))
  }, [])

  if (!fish.length) return null
  return (
    <div className="fish-layer" aria-hidden="true">
      {fish.map((f, i) => (
        <img
          key={i}
          className="fish"
          src={f.src}
          alt=""
          style={{
            left: f.left,
            top: f.top,
            width: `${f.size}px`,
            transform: f.flip ? 'scaleX(-1)' : undefined,
          }}
        />
      ))}
    </div>
  )
}
