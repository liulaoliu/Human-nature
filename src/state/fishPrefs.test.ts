// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFishPos, readFishSize, saveFishLayout } from './fishPrefs'
import { FISH_POS_DEFAULT, FISH_SIZE_DEFAULT } from '../core/fishLayout'

beforeEach(() => localStorage.clear())

describe('装饰鱼的本机布局', () => {
  it('没存过时用默认大小与位置', () => {
    expect(readFishSize('reader')).toBe(FISH_SIZE_DEFAULT)
    expect(readFishPos('reader')).toEqual(FISH_POS_DEFAULT)
  })

  it('存进去能读回来', () => {
    saveFishLayout('reader', 160, { right: 40, bottom: 88 })
    expect(readFishSize('reader')).toBe(160)
    expect(readFishPos('reader')).toEqual({ right: 40, bottom: 88 })
  })

  it('按页面分开存，互不影响', () => {
    saveFishLayout('reader', 200, { right: 10, bottom: 20 })
    saveFishLayout('shadowing', 80, { right: 30, bottom: 40 })
    expect(readFishSize('reader')).toBe(200)
    expect(readFishSize('shadowing')).toBe(80)
    expect(readFishPos('shadowing')).toEqual({ right: 30, bottom: 40 })
  })

  it('键名带页面名（刷新后仍按页面取回）', () => {
    saveFishLayout('reader', 160, { right: 40, bottom: 88 })
    expect(localStorage.getItem('fish:size:reader')).toBe('160')
    expect(localStorage.getItem('fish:pos:reader')).toBe('{"right":40,"bottom":88}')
  })

  it('存的是脏数据时回默认（手改 localStorage 也不会飘出屏幕）', () => {
    localStorage.setItem('fish:size:reader', '9999')
    localStorage.setItem('fish:pos:reader', '{oops')
    expect(readFishSize('reader')).toBe(FISH_SIZE_DEFAULT)
    expect(readFishPos('reader')).toEqual(FISH_POS_DEFAULT)
  })

  it('存储写失败不抛（隐私模式）', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveFishLayout('reader', 120, { right: 1, bottom: 2 })).not.toThrow()
  })
})
