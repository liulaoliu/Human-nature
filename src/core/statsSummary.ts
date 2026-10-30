/**
 * 统计面板的汇总口径（纯函数）。
 *
 * 为什么单独一个模块：面板要同时回答「本周 / 本月 / 累计各做了多少」和「某一天到底做了什么」，
 * 两处必须是**同一套区间判定**，否则点开某天看到的数字会和上面的汇总对不上。
 * 日期一律走 `core/activity.dayKeyLocal`（04:00 结算），不要在这里自己拼日期键。
 */

import { dayKeyLocal, sumCats, type ActivityCat, type DayActivity } from './activity'
import type { ReadDone } from './goals'
import type { GoldenDrillRecord } from './goldenProgress'
import type { RetellRecord } from './learning'
import type { PracticeRecord } from './practice'
import { wordCount } from './speedRead'
import type { StudyDay } from './vocabStats'
import type { WritingRecord } from './writing'

/** 汇总要用到的六份记录（都是学习记录里已有的，不新增存储）。 */
export interface StatsInput {
  /** 背单词按天：张数 + 秒数 */
  studyDays: StudyDay[]
  /** 仿写 / 金句课批改记录 */
  writingHistory: WritingRecord[]
  /** 复述打卡 */
  retells: RetellRecord[]
  /** 读完的篇目（只记第一次读完那天） */
  readDone: ReadDone[]
  /** 金句课每句的练习进度 */
  goldenDrills: GoldenDrillRecord[]
  /** 考试 / 听写 / 听力 / 金句课的成绩 */
  practice: PracticeRecord[]
}

/** 一个区间（含首尾）内的汇总。 */
export interface RangeSummary {
  /** 背单词：评分张数 + 时长（秒） */
  study: { cards: number; seconds: number }
  /** 写作：篇数 + 字数 */
  writing: { count: number; words: number }
  /** 复述：条数 + 字数 */
  retell: { count: number; words: number }
  /** 读完：篇数 */
  readDone: number
  /** 金句课：掌握句数 */
  golden: number
  /** 练习：题数 + 答对数 */
  practice: { total: number; correct: number }
}

/** 某一天的明细 = 那天的五类活动 + 单日汇总。 */
export interface DayDetail extends RangeSummary {
  day: string
  cats: Record<ActivityCat, number>
}

/** ISO 时刻 → 逻辑日；坏日期返回空串（宁可漏计，也不要把脏数据算进某天）。 */
function isoDay(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dayKeyLocal(d)
}

/** `day` 是否落在 [from, to]（闭区间，字符串比较对 YYYY-MM-DD 成立）。 */
function inRange(day: string, from: string, to: string): boolean {
  return !!day && day >= from && day <= to
}

/**
 * 汇总 [from, to] 内的六类记录。
 *
 * 口径细节：
 *   - 背单词 / 读完自带 `day`，直接比；
 *   - 写作 / 复述 / 练习 / 金句用 ISO 时刻，先换成逻辑日再比；
 *   - 金句只数 `mastered`，日期取 `completedAt`（缺了就退回 `at`，旧数据没写完成时刻）；
 *   - 写作字数与速读共用 `core/speedRead.wordCount`，别各写一份。
 */
export function summarizeRange(input: StatsInput, from: string, to: string): RangeSummary {
  const out: RangeSummary = {
    study: { cards: 0, seconds: 0 },
    writing: { count: 0, words: 0 },
    retell: { count: 0, words: 0 },
    readDone: 0,
    golden: 0,
    practice: { total: 0, correct: 0 },
  }
  if (!from || !to || from > to) return out

  for (const d of input.studyDays) {
    if (!inRange(d.day, from, to)) continue
    out.study.cards += Math.max(0, d.cards || 0)
    out.study.seconds += Math.max(0, d.seconds || 0)
  }
  for (const r of input.writingHistory) {
    if (!inRange(isoDay(r.at), from, to)) continue
    out.writing.count += 1
    out.writing.words += wordCount(r.text ?? '')
  }
  for (const r of input.retells) {
    if (!inRange(isoDay(r.at), from, to)) continue
    out.retell.count += 1
    // 复述的 `words` 是打卡时算好的；老数据缺了就现算，别让它变 0。
    out.retell.words += Number.isFinite(r.words) ? Math.max(0, r.words) : wordCount(r.text ?? '')
  }
  for (const r of input.readDone) {
    if (inRange(r.day, from, to)) out.readDone += 1
  }
  for (const r of input.goldenDrills) {
    if (!r.mastered) continue
    if (inRange(isoDay(r.completedAt ?? r.at), from, to)) out.golden += 1
  }
  for (const r of input.practice) {
    if (!inRange(isoDay(r.at), from, to)) continue
    out.practice.total += Math.max(0, r.total || 0)
    out.practice.correct += Math.max(0, r.correct || 0)
  }
  return out
}

/**
 * 某一天的明细：五类活动量 + 单日汇总。
 *
 * 单日汇总直接复用 `summarizeRange(from = to = day)`，保证「点开某天」和
 * 「本周/本月」是同一套判定；活动量走 `core/activity.sumCats`，不另算一遍。
 */
export function dayDetail(input: StatsInput, activity: DayActivity[], day: string): DayDetail {
  return {
    day,
    cats: sumCats(activity, day, day),
    ...summarizeRange(input, day, day),
  }
}

/**
 * 时长的人话版本：`48 秒` / `12 分钟` / `1 小时 12 分`。
 *
 * 和 `reader/format.fmtDur` 的分工：那个是**计时器**（`3:07`、`1h02m`），
 * 这里是**统计文案**，单位写出来才看得懂。两处都别互相替代。
 */
export function fmtSpan(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`
}
