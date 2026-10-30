import { useMemo, useState } from 'react'
import {
  ACTIVITY_CATS,
  ACTIVITY_LABEL,
  activityStreak,
  dayKeyLocal,
  dayTotal,
  sumCats,
  type ActivityCat,
  type DayActivity,
} from '../../core/activity'
import type { ReadDone } from '../../core/goals'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { RetellRecord } from '../../core/learning'
import {
  accuracy,
  PRACTICE_LABEL,
  recentPractice,
  sumByKind,
  type PracticeKind,
  type PracticeRecord,
} from '../../core/practice'
import { dayDetail, fmtSpan, summarizeRange, type StatsInput } from '../../core/statsSummary'
import type { StudyDay } from '../../core/vocabStats'
import type { WritingRecord } from '../../core/writing'
import DayHeatmap from './DayHeatmap'

/** 汇总里可跳转的落点（由宿主映射成「打开哪个面板」，面板本身不认识路由）。 */
export type StatsJump = 'vocab' | 'writing' | 'retell' | 'readDone' | 'golden'

const HEAT_WEEKS = [13, 26, 52]

/**
 * 统计面板（右侧「统计」Tab）：今日/周/月的听说读写词活动量、跨模块汇总、练习正确率、
 * 热力图（点某天看当天明细）、最近练习。
 *
 * 口径全部在 `core/`：活动量 `core/activity`、练习 `core/practice`、
 * 六类记录的区间汇总 `core/statsSummary`。这里只做展示与跳转，不自己算日期。
 *
 * 底部的「重建并核对」只是把动作与结果接进来：重建在服务端做，文案由 core 给。
 */
