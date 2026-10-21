// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import FishLayer from './FishLayer'

/** 装饰鱼：滚轮缩放 / 图片拖动，同时保留两个手柄与双击复位。 */
const SIZE_KEY = 'fish:size:test'
const POS_KEY = 'fish:pos:test'

function stubFish() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ['a.png'] })),
  )
  // jsdom 没实现 pointer capture
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
}

async function renderFish() {
  const view = render(<FishLayer pageKey="test" />)
  const img = await waitFor(() => {
    const el = view.container.querySelector('img.fish')
    if (!el) throw new Error('fish not rendered')
    return el as HTMLImageElement
  })
  return { img, ...view }
}

function shellOf(img: HTMLImageElement): HTMLElement {
  return img.parentElement as HTMLElement
}

/** jsdom 没有 PointerEvent：用 MouseEvent 兜底，否则 clientX/Y 全是 0，拖动测不出来。 */
class FakePointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 1
  }
}

beforeEach(() => {
  localStorage.clear()
  stubFish()
  vi.stubGlobal('PointerEvent', FakePointerEvent)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FishLayer：滚轮缩放', () => {
  it('默认是最大尺寸的 20% + 悬停「手」形光标', async () => {
    const { img } = await renderFish()
    expect(img.style.width).toBe('76px')
    expect(img.style.cursor).toBe('grab')
    expect(img.style.pointerEvents).toBe('auto')
  })

  it('向上滚放大、向下滚缩小，并夹在 40–380', async () => {
    const { img } = await renderFish()

    fireEvent.wheel(img, { deltaY: -200 })
    const enlarged = Number.parseInt(img.style.width, 10)
    expect(enlarged).toBeGreaterThan(76)

    fireEvent.wheel(img, { deltaY: 200 })
    expect(Number.parseInt(img.style.width, 10)).toBeLessThan(enlarged)

    fireEvent.wheel(img, { deltaY: 100000 })
    expect(img.style.width).toBe('40px')
    fireEvent.wheel(img, { deltaY: -100000 })
    expect(img.style.width).toBe('380px')
  })

  it('滚完防抖落盘；还没落盘就卸载也会补写', async () => {
    const { img, unmount } = await renderFish()
    fireEvent.wheel(img, { deltaY: -200 })
    const width = img.style.width
    expect(localStorage.getItem(SIZE_KEY)).toBeNull()

    unmount()
    expect(localStorage.getItem(SIZE_KEY)).toBe(String(Number.parseInt(width, 10)))
  })
})

describe('FishLayer：图片上拖动', () => {
  it('按住左键拖动改位置，松手落盘', async () => {
    const { img } = await renderFish()
    const shell = shellOf(img)
    expect(shell.style.right).toBe('14px')
    expect(shell.style.bottom).toBe('12px')

    fireEvent.pointerDown(img, { pointerId: 1, clientX: 500, clientY: 500 })
    expect(img.style.cursor).toBe('grabbing')
    fireEvent.pointerMove(img, { pointerId: 1, clientX: 460, clientY: 470 })
    fireEvent.pointerUp(img, { pointerId: 1 })

    expect(shell.style.right).toBe('54px')
    expect(shell.style.bottom).toBe('42px')
    expect(img.style.cursor).toBe('grab')
    expect(JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')).toEqual({ right: 54, bottom: 42 })
  })

  it('双击循环：默认 20% → 最小 → 50% → 最大 → 最小，位置不动', async () => {
    const { img } = await renderFish()
    expect(img.style.width).toBe('76px')

    // 先把鱼拖到别处，验证双击只改大小
    fireEvent.pointerDown(img, { pointerId: 1, clientX: 500, clientY: 500 })
    fireEvent.pointerMove(img, { pointerId: 1, clientX: 420, clientY: 430 })
    fireEvent.pointerUp(img, { pointerId: 1 })
    const shell = shellOf(img)
    const pos = { right: shell.style.right, bottom: shell.style.bottom }

    // 第一下：默认尺寸不在三档上 → 回最小
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('40px')
    expect(localStorage.getItem(SIZE_KEY)).toBe('40')

    // 第二下 → 50%（最大 380 的一半）
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('190px')

    // 第三下 → 最大
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('380px')

    // 第四下回到最小
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('40px')
    expect(localStorage.getItem(SIZE_KEY)).toBe('40')

    // 只改大小，不动位置
    expect(shell.style.right).toBe(pos.right)
    expect(shell.style.bottom).toBe(pos.bottom)
  })

  it('滚轮停在档与档之间时，双击第一下先回最小', async () => {
    const { img } = await renderFish()
    fireEvent.wheel(img, { deltaY: -200 })
    expect(Number.parseInt(img.style.width, 10)).toBeGreaterThan(40)

    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('40px')
  })
})

describe('FishLayer：右上角单击切换下一张', () => {
  /** 用 3 张鱼的清单，便于验证「切到下一张」会改变图片。 */
  async function renderFishMulti() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ['a.png', 'b.png', 'c.png'] })),
    )
    vi.resetModules()
    const { default: FreshFishLayer } = await import('./FishLayer')
    const view = render(<FreshFishLayer pageKey="test" />)
    const img = await waitFor(() => {
      const el = view.container.querySelector('img.fish')
      if (!el) throw new Error('fish not rendered')
      return el as HTMLImageElement
    })
    await waitFor(() => expect(img.getAttribute('src')).toContain('/fish/'))
    return { img, ...view }
  }

  it('点击右上角（右 65% 以上、上 35% 以内）切到下一张', async () => {
    const { img } = await renderFishMulti()
    const initial = img.getAttribute('src')
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 100,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect)

    fireEvent.click(img, { clientX: 85, clientY: 8 }) // 右上角

    await waitFor(() => expect(img.getAttribute('src')).not.toBe(initial))
    expect(img.getAttribute('src')).toMatch(/\/fish\/(a|b|c)\.png$/)
  })

  it('点左上角不切换（仍显示原图）', async () => {
    const { img } = await renderFishMulti()
    const initial = img.getAttribute('src')
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 100,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect)

    fireEvent.click(img, { clientX: 8, clientY: 8 }) // 左上角

    await new Promise((r) => setTimeout(r, 0))
    expect(img.getAttribute('src')).toBe(initial)
  })
})
