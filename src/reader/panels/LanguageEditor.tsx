import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Sentence, SentenceLanguage } from '../../types/document'
import { KIND_LABEL } from '../../core/entryKind'
import {
  EMPTY_LANGUAGE_FORM,
  getSentenceLanguages,
  languageFromForm,
  languagePreview,
  languageToForm,
  type LanguageForm,
} from '../../core/language'

export interface LanguageEditorProps {
  sentence: Sentence | null
  onSave: (langs: SentenceLanguage[]) => void
  onClose: () => void
}

/** 五个字段的标签 / 占位 / 初始行数；输入框统一用 textarea，可以换行。 */
const FIELDS: { key: keyof LanguageForm; label: string; placeholder: string; rows: number }[] = [
  { key: 'structure', label: '结构', placeholder: '句子主干 + 从句/非谓语/插入语…', rows: 3 },
  { key: 'grammar', label: '语法', placeholder: '时态 / 语态 / 倒装 / 比较…', rows: 2 },
  { key: 'idioms', label: KIND_LABEL.idiom, placeholder: '多个用「；」或换行分隔', rows: 2 },
  { key: 'phrases', label: KIND_LABEL.phrase, placeholder: '多个用「；」或换行分隔', rows: 2 },
  { key: 'usage', label: KIND_LABEL.usage, placeholder: '多个用「；」或换行分隔', rows: 2 },
]

/**
 * 语言点编辑（列表式）：**一句可多条**——可新增、逐条编辑/删除；AI 生成的那条标「AI」，手动的标「手动」。
 * 写回 `Sentence.languages`（兼容旧的单条 `language`）。
 *
 * **列表里每一条都能点开编辑**（整行可点，AI 与手动一样），右边的小按钮只是看得见的入口；
 * 点「删除」不会顺带进入编辑。阅读页与速读页**共用这一个编辑器**（都由 `ReaderOverlaysHost`
 * 打开）：表单规则在 `core/language`，这里只负责渲染与本地草稿。**点遮罩不会关闭**——
 * 只有「保存 / 取消」才关闭，避免填了一半误点把草稿弄丢。
 */
