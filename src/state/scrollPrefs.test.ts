// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { clearScrollMemory, forgetScroll, readScroll, saveScroll } from './scrollPrefs'
import { installFakeStorage } from '../reader/testStorage'

/**
 * 阅读页滚动进度：内存优先、localStorage 兜底、按文章分开。
 * 像素 ↔ 比例的口径在 `core/scrollProgress.test.ts`。
 */
let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  localStorage.clear()
  clearScrollMemory()
})

afterEach(() => {
  restoreStorage()
  vi.restoreAllMocks()
})

/** 模拟「页面重新打开」：内存没了，只剩 localStorage。 */
function reopen() {
  clearScrollMemory()
}

describe('滚动进度：内存优先', () => {
  it('没存过 → 顶部', () => {
    expect(readScroll('doc:1')).toBe(0)
  })

  it('存过能读回来，并且落进 localStorage', () => {
    saveScroll('doc:1', 0.42)
    expect(readScroll('doc:1')).toBeCloseTo(0.42)
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe('0.42')
  })

  it('内存里有的值优先于本机（同一会话不再读硬存）', () => {
    saveScroll('doc:1', 0.5)
    // 手改硬存：内存里还是 0.5，说明没有去读它
    localStorage.setItem('reader:scroll:doc:1', '0.9')
    expect(readScroll('doc:1')).toBeCloseTo(0.5)
  })

  it('页面重开（内存清空）→ 用 localStorage 的值', () => {
    saveScroll('doc:1', 0.66)
    reopen()
    expect(readScroll('doc:1')).toBeCloseTo(0.66)
  })

  it('按文章分开存，互不影响', () => {
    saveScroll('doc:1', 0.2)
    saveScroll('doc:2', 0.8)
    expect(readScroll('doc:1')).toBeCloseTo(0.2)
    expect(readScroll('doc:2')).toBeCloseTo(0.8)
  })
})

describe('滚动进度：脏值与边界', () => {
  it('越界的比例夹到 0–1', () => {
    saveScroll('doc:1', 3)
    expect(readScroll('doc:1')).toBe(1)
    saveScroll('doc:2', -1)
    expect(readScroll('doc:2')).toBe(0)
  })

  it('硬存里是脏数据时回顶部（手改 localStorage 也不会滚到 NaN）', () => {
    localStorage.setItem('reader:scroll:doc:1', 'oops')
    expect(readScroll('doc:1')).toBe(0)
  })

  it('空 docKey 不写也不读（没打开文章时不该产生 reader:scroll: 这样的键）', () => {
    saveScroll('', 0.5)
    expect(readScroll('')).toBe(0)
    expect(localStorage.getItem('reader:scroll:')).toBe(null)
  })

  it('forget 之后回到顶部', () => {
    saveScroll('doc:1', 0.7)
    forgetScroll('doc:1')
    expect(readScroll('doc:1')).toBe(0)
    expect(localStorage.getItem('reader:scroll:doc:1')).toBe(null)
  })

  it('存储写失败不抛（隐私模式）', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveScroll('doc:1', 0.5)).not.toThrow()
    // 内存里仍然记着了，本次会话内切换回去还在原位
    expect(readScroll('doc:1')).toBeCloseTo(0.5)
  })
})
