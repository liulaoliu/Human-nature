import { useEffect, useState } from 'react'
import { readJson, writeJson } from '../storage'

export interface PlanPanelProps {
  onClose: () => void
  hasDoc: boolean
  articleTitle: string
  /** 本篇还没跑的 AI 待办数（0 = 跑完）。 */
  todoPending: number
  /** 今天背了多少张卡。 */
  todayCards: number
  /** 今天写了多少条仿写。 */
  todayWrites: number
  /** 本地日期键 YYYY-MM-DD。 */
  todayKey: string
  onNewArticle: () => void
  onStartStudy: () => void
  onOpenSpeedRead: () => void
}

interface Step {
  id: string
  label: string
}

const STEPS: Step[] = [
  { id: 'read', label: '精读一篇 + 「⚡ 一键跑批」（补翻译 / 语言点 / 生词音标释义）' },
  { id: 'speed', label: '逐句速读一遍（生词左键选中 → 加入清单，或右键直接入库）' },
  { id: 'vocab', label: '背单词（先清今天到期，再看新词）' },
  { id: 'speak', label: '跟读 / 朗读 2–3 句，出声跟读' },
  { id: 'write', label: '仿写 1 句 + AI 批改' },
]

const planKey = (day: string) => `reader:plan:${day}`
function loadChecked(day: string): string[] {
  const v = readJson<{ checked?: unknown } | null>(planKey(day), null)
  return v && Array.isArray(v.checked) ? v.checked.filter((x): x is string => typeof x === 'string') : []
}

/**
 * 今日计划：每日清单（可勾、按天持久化，带自动提示）+ 选材料建议。
 */
export default function PlanPanel({
  onClose,
  hasDoc,
  articleTitle,
  todoPending,
  todayCards,
  todayWrites,
  todayKey,
  onNewArticle,
  onStartStudy,
  onOpenSpeedRead,
}: PlanPanelProps) {
  const [checked, setChecked] = useState<string[]>(() => loadChecked(todayKey))

  useEffect(() => {
    setChecked(loadChecked(todayKey))
  }, [todayKey])
  useEffect(() => {
    writeJson(planKey(todayKey), { checked })
  }, [todayKey, checked])

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const hint = (id: string): string => {
    if (id === 'read') return hasDoc ? (todoPending === 0 ? '✅ 本篇待办已完成' : `还剩 ${todoPending} 项待办`) : '还没打开文章'
    if (id === 'vocab') return todayCards > 0 ? `今天 ${todayCards} 张` : '今天还没背'
    if (id === 'write') return todayWrites > 0 ? `今天 ${todayWrites} 条` : '今天还没写'
    return ''
  }

  const doneCount = STEPS.filter((s) => checked.includes(s.id)).length

  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>📋 今日计划</b>
          <span className="muted">
            {todayKey} · 清单 {doneCount}/{STEPS.length}
          </span>
          <button onClick={onClose}>关闭</button>
        </div>

        <div className="plan-steps">
          {STEPS.map((s) => {
            const on = checked.includes(s.id)
            return (
              <label className={'plan-step' + (on ? ' done' : '')} key={s.id}>
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                <span className="plan-step-label">{s.label}</span>
                {hint(s.id) && <span className="plan-step-hint">{hint(s.id)}</span>}
              </label>
            )
          })}
        </div>

        <div className="plan-material">
          <b>怎么挑材料</b>
          <ul>
            <li>长度 <b>300–800 词</b>、题材你<b>感兴趣</b>、难度<b>略高</b>于当前。</li>
            <li>用「📖 本篇挑词」看超纲词：<b>&gt;15</b> 太多（换简单点的），<b>&lt;5</b> 太少（换难一点的）；<b>3–8%</b> 最合适。</li>
            <li>每天 <b>1 篇</b>就够，别贪多；重点是读完+复述，不是刷数量。</li>
            {articleTitle && <li>当前这篇：<b>{articleTitle}</b>（接着精读它就很好）。</li>}
          </ul>
          <div className="bar">
            <button onClick={onNewArticle}>＋ 新建 / 导入文章</button>
            <button onClick={onOpenSpeedRead} disabled={!hasDoc}>
              逐句速读
            </button>
            <button onClick={onStartStudy} disabled={!hasDoc}>
              去背单词
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
