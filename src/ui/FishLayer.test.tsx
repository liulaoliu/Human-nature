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
  it('默认大小 + 悬停「手」形光标', async () => {
    const { img } = await renderFish()
    expect(img.style.width).toBe('104px')
    expect(img.style.cursor).toBe('grab')
    expect(img.style.pointerEvents).toBe('auto')
  })

  it('向上滚放大、向下滚缩小，并夹在 40–380', async () => {
    const { img } = await renderFish()

    fireEvent.wheel(img, { deltaY: -200 })
    const enlarged = Number.parseInt(img.style.width, 10)
    expect(enlarged).toBeGreaterThan(104)

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

  it('双击循环：最小 → 50% → 最大 → 最小，位置不动', async () => {
    const { img } = await renderFish()
    fireEvent.wheel(img, { deltaY: -200 })
    fireEvent.pointerDown(img, { pointerId: 1, clientX: 500, clientY: 500 })
    fireEvent.pointerMove(img, { pointerId: 1, clientX: 420, clientY: 430 })
    fireEvent.pointerUp(img, { pointerId: 1 })
    const shell = shellOf(img)
    const pos = { right: shell.style.right, bottom: shell.style.bottom }

    // 第一次双击（从滚轮后的任意尺寸）→ 最小
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('40px')
    expect(localStorage.getItem(SIZE_KEY)).toBe('40')

    // 第二次 → 50%（最大 380 的一半）
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('190px')

    // 第三次 → 最大
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('380px')

    // 第四次回到最小
    fireEvent.doubleClick(img)
    expect(img.style.width).toBe('40px')

    // 只改大小，不动位置
    expect(shell.style.right).toBe(pos.right)
    expect(shell.style.bottom).toBe(pos.bottom)
  })
})
