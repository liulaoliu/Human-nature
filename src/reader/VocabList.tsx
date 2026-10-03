import type { VocabItem } from '../types/document'
import type { ReviewGrade } from '../core/vocab'

interface Props {
  items: VocabItem[]
  view: 'card' | 'table'
  focusLemma: string | null
  confirmDel: string | null
  onJump: (item: VocabItem) => void
  onSpeak: (word: string) => void
  onDelete: (id: string) => void
  onReview: (id: string, grade: ReviewGrade) => void
  onEdit: (id: string, meaning: string) => void
}

/** 生词本列表（卡片 / 书本式表格），侧栏与「全部生词」视图共用。 */
export default function VocabList({
  items,
  view,
  focusLemma,
  confirmDel,
  onJump,
  onSpeak,
  onDelete,
  onReview,
  onEdit,
}: Props) {
  if (view === 'table') {
    return (
      <table className="vtable">
        <thead>
          <tr>
            <th>单词</th>
            <th>含义</th>
            <th>用法</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.id}
              data-lemma={it.lemma}
              className={it.lemma === focusLemma ? 'focus' : ''}
              onClick={() => onJump(it)}
              title={it.examples[0]?.text ?? ''}
            >
              <td className="cell-word">
                {it.word}
                {it.phonetic && (
                  <span
                    className="cell-phon"
                    title="点读发音"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSpeak(it.word)
                    }}
                  >
                    {it.phonetic}
                  </span>
                )}
              </td>
              <td className="cell-meaning">
                {it.partOfSpeech && <span className="cell-pos">{it.partOfSpeech} </span>}
                {it.meaning ?? ''}
              </td>
              <td className="cell-usage">{it.usage.join('；')}</td>
              <td className="cell-act">
                <button
                  className={confirmDel === it.id ? 'danger' : ''}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(it.id)
                  }}
                  title={confirmDel === it.id ? '再点一次确认删除' : '删除（需两步确认）'}
                >
                  {confirmDel === it.id ? '确认' : '×'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <>
      {items.map((it) => (
        <div
          className={'entry' + (it.lemma === focusLemma ? ' focus' : '')}
          key={it.id}
          data-lemma={it.lemma}
        >
          <div className="w" onClick={() => onJump(it)} title="回到原文这句">
            {it.word}{' '}
            {it.phonetic && (
              <span
                className="ph"
                title="点读发音"
                onClick={(e) => {
                  e.stopPropagation()
                  onSpeak(it.word)
                }}
              >
                {it.phonetic}
              </span>
            )}
          </div>
          {it.partOfSpeech && <div className="mu">{it.partOfSpeech}</div>}
          {it.meaning && <div className="mu">{it.meaning}</div>}
          {it.usage.length > 0 && <div className="mu">{it.usage.join('；')}</div>}
          {it.examples.slice(0, 1).map((ex, i) => (
            <div className="ex" key={i}>
              {ex.text}
              {ex.translation ? ` — ${ex.translation}` : ''}
            </div>
          ))}
          <div className="muted">
            状态：{it.status}
            {it.reviewState.lapses ? ` · 错 ${it.reviewState.lapses}` : ''}
            {it.source ? ` · ${it.source.articleId}` : ''}
          </div>
          <div className="row">
            <button onClick={() => onReview(it.id, 'again')}>重来</button>
            <button onClick={() => onReview(it.id, 'good')}>记得</button>
            <button onClick={() => onReview(it.id, 'easy')}>简单</button>
            <button
              onClick={() => {
                const m = window.prompt('修改含义', it.meaning ?? '')
                if (m !== null) onEdit(it.id, m)
              }}
            >
              改释义
            </button>
            <button
              className={confirmDel === it.id ? 'danger' : ''}
              onClick={() => onDelete(it.id)}
              title="两步确认，防误触"
            >
              {confirmDel === it.id ? '确认删除' : '删除'}
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
