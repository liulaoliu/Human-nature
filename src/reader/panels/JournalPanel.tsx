import type { JournalDay } from '../../core/journal'

export interface JournalPanelProps {
  onClose: () => void
  /** 有记录的日期（倒序） */
  days: string[]
  day: string
  onDayChange: (day: string) => void
  data: JournalDay
  /** 点词朗读 */
  onSpeak: (text: string) => void
}

const CAT_LABEL: Record<string, string> = { read: '读', vocab: '词', listen: '听', write: '写', speak: '说' }

/**
 * 学习日志：按天回顾 —— 那天新增了哪些生词 / 语言点、背过哪些词、活动量与练习成绩。
 * 数据来自本地（生词 createdAt、studiedToday、语言点 at、activity、practice）。
 */
export default function JournalPanel({ onClose, days, day, onDayChange, data, onSpeak }: JournalPanelProps) {
  const idx = days.indexOf(day)
  const prev = idx >= 0 && idx + 1 < days.length ? days[idx + 1] : null // days 是倒序：下一个更早
  const next = idx > 0 ? days[idx - 1] : null
  const act = Object.entries(data.activity).filter(([, n]) => n > 0)

  const picker = (
    <select value={day} onChange={(e) => onDayChange(e.target.value)} title="选一天">
      {days.length ? null : <option value={day}>{day}</option>}
      {days.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  )

  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel journal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>📅 学习日志</b>
          <button onClick={() => prev && onDayChange(prev)} disabled={!prev} title="前一天">
            ◀
          </button>
          {picker}
          <button onClick={() => next && onDayChange(next)} disabled={!next} title="后一天">
            ▶
          </button>
          <span className="muted">
            新增 {data.addedWords.length} 词 · 背了 {data.studied.length} 词 · 语言点 {data.addedLanguages.length}
          </span>
          <button onClick={onClose}>关闭</button>
        </div>

        {act.length > 0 && (
          <div className="jsec">
            <b>当天活动</b>
            <div className="muted">
              {act.map(([k, n]) => `${CAT_LABEL[k] ?? k} ${n}`).join(' · ')}
            </div>
          </div>
        )}

        {data.practice.length > 0 && (
          <div className="jsec">
            <b>练习成绩</b>
            {data.practice.map((p) => (
              <div className="muted" key={p.kind}>
                {p.kind}：{p.correct}/{p.total}
                {p.total ? `（${Math.round((p.correct / p.total) * 100)}%）` : ''}
              </div>
            ))}
          </div>
        )}

        <div className="jsec">
          <b>当天新增生词（{data.addedWords.length}）</b>
          {data.addedWords.length ? (
            <div className="jchips">
              {data.addedWords.map((it) => (
                <button className="jchip" key={it.id} onClick={() => onSpeak(it.word)} title="点读">
                  {it.word}
                  {it.meaning ? <span className="muted"> {it.meaning}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="muted">没有</div>
          )}
        </div>

        <div className="jsec">
          <b>当天背过的词（{data.studied.length}）</b>
          {data.studied.length ? (
            <div className="jchips">
              {data.studied.map((it) => (
                <button className="jchip" key={it.id} onClick={() => onSpeak(it.word)} title="点读">
                  {it.word}
                </button>
              ))}
            </div>
          ) : (
            <div className="muted">没有</div>
          )}
        </div>

        <div className="jsec">
          <b>当天新增语言点（{data.addedLanguages.length}）</b>
          {data.addedLanguages.length ? (
            <div className="jlist">
              {data.addedLanguages.map((L, i) => (
                <div className="jlang" key={`${L.articleId}:${L.sentenceId}:${i}`}>
                  <div className="muted jlang-src">
                    {L.manual ? '手动' : 'AI'} · {L.articleTitle || L.articleId} · {L.at.slice(11, 16)}
                  </div>
                  <div className="jlang-sent">{L.sentence}</div>
                  {L.structure && <div>结构：{L.structure}</div>}
                  {L.grammar && <div>语法：{L.grammar}</div>}
                  {L.idioms?.length ? <div>习语：{L.idioms.join('；')}</div> : null}
                  {L.phrases?.length ? <div>词组：{L.phrases.join('；')}</div> : null}
                  {L.usage?.length ? <div>用法：{L.usage.join('；')}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">没有（语言点从生成/添加那天起才有记录）</div>
          )}
        </div>
      </div>
    </div>
  )
}
