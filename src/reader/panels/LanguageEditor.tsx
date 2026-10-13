import { useEffect, useState } from 'react'
import type { Sentence, SentenceLanguage } from '../../types/document'
import { getSentenceLanguages } from '../../core/language'

export interface LanguageEditorProps {
  sentence: Sentence | null
  onSave: (langs: SentenceLanguage[]) => void
  onClose: () => void
}

interface Form {
  structure: string
  grammar: string
  idioms: string
  phrases: string
  usage: string
}

const EMPTY: Form = { structure: '', grammar: '', idioms: '', phrases: '', usage: '' }

function splitList(s: string): string[] {
  return [...new Set(s.split(/[；;、\n]+/).map((x) => x.trim()).filter(Boolean))]
}

function toEntry(f: Form): SentenceLanguage {
  const o: SentenceLanguage = {}
  if (f.structure.trim()) o.structure = f.structure.trim()
  if (f.grammar.trim()) o.grammar = f.grammar.trim()
  const id = splitList(f.idioms)
  const ph = splitList(f.phrases)
  const us = splitList(f.usage)
  if (id.length) o.idioms = id
  if (ph.length) o.phrases = ph
  if (us.length) o.usage = us
  return o
}

function toForm(L?: SentenceLanguage): Form {
  return {
    structure: L?.structure ?? '',
    grammar: L?.grammar ?? '',
    idioms: (L?.idioms ?? []).join('；'),
    phrases: (L?.phrases ?? []).join('；'),
    usage: (L?.usage ?? []).join('；'),
  }
}

function preview(L: SentenceLanguage): string {
  return [L.structure, L.grammar, ...(L.idioms ?? []), ...(L.phrases ?? []), ...(L.usage ?? [])]
    .filter(Boolean)
    .join(' ｜ ')
}

/**
 * 语言点编辑（列表式）：**一句可多条**——可新增、逐条编辑/删除；AI 生成的那条标「AI」，手动的标「手动」。
 * 写回 `Sentence.languages`（兼容旧的单条 `language`）。
 */
export default function LanguageEditor({ sentence, onSave, onClose }: LanguageEditorProps) {
  const [langs, setLangs] = useState<SentenceLanguage[]>(() => getSentenceLanguages(sentence))
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)

  useEffect(() => {
    setLangs(getSentenceLanguages(sentence))
    setEditIdx(null)
    setForm(EMPTY)
  }, [sentence])

  const startNew = () => {
    setEditIdx(null)
    setForm(EMPTY)
  }
  const startEdit = (i: number) => {
    setEditIdx(i)
    setForm(toForm(langs[i]))
  }
  const remove = (i: number) => {
    setLangs((l) => l.filter((_, k) => k !== i))
    setEditIdx((e) => (e === i ? null : e != null && e > i ? e - 1 : e))
    setForm(EMPTY)
  }
  const commit = () => {
    const entry = toEntry(form)
    if (!Object.keys(entry).length) return
    if (editIdx === null) {
      setLangs((l) => [...l, { ...entry, source: 'manual' }])
    } else {
      setLangs((l) => l.map((x, k) => (k === editIdx ? { ...entry, source: x.source ?? 'manual' } : x)))
    }
    startNew()
  }

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="lang-editor-overlay" onClick={onClose}>
      <div className="lang-editor" onClick={(e) => e.stopPropagation()}>
        <div className="bar lang-editor-bar">
          <b>语言点（{langs.length}）</b>
          <span className="muted ellipsis" title={sentence?.text}>
            {sentence?.text}
          </span>
        </div>

        {langs.length > 0 && (
          <div className="lang-list">
            {langs.map((L, i) => (
              <div className={'lang-item' + (editIdx === i ? ' editing' : '')} key={i}>
                <div className="lang-item-head">
                  <span className={'lang-tag' + (L.source === 'ai' ? ' ai' : '')}>{L.source === 'ai' ? 'AI' : '手动'}</span>
                  <span className="muted ellipsis" title={preview(L)}>
                    {preview(L)}
                  </span>
                  <button onClick={() => startEdit(i)} title="编辑这条">
                    编辑
                  </button>
                  <button className="danger" onClick={() => remove(i)} title="删除这条">
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="lang-form">
          <div className="muted">{editIdx === null ? '＋ 新增一条' : `编辑第 ${editIdx + 1} 条`}</div>
          <label>
            结构
            <input value={form.structure} onChange={(e) => set({ structure: e.target.value })} placeholder="句子主干 + 从句/非谓语/插入语…" />
          </label>
          <label>
            语法
            <input value={form.grammar} onChange={(e) => set({ grammar: e.target.value })} placeholder="时态 / 语态 / 倒装 / 比较…" />
          </label>
          <label>
            习语
            <input value={form.idioms} onChange={(e) => set({ idioms: e.target.value })} placeholder="多个用「；」分隔" />
          </label>
          <label>
            词组
            <input value={form.phrases} onChange={(e) => set({ phrases: e.target.value })} placeholder="多个用「；」分隔" />
          </label>
          <label>
            用法
            <input value={form.usage} onChange={(e) => set({ usage: e.target.value })} placeholder="多个用「；」分隔" />
          </label>
          <div className="bar">
            <button className="primary" onClick={commit}>
              {editIdx === null ? '＋ 加入列表' : '保存本条'}
            </button>
            {editIdx !== null && <button onClick={startNew}>取消编辑</button>}
          </div>
        </div>

        <div className="bar lang-editor-actions">
          <button className="primary" onClick={() => onSave(langs)}>
            保存
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
