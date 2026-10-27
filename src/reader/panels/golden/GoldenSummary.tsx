import { useMemo } from 'react'
import { GOLDEN_TARGET_KIND_LABEL } from '../../../core/golden'
import type { GoldenSentence } from '../../../types/document'
import { isMastered, ROLE_LABEL } from './shared'
import type { GoldenSummaryApi } from './types'

export default function GoldenSummary({
  api,
  onExportMarkdown,
  onOpenWriting,
  onSpeak,
  onPrint,
}: {
  api: GoldenSummaryApi
  onExportMarkdown: () => void
  onOpenWriting?: (mustUse: string[]) => void
  onSpeak: (s: string) => void
  onPrint?: () => void
}) {
  const lesson = api.lesson
  const summary = api.summary
  const targets = useMemo(() => {
    if (!lesson) return []
    const seen = new Set<string>()
    return lesson.sentences.flatMap((s) => s.targets.filter((t) => {
      const key = `${t.kind}|${t.en.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
  }, [lesson])
  if (!lesson) return <div className="golden-body muted">还没有金句课。</div>
  return (
    <div className="golden-body">
      <div className="bar golden-drill-bar">
        <button onClick={() => api.setView('home')}>← 课程页</button>
        <b>本课素材总结</b>
        <span className="muted">{summary?.masteredSentences ?? 0}/{summary?.selectedSentences ?? 0} 句掌握</span>
        <button onClick={onExportMarkdown}>导出 Markdown</button>
        {onPrint && <button onClick={onPrint}>打印本课</button>}
        {onOpenWriting && <button onClick={() => onOpenWriting(targets.map((t) => t.en))}>去仿写</button>}
      </div>
      {lesson.outline.length > 0 && (
        <div className="golden-outline">
          {lesson.outline.map((sec) => (
            <div className="golden-sec" key={sec.paraId}>
              <b>{ROLE_LABEL[sec.role]}</b>
              {sec.points.map((p, i) => <span className="muted" key={i}>{p}</span>)}
            </div>
          ))}
        </div>
      )}
      <div className="golden-summary-list">
        {lesson.sentences.filter((s) => lesson.selected.includes(s.id)).map((s: GoldenSentence) => {
          const sentence = api.doc?.sentences.find((x) => x.id === s.id)
          const rec = api.progressFor(s.id)
          return (
            <div className="golden-summary-item" key={s.id}>
              <div className="golden-summary-head">
                <b>{s.id}</b>
                {isMastered(rec) ? <span className="golden-good">已掌握</span> : <span className="muted">待掌握</span>}
                <button onClick={() => sentence && onSpeak(sentence.text)}>🔊</button>
              </div>
              <div className="golden-en">{sentence?.text ?? ''}</div>
              {(s.zh || sentence?.translation) && <div className="muted">{s.zh ?? sentence?.translation}</div>}
              {s.pattern && <div className="golden-note">句型：{s.pattern}</div>}
              {s.tense && <div className="golden-note">时态：{s.tense}</div>}
              <div className="golden-targets">
                {s.targets.map((t, i) => (
                  <span key={i} className="golden-target"><b>{GOLDEN_TARGET_KIND_LABEL[t.kind]}</b> {t.en}{t.zh ? ` — ${t.zh}` : ''}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
