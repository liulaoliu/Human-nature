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

/**
 * 手动加/改语言点：结构 / 语法 / 习语 / 词组 / 用法。
 * 写回 `Sentence.language`，和 AI 生成的语言点同一份数据结构。
 */
export default function LanguageEditor({ sentence, onSave, onClose }: LanguageEditorProps) {
  const [structure, setStructure] = useState('')
  const [grammar, setGrammar] = useState('')
  const [idioms, setIdioms] = useState('')
  const [phrases, setPhrases] = useState('')
  const [usage, setUsage] = useState('')

  // 换句 / 打开时用该句已有的语言点预填
  useEffect(() => {
    const L = sentence?.language
    setStructure(L?.structure ?? '')
    setGrammar(L?.grammar ?? '')
    setIdioms((L?.idioms ?? []).join('；'))
    setPhrases((L?.phrases ?? []).join('；'))
    setUsage((L?.usage ?? []).join('；'))
  }, [sentence])

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
          <b>＋ 语言点</b>
          <span className="muted ellipsis" title={sentence?.text}>
            {sentence?.text}
          </span>
        </div>
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
