import { wordSpans } from './wordSelect'

/** 一个词的音频区间（毫秒）。 */
export interface WordTiming {
  start: number
  end: number
}

/** 服务端时间戳里的一段：part 是它念的词（可能带标点/大小写差异）。 */
export interface TimingPart {
  part?: string
  start: number
  end: number
}

function normW(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/[^a-z0-9']/g, '')
}

/**
 * 把服务端逐词时间戳对齐到该句的词序（供逐词高亮 / 点词跳播）。
 *
 * 规则：按顺序往后找同一个词（归一化后比较）；找不到时用「同位置」的时间戳兜底，
 * 再没有就给 0（宁可不高亮，也不把时间戳错配到别的词上）。
 */
export function alignTimings(text: string, timings: TimingPart[]): WordTiming[] {
  const spans = wordSpans(text)
  const out: WordTiming[] = []
  let j = 0
  for (const sp of spans) {
    const key = normW(sp.text)
    let found = -1
    for (let k = j; k < timings.length; k++) {
      if (normW(timings[k].part ?? '') === key) {
        found = k
        break
      }
    }
    const t = found >= 0 ? timings[found] : timings[j]
    if (found >= 0) j = found + 1
    else if (j < timings.length) j++
    out.push(t ? { start: t.start, end: t.end } : { start: 0, end: 0 })
  }
  return out
}