export default function StatsPanel({
  activity,
  practice,
  studyDays,
  writingHistory,
  retells,
  readDone,
  goldenDrills,
  onJump,
  jumpable,
  onRebuild,
  rebuildBusy = false,
  rebuildNote = null,
  rebuildMatched = false,
}: {
  activity: DayActivity[]
  practice: PracticeRecord[]
  /** 背单词按天（张数 + 秒数） */
  studyDays: StudyDay[]
  /** 仿写 / 金句课批改记录 */
  writingHistory: WritingRecord[]
  /** 复述打卡 */
  retells: RetellRecord[]
  /** 读完的篇目 */
  readDone: ReadDone[]
  /** 金句课每句进度 */
  goldenDrills: GoldenDrillRecord[]
  /** 点汇总里的指标时跳到对应面板；不传则该行不可点 */
  onJump?: (target: StatsJump) => void
  /** 各落点当前能不能去（如没打开文章时写作 / 复述 / 金句不可用）；缺省都算能去 */
  jumpable?: Partial<Record<StatsJump, boolean>>
  /** 重建派生聚合 + 与本地对账；不传则不显示这块 */
  onRebuild?: () => void
  rebuildBusy?: boolean
  rebuildNote?: string | null
  rebuildMatched?: boolean
}) {
  const today = new Date()
  const tk = dayKeyLocal(today)
  const weekFrom = (() => {
    const d = new Date(today)
    d.setDate(d.getDate() - 6)
    return dayKeyLocal(d)
  })()
  // 月起点也走**逻辑日**：凌晨 0–4 点还属于前一天，日历月 1 日直接拼会得到
  // from > to（本月统计空一档）。tk 已经是逻辑日，取它的年月即可。
  const monthFrom = `${tk.slice(0, 7)}-01`

  const todayCats = sumCats(activity, tk, tk)
  const weekCats = sumCats(activity, weekFrom, tk)
  const monthCats = sumCats(activity, monthFrom, tk)
  const streak = activityStreak(activity, today)

  const pct = (s: { total: number; correct: number }) =>
    s.total ? `${s.correct}/${s.total}（${Math.round((s.correct / s.total) * 100)}%）` : '—'
  const kindSums = sumByKind(practice)

  const line = (label: string, cats: Record<ActivityCat, number>) => (
    <div className="stat-line">
      <span className="stat-name">{label}</span>
      {ACTIVITY_CATS.map((c) => (
        <span key={c} className="stat-cat">
          {ACTIVITY_LABEL[c]} {cats[c]}
        </span>
      ))}
      <b className="stat-total">{ACTIVITY_CATS.reduce((s, c) => s + cats[c], 0)}</b>
    </div>
  )

  /** 六份记录打包一次，三个区间 + 当天明细共用同一套判定。 */
  const input = useMemo<StatsInput>(
    () => ({ studyDays, writingHistory, retells, readDone, goldenDrills, practice }),
    [studyDays, writingHistory, retells, readDone, goldenDrills, practice],
  )
  const week = useMemo(() => summarizeRange(input, weekFrom, tk), [input, weekFrom, tk])
  const month = useMemo(() => summarizeRange(input, monthFrom, tk), [input, monthFrom, tk])
  // 「累计」= 到逻辑今天为止的全部记录（记录本身有上限：活动 400 天 / 练习 500 条）。
  const all = useMemo(() => summarizeRange(input, '0000-01-01', tk), [input, tk])

  const [weeks, setWeeks] = useState(13)
  const [day, setDay] = useState<string | null>(null)
  const heatDates = useMemo(
    () => activity.filter((a) => dayTotal(a) > 0).map((a) => [a.day, dayTotal(a)] as [string, number]),
    [activity],
  )
  const detail = useMemo(() => (day ? dayDetail(input, activity, day) : null), [input, activity, day])

  /** `12 张` / `—`（0 显示成破折号，避免一排 0 噪声）。 */
  const unit = (n: number, u: string) => (n > 0 ? `${n} ${u}` : '—')

  /** 汇总表：行 = 指标（可点跳转），列 = 本周 / 本月 / 累计；明细（时长 / 字数 / 正确率）放 title。 */
  const rows: { key: string; label: string; target: StatsJump | null; cells: { text: string; title?: string }[] }[] = [
    {
      key: 'study',
      label: '背词',
      target: 'vocab',
      cells: [week, month, all].map((r) => ({
        text: unit(r.study.cards, '张'),
        title: r.study.cards > 0 ? `共 ${fmtSpan(r.study.seconds)}` : undefined,
      })),
    },
    {
      key: 'writing',
      label: '写作',
      target: 'writing',
      cells: [week, month, all].map((r) => ({
        text: unit(r.writing.count, '篇'),
        title: r.writing.count > 0 ? `共 ${r.writing.words} 字` : undefined,
      })),
    },
    {
      key: 'retell',
      label: '复述',
      target: 'retell',
      cells: [week, month, all].map((r) => ({
        text: unit(r.retell.count, '条'),
        title: r.retell.count > 0 ? `共 ${r.retell.words} 字` : undefined,
      })),
    },
    {
      key: 'readDone',
      label: '读完',
      target: 'readDone',
      cells: [week, month, all].map((r) => ({ text: unit(r.readDone, '篇') })),
    },
    {
      key: 'golden',
      label: '金句',
      target: 'golden',
      cells: [week, month, all].map((r) => ({ text: unit(r.golden, '句') })),
    },
    {
      key: 'practice',
      label: '练习',
      target: null,
      cells: [week, month, all].map((r) => ({
        text: unit(r.practice.total, '道'),
        title: r.practice.total > 0 ? pct(r.practice) : undefined,
      })),
    },
  ]

  return (
    <>
      <div className="side-label">今日 · 🔥 {streak} 天连续</div>
      {line('今日', todayCats)}
      <div className="side-label">近 7 天</div>
      {line('本周', weekCats)}
      <div className="side-label">本月（{today.getMonth() + 1} 月）</div>
      {line('本月', monthCats)}

      <div className="side-label">汇总{onJump ? '（点整行跳到对应面板）' : ''}</div>
      <table className="stat-summary">
        <thead>
          <tr>
            <th scope="col" className="stat-head" />
            <th scope="col" className="stat-head">
              本周
            </th>
            <th scope="col" className="stat-head">
              本月
            </th>
            <th scope="col" className="stat-head">
              累计
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // 整行可点：标签是键盘入口（button 的回车/空格会冒泡上来），数字格靠行点击；
            // 落点当前去不了（没打开文章）就只显示置灰的标签，不做假按钮。
            const canJump = !!(r.target && onJump && jumpable?.[r.target] !== false)
            const disabled = !!(r.target && jumpable?.[r.target] === false)
            return (
              <tr
                key={r.key}
                className={canJump ? 'stat-row-btn' : undefined}
                onClick={canJump ? () => onJump?.(r.target!) : undefined}
              >
                <th scope="row">
                  {canJump ? (
                    <button type="button" className="stat-jump" title={`打开${r.label}`}>
                      {r.label}
                      <span className="stat-arrow" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ) : (
                    <span className={'stat-metric' + (disabled ? ' off' : '')} title={disabled ? '先打开一篇文章' : undefined}>
                      {r.label}
                    </span>
                  )}
                </th>
                {r.cells.map((c, i) => (
                  <td key={i} className={'stat-cell' + (c.text === '—' ? ' zero' : '')} title={c.title}>
                    {c.text}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="side-label">练习正确率（按题型）</div>
      <div className="stat-line">
        <span className="stat-name">本周</span>
        <span className="stat-cat">{pct(week.practice)}</span>
      </div>
      <div className="stat-line">
        <span className="stat-name">本月</span>
        <span className="stat-cat">{pct(month.practice)}</span>
      </div>
      <div className="stat-line">
        <span className="stat-name">累计</span>
        <span className="stat-cat">{pct(all.practice)}</span>
      </div>
      <div className="muted">
        {(Object.keys(PRACTICE_LABEL) as PracticeKind[]).map((k) => `${PRACTICE_LABEL[k]} ${pct(kindSums[k])}`).join(' · ')}
      </div>

      <div className="side-label">
        热力图
        <span className="heat-weeks" role="group" aria-label="热力图周数">
          {HEAT_WEEKS.map((w) => (
            <button
              key={w}
              type="button"
              className={'heat-week' + (w === weeks ? ' on' : '')}
              aria-pressed={w === weeks}
              onClick={() => setWeeks(w)}
            >
              {w} 周
            </button>
          ))}
        </span>
      </div>
      <DayHeatmap
        dates={heatDates}
        picked={day ? new Set([day]) : new Set()}
        onToggle={(d) => setDay((cur) => (cur === d ? null : d))}
        weeks={weeks}
        today={today}
        titleFor={(d, count, on) => `${d}：${count} 次（点击${on ? '收起' : '查看'}当天明细）`}
        hint="（点格子看当天明细）"
      />

      {detail && (
        <div className="stat-day" role="region" aria-label={`${detail.day} 当天明细`}>
          <div className="stat-day-head">
            <b>{detail.day}</b>
            <button type="button" className="stat-day-close" onClick={() => setDay(null)}>
              收起
            </button>
          </div>
          <div className="muted">
            {ACTIVITY_CATS.map((c) => `${ACTIVITY_LABEL[c]} ${detail.cats[c]}`).join(' · ')}
          </div>
          <div className="muted">
            背词 {detail.study.cards} 张（{fmtSpan(detail.study.seconds)}）· 写作 {detail.writing.count} 篇 · 复述{' '}
            {detail.retell.count} 条 · 读完 {detail.readDone} 篇 · 金句 {detail.golden} 句 · 练习{' '}
            {detail.practice.total} 道
          </div>
        </div>
      )}

      <div className="side-label">最近练习</div>
      {practice.length ? (
        recentPractice(practice, 8).map((r, i) => (
          <div className="stat-line" key={i}>
            <span className="stat-name">{PRACTICE_LABEL[r.kind]}</span>
            <span className="stat-cat">
              {r.correct}/{r.total}（{Math.round(accuracy(r) * 100)}%）
            </span>
            <span className="stat-total muted">{new Date(r.at).toLocaleString()}</span>
          </div>
        ))
      ) : (
        <div className="muted">还没有练习记录</div>
      )}

      {onRebuild && (
        <>
          <div className="side-label">学习记录核对</div>
          <div className="muted">
            用服务端的答题事件重算题型统计（活动记录按现有聚合保留），再和本机这份比一遍。
          </div>
          <button
            type="button"
            className="stat-rebuild"
            aria-label="重建并核对学习记录"
            disabled={rebuildBusy}
            onClick={onRebuild}
          >
            {rebuildBusy ? '重建中…' : '重建并核对'}
          </button>
          {rebuildNote && (
            <div className={'stat-note' + (rebuildMatched ? '' : ' bad')} role="status" aria-live="polite">
              {rebuildNote}
            </div>
          )}
        </>
      )}
    </>
  )
}