export default function LanguageEditor({ sentence, onSave, onClose }: LanguageEditorProps) {
  const [langs, setLangs] = useState<SentenceLanguage[]>(() => getSentenceLanguages(sentence))
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [form, setForm] = useState<LanguageForm>(EMPTY_LANGUAGE_FORM)
  /** 当前展开的字段：点到哪个框，哪个框就长到对话框剩余高度；点框外收回。 */
  const [expanded, setExpanded] = useState<keyof LanguageForm | null>(null)
  /** 这次点击是否**按在输入框里**：展开会让布局瞬间移动，click 的 target 可能已经偏了，不能只看 target。 */
  const pressInFieldRef = useRef(false)
  /** 表单区：点条目后滚到它，别让人以为「点了没反应」。 */
  const formRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLangs(getSentenceLanguages(sentence))
    setEditIdx(null)
    setForm(EMPTY_LANGUAGE_FORM)
    setExpanded(null)
  }, [sentence])

  const startNew = () => {
    setEditIdx(null)
    setForm(EMPTY_LANGUAGE_FORM)
    setExpanded(null)
  }
  const startEdit = (i: number) => {
    const next = languageToForm(langs[i])
    setEditIdx(i)
    setForm(next)
    setExpanded(null)
    // 列表在上、表单在下：把表单**居中**滚进对话框可视区。
    // 用 nearest 时表单若只露出一角就不会滚，看起来像「点了没反应」；这里强制滚动。
    // （jsdom 没有 scrollIntoView，兜一下。）
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView?.({ block: 'center' }))
  }
  const remove = (i: number) => {
    setLangs((l) => l.filter((_, k) => k !== i))
    setEditIdx((e) => (e === i ? null : e != null && e > i ? e - 1 : e))
    setForm(EMPTY_LANGUAGE_FORM)
    setExpanded(null)
  }
  const commit = () => {
    const entry = languageFromForm(form)
    if (!Object.keys(entry).length) return
    const now = new Date().toISOString()
    if (editIdx === null) {
      setLangs((l) => [...l, { ...entry, source: 'manual', at: now }])
    } else {
      setLangs((l) => l.map((x, k) => (k === editIdx ? { ...entry, source: x.source ?? 'manual', at: x.at ?? now } : x)))
    }
    startNew()
  }

  const setField = (key: keyof LanguageForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  /** 点「正在展开的框」以外的地方：收回原高度（不关闭对话框；保存 / 取消仍走按钮）。 */
  const collapseOutside = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!expanded) return
    const fromField = pressInFieldRef.current
    pressInFieldRef.current = false
    // 按在框里就算点中：展开那一下会把布局挪走，click 的 target 不能作准。
    if (fromField) return
    const t = e.target as HTMLElement
    if (t.closest('.lang-form label, button, a, input, textarea, select')) return
    setExpanded(null)
  }

  /** 保存：把「正在填的这条」也一并收进来再写回（避免只点了下面「保存」而漏掉表单内容）。 */
  const saveAll = () => {
    const entry = languageFromForm(form)
    let list = langs
    if (Object.keys(entry).length) {
      const now = new Date().toISOString()
      if (editIdx === null) list = [...langs, { ...entry, source: 'manual', at: now }]
      else list = langs.map((x, k) => (k === editIdx ? { ...entry, source: x.source ?? 'manual', at: x.at ?? now } : x))
    }
    onSave(list)
  }

  return (
    <div className="lang-editor-overlay" onClick={() => setExpanded(null)}>
      <div
        className={'lang-editor' + (expanded ? ' expanded' : '')}
        role="dialog"
        aria-modal="true"
        aria-label="语言点编辑"
        onMouseDown={(e) => {
          pressInFieldRef.current = !!(e.target as HTMLElement).closest('.lang-form label')
        }}
        onClick={(e) => {
          e.stopPropagation()
          collapseOutside(e)
        }}
      >
        <div className="bar lang-editor-bar">
          <b>语言点（{langs.length}）</b>
          <span className="muted ellipsis" title={sentence?.text}>
            {sentence?.text}
          </span>
        </div>

        {langs.length > 0 && (
          <div className="lang-list">
            {langs.map((L, i) => (
              <div
                className={'lang-item clickable' + (editIdx === i ? ' editing' : '')}
                key={i}
                title="点一下编辑这条（AI 写的也能改）"
                onClick={() => startEdit(i)}
              >
                <div className="lang-item-head">
                  <span className={'lang-tag' + (L.source === 'ai' ? ' ai' : '')}>{L.source === 'ai' ? 'AI' : '手动'}</span>
                  <span className="muted ellipsis" title={languagePreview(L)}>
                    {languagePreview(L)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(i)
                    }}
                    title="编辑这条"
                  >
                    编辑
                  </button>
                  <button
                    className="danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(i)
                    }}
                    title="删除这条"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* key 跟着「编辑哪条」变：切换条目时表单重新挂载，播一次进场高亮，
            让「点了一下」有肉眼可见的反馈（否则只改值，用户以为没反应）。 */}
        <div className="lang-form" ref={formRef} key={editIdx ?? 'new'}>
          <div className="muted lang-form-head">
            {editIdx === null ? (
              '＋ 新增一条'
            ) : (
              <>
                <span>编辑第 {editIdx + 1} 条</span>
                <span className={'lang-tag' + (langs[editIdx]?.source === 'ai' ? ' ai' : '')}>
                  {langs[editIdx]?.source === 'ai' ? 'AI' : '手动'}
                </span>
              </>
            )}
          </div>
          {FIELDS.map((f) => (
            <label key={f.key} className={expanded === f.key ? 'expanded' : undefined}>
              {f.label}
              <textarea
                rows={f.rows}
                value={form[f.key]}
                onFocus={() => setExpanded(f.key)}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </label>
          ))}
          <div className="bar">
            <button className="primary" onClick={commit}>
              {editIdx === null ? '＋ 加入列表' : '保存本条'}
            </button>
            {editIdx !== null && <button onClick={startNew}>取消编辑</button>}
          </div>
        </div>

        <div className="bar lang-editor-actions">
          <span className="muted lang-editor-note">
            {expanded ? '编辑中：点输入框外恢复高度' : '只有「保存」或「取消」会关闭'}
          </span>
          <button className="primary" onClick={saveAll}>
            保存
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
