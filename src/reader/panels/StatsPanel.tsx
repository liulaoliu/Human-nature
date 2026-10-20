import {
  ACTIVITY_CATS,
  ACTIVITY_LABEL,
  activityStreak,
  buildHeatmap,
  calendarDayKey,
  dayKeyLocal,
  dayTotal,
  sumCats,
  type ActivityCat,
  type DayActivity,
} from '../../core/activity'
import {
  accuracy,
  PRACTICE_LABEL,
  recentPractice,
  sumByKind,
  sumPractice,
  type PracticeRecord,
} from '../../core/practice'

/**
 * 统计面板（右侧「统计」Tab）：今日/周/月的听说读写词活动量、练习正确率、热力图、最近练习。
 * 纯展示：所有派生都在这里算，外部只给 `activity` 与 `practice` 两份原始数据。
 *
 * 底部的「重建并核对」只是把动作与结果接进来：重建在服务端做，文案由 core 给。
 */
export default function StatsPanel({
  activity,
  practice,
  onRebuild,
  rebuildBusy = false,
  rebuildNote = null,
  rebuildMatched = false,
}: {
  activity: DayActivity[]
  practice: PracticeRecord[]
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
  const monthFrom = calendarDayKey(new Date(today.getFullYear(), today.getMonth(), 1))

  const todayCats = sumCats(activity, tk, tk)
  const weekCats = sumCats(activity, weekFrom, tk)
  const monthCats = sumCats(activity, monthFrom, tk)
  const streak = activityStreak(activity, today)

  const counts: Record<string, number> = {}
  for (const a of activity) counts[a.day] = dayTotal(a)
  const heat = buildHeatmap(counts, 13, today)

  const pct = (s: { total: number; correct: number }) =>
    s.total ? `${s.correct}/${s.total}（${Math.round((s.correct / s.total) * 100)}%）` : '—'
  const weekPractice = sumPractice(practice.filter((r) => dayKeyLocal(new Date(r.at)) >= weekFrom))
  const monthPractice = sumPractice(practice.filter((r) => dayKeyLocal(new Date(r.at)) >= monthFrom))
  const allPractice = sumPractice(practice)
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

  return (
    <>
      <div className="side-label">今日 · 🔥 {streak} 天连续</div>
      {line('今日', todayCats)}
      <div className="side-label">近 7 天</div>
      {line('本周', weekCats)}
      <div className="side-label">本月（{today.getMonth() + 1} 月）</div>
      {line('本月', monthCats)}

      <div className="side-label">练习正确率（考试 / 听写 / 听力）</div>
      <div className="stat-line">
        <span className="stat-name">本周</span>
        <span className="stat-cat">{pct(weekPractice)}</span>
      </div>
      <div className="stat-line">
        <span className="stat-name">本月</span>
        <span className="stat-cat">{pct(monthPractice)}</span>
      </div>
      <div className="stat-line">
        <span className="stat-name">累计</span>
        <span className="stat-cat">{pct(allPractice)}</span>
      </div>
      <div className="muted">
        考试 {pct(kindSums.quiz)} · 听写 {pct(kindSums.dictation)} · 听力 {pct(kindSums.listening)}
      </div>

      <div className="side-label">近 13 周热力图</div>
      <div className="heat">
        <div className="heat-months">
          {heat.monthLabels.map((m) => (
            <span key={`${m.col}-${m.label}`} style={{ gridColumnStart: m.col + 1 }}>
              {m.label}月
            </span>
          ))}
        </div>
        <div className="heat-grid">
          {heat.cells.map((col, ci) =>
            col.map((cell, ri) => (
              <div
                key={`${ci}-${ri}`}
                className={'heat-cell' + (cell.future ? ' future' : ' lv' + cell.level)}
                title={cell.future ? '' : `${cell.key}：${cell.count}`}
              />
            )),
          )}
        </div>
      </div>
      <div className="muted heat-legend">
        少 <span className="heat-cell lv0" /> <span className="heat-cell lv1" />{' '}
        <span className="heat-cell lv2" /> <span className="heat-cell lv3" />{' '}
        <span className="heat-cell lv4" /> 多
      </div>

      <div className="side-label">最近练习（考试 / 听写 / 听力理解）</div>
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
            用服务端的答题事件重算活动与题型统计，再和本机这份比一遍；只比对，不改数据。
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
