import { Fragment, useState } from 'react'
import type { VocabItem } from '../types/document'
import type { ReviewGrade } from '../core/vocab'

/** 生词本里可改的字段（单词本身、音标、词性、释义、用法）。 */
export interface VocabEditPatch {
  word?: string
  phonetic?: string | null
  partOfSpeech?: string | null
  meaning?: string | null
  usage?: string[]
}

interface Props {
  items: VocabItem[]
  view: 'card' | 'table'
  focusLemma: string | null
  confirmDel: string | null
  /** 不传则点击不跳转（如「全部生词」视图） */
  onJump?: (item: VocabItem) => void
  onSpeak: (word: string) => void
  onDelete: (id: string) => void
  onReview: (id: string, grade: ReviewGrade) => void
  onEdit: (id: string, patch: VocabEditPatch) => void
  /** 显示「来源」列 / 行（文章 + 原句） */
  showSource?: boolean
  /** 词条序号（与正文对应）；返回 null 则不显示 */
  numberOf?: (item: VocabItem) => number | null
}

interface Draft {
  word: string
  phonetic: string
  partOfSpeech: string
  meaning: string
  usage: string
}

/** 生词本列表（卡片 / 书本式表格），侧栏与「全部生词」视图共用；支持就地编辑。 */
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
  showSource = false,
  numberOf,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const startEdit = (it: VocabItem) => {
    setEditingId(it.id)
    setDraft({
      word: it.word,
      phonetic: it.phonetic ?? '',
      partOfSpeech: it.partOfSpeech ?? '',
      meaning: it.meaning ?? '',
      usage: it.usage.join('；'),
    })
  }
  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
  }
  const saveEdit = (it: VocabItem) => {
    if (!draft) return
    onEdit(it.id, {
      word: draft.word.trim() || it.word,
      phonetic: draft.phonetic.trim() || null,
      partOfSpeech: draft.partOfSpeech.trim() || null,
      meaning: draft.meaning.trim() || null,
      usage: draft.usage
        .split(/[;；\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    })
    cancelEdit()
  }

  const editor = (it: VocabItem) => (
    <div className={'edit-inline' + (view === 'table' ? ' in-table' : '')}>
      <label>
        单词
        <input value={draft?.word ?? ''} onChange={(e) => setDraft((d) => (d ? { ...d, word: e.target.value } : d))} />
      </label>
      <label>
        音标
        <input
          value={draft?.phonetic ?? ''}
          placeholder="/.../"
          onChange={(e) => setDraft((d) => (d ? { ...d, phonetic: e.target.value } : d))}
        />
      </label>
      <label>
        词性
        <input
          value={draft?.partOfSpeech ?? ''}
          placeholder="n. / v. / adj."
          onChange={(e) => setDraft((d) => (d ? { ...d, partOfSpeech: e.target.value } : d))}
        />
      </label>
      <label className="wide">
        释义
        <textarea
          rows={2}
          value={draft?.meaning ?? ''}
          onChange={(e) => setDraft((d) => (d ? { ...d, meaning: e.target.value } : d))}
        />
      </label>
      <label className="wide">
        用法（分号分隔）
        <input
          value={draft?.usage ?? ''}
          placeholder="run a business；run out"
          onChange={(e) => setDraft((d) => (d ? { ...d, usage: e.target.value } : d))}
        />
      </label>
      <div className="bar">
        <button className="primary" onClick={() => saveEdit(it)}>
          保存
        </button>
        <button onClick={cancelEdit}>取消</button>
      </div>
    </div>
  )

  if (view === 'table') {
    return (
      <table className={'vtable' + (showSource ? ' has-source' : '')}>
        <thead>
          <tr>
            <th>单词</th>
            <th>含义</th>
            <th>用法</th>
            {showSource && <th>来源</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <Fragment key={it.id}>
              <tr
                data-lemma={it.lemma}
                className={it.lemma === focusLemma ? 'focus' : ''}
                onClick={onJump ? () => onJump(it) : undefined}
                title={it.examples[0]?.text ?? ''}
              >
                <td className="cell-word">
                  {numberOf && numberOf(it) != null && <span className="wnum-badge">{numberOf(it)}</span>}
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
                  {it.confusables && it.confusables.length > 0 && (
                    <div className="muted">易混：{it.confusables.map((c) => c.word).join(' / ')}</div>
                  )}
                </td>
                <td className="cell-usage">{it.usage.join('；')}</td>
                {showSource && (
                  <td className="cell-source">
                    <div className="src-article">{it.source?.articleId ?? '—'}</div>
                    {it.source?.sentenceText && <div className="src-sentence">{it.source.sentenceText}</div>}
                  </td>
                )}
                <td className="cell-act">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(it)
                    }}
                    title="改单词/音标/词性/释义/用法"
                  >
                    ✎
                  </button>
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
              {editingId === it.id && (
                <tr className="edit-row">
                  <td colSpan={showSource ? 5 : 4}>{editor(it)}</td>
                </tr>
              )}
            </Fragment>
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
          {editingId === it.id ? (
            editor(it)
          ) : (
            <>
              <div
                className="w"
                onClick={onJump ? () => onJump(it) : undefined}
                title={onJump ? '回到原文这句' : undefined}
              >
                {numberOf && numberOf(it) != null && <span className="wnum-badge">{numberOf(it)}</span>}
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
              {it.confusables && it.confusables.length > 0 && (
                <div className="muted">易混：{it.confusables.map((c) => c.word).join(' / ')}</div>
              )}
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
              {showSource && it.source && (
                <div className="ex src">
                  来源：{it.source.articleId}
                  {it.source.sentenceText ? ` · ${it.source.sentenceText}` : ''}
                </div>
              )}
              <div className="row">
                <button onClick={() => onReview(it.id, 'again')}>重来</button>
                <button onClick={() => onReview(it.id, 'good')}>记得</button>
                <button onClick={() => onReview(it.id, 'easy')}>简单</button>
                <button onClick={() => startEdit(it)}>编辑</button>
                <button
                  className={confirmDel === it.id ? 'danger' : ''}
                  onClick={() => onDelete(it.id)}
                  title="两步确认，防误触"
                >
                  {confirmDel === it.id ? '确认删除' : '删除'}
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </>
  )
}
