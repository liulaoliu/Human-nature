// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_KEY, LOCAL_STATE_EVENT, recordLocalActivity } from './localActivity'
import { dayKeyLocal } from '../core/activity'

beforeEach(() => localStorage.clear())

describe('recordLocalActivity（跟读记一笔「说」）', () => {
  it('写进 reader:activity（与精读页同一个键）', () => {
    recordLocalActivity('speak')
    const list = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]')
    expect(list).toHaveLength(1)
    expect(list[0].day).toBe(dayKeyLocal())
    expect(list[0].counts.speak).toBe(1)
  })

  it('同一天累加，不新增第二行', () => {
    recordLocalActivity('speak')
    recordLocalActivity('speak', 2)
    const list = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]')
    expect(list).toHaveLength(1)
    expect(list[0].counts.speak).toBe(3)
  })

  it('派发 reader:local-state，精读页才会重读', () => {
    const spy = vi.fn()
    window.addEventListener(LOCAL_STATE_EVENT, spy)
    recordLocalActivity('speak')
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener(LOCAL_STATE_EVENT, spy)
  })

  it('存的是坏数据时当空库，不会把学习统计写坏', () => {
    localStorage.setItem(ACTIVITY_KEY, '{not json')
    recordLocalActivity('speak')
    const list = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]')
    expect(list).toHaveLength(1)
    expect(list[0].counts.speak).toBe(1)
  })

  it('没有 localStorage（隐私模式）就安静跳过', () => {
    expect(() => recordLocalActivity('speak', 1, undefined)).not.toThrow()
  })

  it('写失败也不抛（配额满不影响录音）', () => {
    const storage = {
      getItem: () => '[]',
      setItem: () => {
        throw new Error('quota')
      },
    } as unknown as Storage
    expect(() => recordLocalActivity('speak', 1, storage)).not.toThrow()
  })
})
