import { KIND_LABEL } from '../../core/entryKind'
import { groupLangPoints } from '../../core/langPoints'
import type { VocabItem } from '../../types/document'

/**
 * 语言点列表（词组 / 习语 / 用法笔记）——**跟「生词」分开显示**。
 *
 * 为什么单独一个组件：语言点的数据形状跟单词不一样（词组是「英文 — 中文」、
 * 用法是一整句中文说明、都挂来源句），塞进单词卡片里两边都难读。
 * 这里只负责排版；数据分组在 core/langPoints 的 `groupLangPoints`。
 */
export default function LangPointList({
  items,
  emptyHint = '这篇还没有语言点。速读里跑过 AI「语言点」后会自动收进来。',
  onSpeak,
  onDelete,
  onEdit,
  confirmDel,
}: {
  items: VocabItem[]
  emptyHint?: string
  onSpeak?: (text: string) => void
  onDelete?: (id: string) => void
  /** 点「改」时把条目交给外面的编辑流程（复用生词本的编辑器） */
  onEdit?: (item: VocabItem) => void
  /** 已点过一次、等确认删除的 id */
  confirmDel?: string | null
}) {
  const groups = groupLangPoints(items)
  if (!groups.length) return <div className="muted empty-hint">{emptyHint}</div>

  return (
    <div className="lp-list">
      {groups.map((g) => (
        <div className="lp-group" key={g.kind}>
          <div className="lp-group-head">
            {KIND_LABEL[g.kind]}
            <span className="muted">{g.items.length}</span>
          </div>
          {g.items.map((it) => (
            <div className="lp-item" key={it.id}>
              <div className="lp-main">
                <span
                  className={'lp-word' + (onSpeak && g.kind !== 'usage' ? ' speakable' : '')}
                  onClick={onSpeak && g.kind !== 'usage' ? () => onSpeak(it.word) : undefined}
                  title={onSpeak && g.kind !== 'usage' ? '点读发音' : undefined}
                >
                  {it.word}
                </span>
                {it.meaning && <span className="lp-gloss">{it.meaning}</span>}
              </div>
              {it.source?.sentenceText && (
                <div className="lp-src" title={it.source.sentenceText}>
                  {it.source.sentenceText}
                </div>
              )}
              {(onEdit || onDelete) && (
                <div className="lp-act">
                  {onEdit && (
                    <button onClick={() => onEdit(it)} title="改这条（可在生词本编辑器里改）">
                      改
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className={confirmDel === it.id ? 'danger' : ''}
                      onClick={() => onDelete(it.id)}
                      title={confirmDel === it.id ? '再点一次确认删除' : '删除（两步确认）'}
                    >
                      {confirmDel === it.id ? '确认' : '×'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
