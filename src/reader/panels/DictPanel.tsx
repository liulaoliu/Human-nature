import { useEffect, useRef } from 'react'
import { isClozeBlankCorrect, type ClozeQuestion, type DiffToken } from '../../core/dictation'

/** 听写面板的一个「题」：句子 id + 原文。 */
export interface DictItem {
  id: string
  text: string
}

export interface DictPanelProps {
  /** 本轮题目队列（空/未开始时不渲染本组件）。 */
  queue: DictItem[]
  index: number
  mode: 'full' | 'cloze'
  /** 整句模式每句最多多少词。 */
  words: number
  /** 填空模式每题挖几个空。 */
  blankCount: number
  checked: boolean
  diff: DiffToken[] | null
  cloze: ClozeQuestion | null
  blanks: string[]
  input: string
  results: boolean[]
  wrongItems: DictItem[]
  /** 重开一轮（可带 mode / words / blanks 改动）。 */
  onStart: (opts?: { mode?: 'full' | 'cloze'; words?: number; blanks?: number }) => void
  onCheck: () => void
  onNext: () => void
  onWrongNow: () => void
  onRetryWrong: () => void
  onClose: () => void
  onSpeak: (text: string) => void
  onInputChange: (value: string) => void
  onBlankChange: (i: number, value: string) => void
}

/** 逐句听写 / 填空：纯展示 + 事件回调，全部状态与判分逻辑在外层。 */
export default function DictPanel({
  queue,
  index,
  mode,
  words,
  blankCount,
  checked,
  diff,
  cloze,
  blanks,
  input,
  results,
  wrongItems,
  onStart,
  onCheck,
  onNext,
  onWrongNow,
  onRetryWrong,
  onClose,
  onSpeak,
  onInputChange,
  onBlankChange,
}: DictPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const firstBlankRef = useRef<HTMLInputElement>(null)

  // 换题后把焦点送回输入框（autoFocus 只首次生效，换题必须手动聚焦）
  useEffect(() => {
    if (index >= queue.length || checked) return
    if (mode === 'cloze' && cloze) firstBlankRef.current?.focus()
    else inputRef.current?.focus()
  }, [index, checked, mode, cloze, queue.length])

  const current = queue[index]
  const correct = results.filter(Boolean).length

  return (
    <div className="study dict">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <span className="view-toggle" title="整句：听写整句；填空：句中挖掉几个词来填">
          <button className={mode === 'full' ? 'primary' : ''} onClick={() => onStart({ mode: 'full' })}>
            整句
          </button>
          <button className={mode === 'cloze' ? 'primary' : ''} onClick={() => onStart({ mode: 'cloze' })}>
            填空
          </button>
        </span>
        <select
          value={String(words)}
          onChange={(e) => onStart({ words: Number(e.target.value) })}
          title="整句模式下每句最多多少词（越长越难）；改完立即重开一轮"
        >
          <option value="1">每句 1 词</option>
          <option value="2">每句 2 词</option>
          <option value="3">每句 3 词</option>
          <option value="5">每句 5 词</option>
          <option value="8">每句 8 词</option>
          <option value="12">每句 12 词</option>
          <option value="20">每句 20 词</option>
        </select>
        {mode === 'cloze' && (
          <select
            value={String(blankCount)}
            onChange={(e) => onStart({ blanks: Number(e.target.value) })}
            title="填空模式下每题挖几个空；不够空会自动并长句子"
          >
            <option value="1">填空 1 个/题</option>
            <option value="2">填空 2 个/题</option>
            <option value="3">填空 3 个/题</option>
            <option value="5">填空 5 个/题</option>
          </select>
        )}
        <span className="muted">
          {Math.min(index + 1, queue.length)} / {queue.length}
        </span>
        <button onClick={() => current && onSpeak(current.text)} title="再听一遍">
          🔊 再听一遍
        </button>
      </div>

      {index < queue.length ? (
        <>
          {mode === 'cloze' && cloze ? (
            <>
              <div className="dict-sentence">{cloze.display}</div>
              <div className="dict-blanks">
                {cloze.blanks.map((b, i) => (
                  <input
                    key={i}
                    className={
                      'study-input dict-blank' + (checked ? (isClozeBlankCorrect(b, blanks[i] ?? '') ? ' ok' : ' bad') : '')
                    }
                    autoFocus={i === 0}
                    ref={i === 0 ? firstBlankRef : undefined}
                    placeholder={`空 ${i + 1}`}
                    value={blanks[i] ?? ''}
                    disabled={checked}
                    onChange={(e) => onBlankChange(i, e.target.value)}
                  />
                ))}
              </div>
              {checked && <div className="dict-reveal">原文：{cloze.sentence}</div>}
            </>
          ) : (
            <>
              <textarea
                className="study-input dict-input"
                autoFocus
                ref={inputRef}
                placeholder="听写这一句，回车检查 / 下一句"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                disabled={checked}
              />
              {checked && diff && (
                <div className="dict-diff">
                  {diff.map((t, i) => (
                    <span key={i} className={'dt ' + t.type}>
                      {t.text}{' '}
                    </span>
                  ))}
                </div>
              )}
              {checked && <div className="dict-reveal">原文：{current?.text}</div>}
            </>
          )}
          <div className="bar study-actions">
            {!checked ? (
              <button className="primary" onClick={onCheck}>
                检查（回车）
              </button>
            ) : (
              <button className="primary" onClick={onNext}>
                {index + 1 >= queue.length ? '完成（回车）' : '下一句（回车）'}
              </button>
            )}
            {checked && <button onClick={onWrongNow}>漏词加入待选</button>}
          </div>
        </>
      ) : (
        <div className="study-done">
          <p>
            听写完成：答对 <b>{correct}</b> / {results.length}
            {results.length ? `（${Math.round((correct / results.length) * 100)}%）` : ''}
          </p>
          {wrongItems.length > 0 && (
            <div className="dict-wrong">
              <div className="muted">错题（{wrongItems.length}）：</div>
              {wrongItems.map((w) => (
                <div key={w.id} className="dict-wrong-item">
                  {w.text}
                </div>
              ))}
            </div>
          )}
          <div className="bar">
            {wrongItems.length > 0 && (
              <button className="primary" onClick={onRetryWrong}>
                重练错题 {wrongItems.length}
              </button>
            )}
            <button className={wrongItems.length ? '' : 'primary'} onClick={() => onStart()}>
              再来一遍
            </button>
            <button onClick={onClose}>回到阅读</button>
          </div>
        </div>
      )}
    </div>
  )
}
