/**
 * 装饰鱼的「放在哪、多大」——按页面（pageKey）存本机。
 *
 * 从 `ui/FishLayer.tsx` 挪出来的：那边是展示层，架构门禁 R3 不许直接碰
 * localStorage（原来登记成存量违规）。规则（范围夹取、脏值兜底）在
 * `core/fishLayout`，这里只做键名与读写。
 */
import { parseFishPos, parseFishSize, type FishPos } from '../core/fishLayout'

const sizeKeyOf = (pageKey: string) => `fish:size:${pageKey}`
const posKeyOf = (pageKey: string) => `fish:pos:${pageKey}`

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
    // 隐私模式 / 存储满了：这条鱼就用默认大小位置，不影响页面
  }
}

/** 这一页存过的鱼尺寸（没存过 / 脏值 = 默认值） */
export function readFishSize(pageKey: string): number {
  return parseFishSize(readRaw(sizeKeyOf(pageKey)))
}

/** 这一页存过的鱼位置（没存过 / 脏值 = 默认位置） */
export function readFishPos(pageKey: string): FishPos {
  return parseFishPos(readRaw(posKeyOf(pageKey)))
}

/** 拖完 / 复位后写回本机（一次写两个键，中途失败就当没存） */
export function saveFishLayout(pageKey: string, size: number, pos: FishPos): void {
  writeRaw(sizeKeyOf(pageKey), String(size))
  writeRaw(posKeyOf(pageKey), JSON.stringify(pos))
}
