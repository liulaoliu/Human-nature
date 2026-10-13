import { useEffect, useState } from 'react'
import type { Sentence, SentenceLanguage } from '../../types/document'

export interface LanguageEditorProps {
  sentence: Sentence | null
  onSave: (lang: SentenceLanguage) => void
  onClose: () => void
}

/** 把「；/;/、/换行」分隔的一行拆成数组（去空、去重）。 */
function splitList(s: string): string[] {
  return [...new Set(s.split(/[；;、\n]+/).map((x) => x.trim()).filter(Boolean))]
}

/** 该句已是否有语言点内容。 */
function hasLang(l?: SentenceLanguage): boolean {
  if (!l) return false
  return !!(l.structure || l.grammar || l.idioms?.length || l.phrases?.length || l.usage?.length)
}

/**
 * 语言点编辑：**默认「新增」——空白表单，全新填写（不带出旧内容，保存即覆盖该句）**；
 * 顶部可切到「编辑已有」预填现有内容（用于改错）。
 * 写回 `Sentence.language`，和 AI 生成的语言点同一份数据结构。
 */
export default function LanguageEditor({ sentence, onSave, onClose }: LanguageEditorProps) {
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [structure, setStructure] = useState('')
  const [grammar, setGrammar] = useState('')
  const [idioms, setIdioms] = useState('')
  const [phrases, setPhrases] = useState('')
  const [usage, setUsage] = useState('')

  const existing = sentence?.language
  const canEdit = hasLang(existing)

  // 换句 / 切换模式时刷新表单：新增=空白；编辑=预填现有
  useEffect(() => {
    const L = mode === 'edit' ? existing : undefined
    setStructure(L?.structure ?? '')
    setGrammar(L?.grammar ?? '')
    setIdioms((L?.idioms ?? []).join('；'))
    setPhrases((L?.phrases ?? []).join('；'))
    setUsage((L?.usage ?? []).join('；'))
  }, [sentence, mode, existing])

  const save = () => {
    const lang: SentenceLanguage = {}
    if (structure.trim()) lang.structure = structure.trim()
    if (grammar.trim()) lang.grammar = grammar.trim()
    const id = splitList(idioms)
    const ph = splitList(phrases)
    const us = splitList(usage)
    if (id.length) lang.idioms = id
    if (ph.length) lang.phrases = ph
    if (us.length) lang.usage = us
    onSave(lang)
  }

  return (
    <div className="lang-editor-overlay" onClick={onClose}>
      <div className="lang-editor" onClick={(e) => e.stopPropagation()}>
        <div className="bar lang-editor-bar">
          <b>{mode === 'edit' ? '编辑语言点' : '＋ 新增语言点'}</b>
          <span className="muted ellipsis" title={sentence?.text}>
            {sentence?.text}
          </span>
          <button
            onClick={() => setMode((m) => (m === 'edit' ? 'new' : 'edit'))}
            disabled={mode === 'new' && !canEdit}
            title={
              mode === 'edit'
                ? '切回「新增」：清空表单，全新填写（保存会覆盖该句现有语言点）'
                : canEdit
                  ? '载入该句现有语言点来修改（改错）'
                  : '该句还没有语言点'
            }
          >
            {mode === 'edit' ? '＋ 改为新增' : '✎ 编辑已有'}
          </button>
        </div>
        {mode === 'new' && canEdit && (
          <div className="muted lang-editor-warn">新增会覆盖该句已有语言点；只想改错请点右上「✎ 编辑已有」。</div>
        )}
        <label>
          结构
          <input value={structure} onChange={(e) => setStructure(e.target.value)} placeholder="句子主干 + 从句/非谓语/插入语…" />
        </label>
        <label>
          语法
          <input value={grammar} onChange={(e) => setGrammar(e.target.value)} placeholder="时态 / 语态 / 倒装 / 比较…" />
        </label>
        <label>
          习语
          <input value={idioms} onChange={(e) => setIdioms(e.target.value)} placeholder="多个用「；」分隔" />
        </label>
        <label>
          词组
          <input value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder="多个用「；」分隔" />
        </label>
        <label>
          用法
          <input value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="多个用「；」分隔" />
        </label>
        <div className="bar lang-editor-actions">
          <button className="primary" onClick={save}>
            保存
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
