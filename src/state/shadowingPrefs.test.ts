// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PREFS_DEFAULT,
  readHangover,
  readMicDevice,
  readMicRaw,
  readTakeBoost,
  readViewMode,
  saveHangover,
  saveMicDevice,
  saveMicRaw,
  saveTakeBoost,
  saveViewMode,
} from './shadowingPrefs'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('跟读模块的本机偏好', () => {
  it('没存过时全是默认值', () => {
    expect(readViewMode()).toBe('full')
    expect(readMicRaw()).toBe(true)
    expect(readMicDevice()).toBe('')
    expect(readHangover()).toBe(2500)
    expect(readTakeBoost()).toBe(2)
  })

  it('显示模式存得住，脏值回默认', () => {
    saveViewMode('focus')
    expect(readViewMode()).toBe('focus')
    saveViewMode('block')
    expect(readViewMode()).toBe('block')
    localStorage.setItem('shadowing.ui.viewMode', 'huge')
    expect(readViewMode()).toBe(PREFS_DEFAULT.viewMode)
  })

  it('原声/降噪开关存成 1 和 0', () => {
    saveMicRaw(false)
    expect(localStorage.getItem('shadowing.ui.micRaw')).toBe('0')
    expect(readMicRaw()).toBe(false)
    saveMicRaw(true)
    expect(readMicRaw()).toBe(true)
  })

  it('麦克风设备 id 存得住（空串表示系统默认）', () => {
    saveMicDevice('mic-2')
    expect(readMicDevice()).toBe('mic-2')
    saveMicDevice('')
    expect(readMicDevice()).toBe('')
  })

  it('静音判定时长：非数字、小于 0.8 秒的脏值都回 2500', () => {
    saveHangover(4000)
    expect(readHangover()).toBe(4000)
    localStorage.setItem('shadowing.ui.hangoverMs', 'abc')
    expect(readHangover()).toBe(PREFS_DEFAULT.hangoverMs)
    localStorage.setItem('shadowing.ui.hangoverMs', '100')
    expect(readHangover()).toBe(PREFS_DEFAULT.hangoverMs)
  })

  it('回放放大倍数：小于 0.5 的脏值回 2（0 等于听不见了）', () => {
    saveTakeBoost(3)
    expect(readTakeBoost()).toBe(3)
    localStorage.setItem('shadowing.ui.takeBoost', '0.1')
    expect(readTakeBoost()).toBe(PREFS_DEFAULT.takeBoost)
  })

  it('localStorage 抛异常（隐私模式）时读回默认值，不炸', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readViewMode()).toBe('full')
    expect(readMicRaw()).toBe(true)
    expect(readHangover()).toBe(2500)
    expect(readTakeBoost()).toBe(2)
  })

  it('localStorage 写不进去时也不炸', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveViewMode('focus')).not.toThrow()
    expect(() => saveHangover(4000)).not.toThrow()
  })
})
