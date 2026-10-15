import { Fragment, useState } from 'react'
import type { VocabItem } from '../types/document'
import type { ReviewGrade } from '../core/vocab'
import { displayMeaning, normalizePos, vocabCardBlocks } from '../core/vocab'
import { dayKeyLocal } from '../core/activity'
import VocabBlocks from './panels/VocabBlocks'

/** 生词本里可改的字段（单词本身、音标、词性、释义、用法、词组、习语、语法标记）。 */
export interface VocabEditPatch {
  word?: string
  phonetic?: string | null
  partOfSpeech?: string | null
  meaning?: string | null
  usage?: string[]
  phrases?: string[]
  idioms?: string[]
  grammarMarks?: string[]
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
  phrases: string
  idioms: string
  grammarMarks: string
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
      phrases: (it.phrases ?? []).join('；'),
      idioms: (it.idioms ?? []).join('；'),
      grammarMarks: (it.grammarMarks ?? []).join('；'),
    })
  }
  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
  }
  const saveEdit = (it: VocabItem) => {
    if (!draft) return
    const split = (s: string) =>
      s
        .split(/[;；\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
    onEdit(it.id, {
      word: draft.word.trim() || it.word,
      phonetic: draft.phonetic.trim() || null,
      partOfSpeech: draft.partOfSpeech.trim() || null,
      meaning: draft.meaning.trim() || null,
      usage: split(draft.usage),
      phrases: split(draft.phrases),
      idioms: split(draft.idioms),
      grammarMarks: split(draft.grammarMarks),
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
      <label className="wide">
        词组（分号分隔）
        <input
          value={draft?.phrases ?? ''}
          placeholder="run out of；run a business"
          onChange={(e) => setDraft((d) => (d ? { ...d, phrases: e.target.value } : d))}
        />
      </label>
      <label className="wide">
        习语（分号分隔）
        <input
          value={draft?.idioms ?? ''}
          placeholder="run in the family"
          onChange={(e) => setDraft((d) => (d ? { ...d, idioms: e.target.value } : d))}
        />
      </label>
      <label className="wide">
        语法标记（分号分隔）
        <input
          value={draft?.grammarMarks ?? ''}
          placeholder="可数；不可数 / 及物；不及物 / 可分级"
          onChange={(e) => setDraft((d) => (d ? { ...d, grammarMarks: e.target.value } : d))}
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
                <td
                  className="cell-word"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSpeak(it.word)
                  }}
                  title="点读发音"
                >
                  {numberOf && numberOf(it) != null && <span className="wnum-badge">{numberOf(it)}</span>}
                  {it.word}
                  {it.phonetic && <span className="cell-phon">{it.phonetic}</span>}
                </td>
                <td className="cell-meaning">
                  {it.partOfSpeech && <span className="cell-pos">{it.partOfSpeech} </span>}
                  {it.meaning ?? ''}
                  {it.grammarMarks?.length ? (
                    <span className="grammar-marks">
                      {it.grammarMarks.map((m) => (
                        <span className="gmark" key={m}>
                          {m}
                        </span>
                      ))}
                    </span>
                  ) : null}
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
                onClick={() => onSpeak(it.word)}
                title="点读发音"
              >
                {numberOf && numberOf(it) != null && <span className="wnum-badge">{numberOf(it)}</span>}
                {it.word}{' '}
                {it.phonetic && <span className="ph">{it.phonetic}</span>}
              </div>
              {normalizePos(it.partOfSpeech) && <div className="mu">{normalizePos(it.partOfSpeech)}</div>}
              {displayMeaning(it) && <div className="mu">{displayMeaning(it)}</div>}
              {it.grammarMarks?.length ? (
                <div className="grammar-marks">
                  {it.grammarMarks.map((m) => (
                    <span className="gmark" key={m}>
                      {m}
                    </span>
                  ))}
                </div>
              ) : null}
              {it.note && <div className="note">{it.note}</div>}
              <VocabBlocks blocks={vocabCardBlocks(it, { maxExamples: 2 })} />
              <div className="muted">
                状态：{it.status}
                {it.reviewState.lapses ? ` · 错 ${it.reviewState.lapses}` : ''}
                {it.source ? ` · ${it.source.articleId}` : ''}
                {it.createdAt ? ` · 加入 ${dayKeyLocal(new Date(it.createdAt))}` : ''}
              </div>
              <div className="row">
                <button onClick={() => onReview(it.id, 'again')}>重来</button>
                <button onClick={() => onReview(it.id, 'good')}>记得</button>
                <button onClick={() => onReview(it.id, 'easy')}>简单</button>
                {onJump && (
                  <button onClick={() => onJump(it)} title="回到原文这句">
                    回原文
                  </button>
                )}
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
