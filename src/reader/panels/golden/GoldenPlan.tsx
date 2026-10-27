import type { GoldenPickMode } from '../../../types/document'
import { ROLE_LABEL } from './shared'
import type { GoldenPlanApi } from './types'

export default function GoldenPlan({ api }: { api: GoldenPlanApi }) {
  const lesson = api.lesson
  const selected = new Set(lesson?.selected ?? [])
  const pick = lesson?.options?.pick ?? 'recommended'
  const modes: { key: GoldenPickMode; label: string; hint: string }[] = [
    { key: 'recommended', label: '推荐', hint: '按语言点/搭配/生词打分，默认 10 句' },
    { key: 'all', label: '全篇', hint: '按原文顺序全部练（长文慎用）' },
    { key: 'manual', label: '手动', hint: '自己勾句子' },
    { key: 'ai', label: 'AI 推荐', hint: '用 AI 挑的金句' },
  ]
  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={() => api.setView('home')}>← 课程页</button>
        <b>梳理思路 · 选金句</b>
        <button className="primary" onClick={() => api.startDrill()} disabled={!selected.size}>
          开始练（{selected.size} 句）
        </button>
      </div>
      <div className="golden-outline">
        {lesson?.outline.map((sec) => (
          <div className="golden-sec" key={sec.paraId}>
            <b>{ROLE_LABEL[sec.role]}</b>
            {sec.points.map((p, i) => <span className="muted" key={i}>{p}</span>)}
          </div>
        ))}
      </div>
      <div className="bar golden-modes">
        <span className="muted">金句来源</span>
        {modes.map((m) => (
          <button
            key={m.key}
            className={pick === m.key ? 'primary' : ''}
            onClick={() => api.setPick(m.key)}
            disabled={m.key === 'ai' && !lesson?.aiSelected?.length}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
        <label className="check-inline" title="同一词块只在本课第一次出现的地方练；默认关（按句独立）">
          <input type="checkbox" checked={lesson?.options?.dedupe === true} onChange={(e) => api.setDedupe(e.target.checked)} />
          本课去重
        </label>
      </div>
      <div className="golden-cand-list">
        {api.candidates.map((c) => {
          const s = api.doc?.sentences.find((x) => x.id === c.id)
          if (!s) return null
          const on = selected.has(c.id)
          return (
            <label className={'golden-cand' + (on ? ' on' : '')} key={c.id}>
              <input type="checkbox" checked={on} onChange={() => api.toggleSentence(c.id)} />
              <span className="golden-cand-text">
                <b>{s.text}</b>
                {s.translation && <small>{s.translation}</small>}
                <small className="golden-reason">{c.reasons.join(' · ') || '可练'}</small>
              </span>
              <span className="golden-score">{c.score}</span>
            </label>
          )
        })}
        {!api.candidates.length && <div className="muted">这篇还没有可用的句子。</div>}
      </div>
    </div>
  )
}
