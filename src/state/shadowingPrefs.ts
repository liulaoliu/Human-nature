/**
 * 跟读模块的本机偏好（显示模式 / 麦克风 / 说完静音多久 / 回放放大）。
 *
 * 从 `ui/App.tsx` 抽出来：那边是展示层，架构门禁 R3 不许直接碰 localStorage
 * （原来登记成「存量违规」）。偏好本来就是「存在本机的一份配置」，
 * 放 state 层、带读写的默认值兜底，App 只负责把值接到控件上。
 *
 * 所有读都兜底：隐私模式 / 存储满了 / 存的是脏数据，一律回默认值，不影响用。
 */

/** 原文显示模式：整篇 / 聚焦（当前块大字，邻近压暗）/ 单块 */
export type ViewMode = 'full' | 'focus' | 'block'

/** 循环顺序：按 V 依次切 全文 → 聚焦 → 单块 */
export const VIEW_MODES: ViewMode[] = ['full', 'focus', 'block']

const VIEW_KEY = 'shadowing.ui.viewMode'
const MIC_RAW_KEY = 'shadowing.ui.micRaw'
const MIC_DEV_KEY = 'shadowing.ui.micDevice'
const HANGOVER_KEY = 'shadowing.ui.hangoverMs'
const TAKE_BOOST_KEY = 'shadowing.ui.takeBoost'

/** 默认值集中在这里，读不到/存坏了都回它 */
export const PREFS_DEFAULT = {
  viewMode: 'full' as ViewMode,
  /** 默认「原声优先」——发闷多半就是浏览器降噪干的 */
  micRaw: true,
  micDevice: '',
  /** 「说完静音多久算结束」，默认 2.5 秒（读得慢/有停顿的人够用） */
  hangoverMs: 2500,
  /** 录音回放额外放大倍数，默认 2（= 放大 100%） */
  takeBoost: 2,
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式存不了就算了，不影响用
  }
}

export function readViewMode(): ViewMode {
  const v = readRaw(VIEW_KEY)
  return v === 'focus' || v === 'block' ? v : PREFS_DEFAULT.viewMode
}

export function saveViewMode(v: ViewMode): void {
  writeRaw(VIEW_KEY, v)
}

export function readMicRaw(): boolean {
  const v = readRaw(MIC_RAW_KEY)
  return v === null ? PREFS_DEFAULT.micRaw : v !== '0'
}

export function saveMicRaw(raw: boolean): void {
  writeRaw(MIC_RAW_KEY, raw ? '1' : '0')
}

export function readMicDevice(): string {
  return readRaw(MIC_DEV_KEY) ?? PREFS_DEFAULT.micDevice
}

export function saveMicDevice(id: string): void {
  writeRaw(MIC_DEV_KEY, id)
}

/** 静音多久算读完：小于 0.8 秒的值当脏数据（会把人说话中的停顿当结束） */
export function readHangover(): number {
  const v = Number(readRaw(HANGOVER_KEY))
  return Number.isFinite(v) && v >= 800 ? v : PREFS_DEFAULT.hangoverMs
}

export function saveHangover(ms: number): void {
  writeRaw(HANGOVER_KEY, String(ms))
}

/** 回放放大倍数：小于 0.5 当脏数据（0 等于静音了自己都听不见） */
export function readTakeBoost(): number {
  const v = Number(readRaw(TAKE_BOOST_KEY))
  return Number.isFinite(v) && v >= 0.5 ? v : PREFS_DEFAULT.takeBoost
}

export function saveTakeBoost(mult: number): void {
  writeRaw(TAKE_BOOST_KEY, String(mult))
}
