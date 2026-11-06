import type { Calibration, ManualAnchor } from './ports'

/**
 * 跟读 / 手动切块存在 localStorage 里的两小份数据。
 *
 * 它们不是学习记录（丢了不影响统计），但也是用户手工调过的资产：
 * 旧版本、手工改坏、插件写脏都可能留下非对象 JSON。
 * 读的时候必须先过这里，不能 `JSON.parse(...) as Record<...>` 直接进业务。
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function numbers(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map(num).filter((n): n is number => n !== null)
}

function anchor(v: unknown): ManualAnchor | null {
  if (!isRecord(v)) return null
  const atSec = num(v.atSec)
  const startWord = num(v.startWord)
  const endWord = num(v.endWord)
  if (atSec === null || startWord === null || endWord === null) return null
  const out: ManualAnchor = { atSec, startWord, endWord }
  if (typeof v.text === 'string') out.text = v.text
  return out
}

function calibration(v: unknown): Calibration | null {
  if (!isRecord(v)) return null
  const offsetWords = num(v.offsetWords)
  const textStartChunk = num(v.textStartChunk)
  if (offsetWords === null || textStartChunk === null) return null
  const out: Calibration = { offsetWords, textStartChunk }
  if (Array.isArray(v.anchors)) {
    const anchors = v.anchors.map(anchor).filter((a): a is ManualAnchor => a !== null)
    if (anchors.length) out.anchors = anchors
  }
  const splits = numbers(v.splits)
  if (splits) out.splits = splits
  const merges = numbers(v.merges)
  if (merges) out.merges = merges
  return out
}

export function parseCalibrationMap(raw: unknown): Record<string, Calibration> {
  if (!isRecord(raw)) return {}
  const out: Record<string, Calibration> = {}
  for (const [name, value] of Object.entries(raw)) {
    const one = calibration(value)
    if (one) out[name] = one
  }
  return out
}

export function parseScriptEditMap(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[name] = value
  }
  return out
}
