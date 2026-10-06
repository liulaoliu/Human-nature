import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { isClozeBlankCorrect, type ClozePart, type ClozeQuestion, type DiffToken } from '../../core/dictation'

/** 拼写比对用的归一化：小写、去标点（撇号保留）。 */
const normWord = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^a-z0-9']/g, '')

/**
 * 把一段文本按词渲染成可点击的 span：点某个词 → 从它在整句中的位置开始朗读。
 * base 为该段文本在整句里的字符起点（来自 makeCloze 的 parts）。
 * isWrong 为真时给该词加「拼错」高亮（用于检查后的原文）。
 */
function ClickableText({
  text,
  base,
  sentence,
  onSpeak,
  isWrong,
}: {
  text: string
  base: number
  sentence: string
  onSpeak: (t: string) => void
  isWrong?: (word: string) => boolean
}) {
  const nodes: ReactNode[] = []
  const re = /[A-Za-z][A-Za-z'’-]*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const abs = base + m.index
    const bad = isWrong ? isWrong(m[0]) : false
    nodes.push(
      <span
        key={abs}
        className={'dict-word' + (bad ? ' wrong' : '')}
        title={bad ? '这个词没听对' : '从这里开始听'}
        onClick={() => onSpeak(sentence.slice(abs))}
      >
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes}</>
}

/** 渲染挖空后的句子：文本可点听、空位显示编号。 */
function ClozeSentence({
  parts,
  sentence,
  onSpeak,
}: {
  parts: ClozePart[]
  sentence: string
  onSpeak: (t: string) => void
}) {
  return (
    <div className="dict-sentence">
      {parts.map((p, i) =>
        p.blank ? (
          <span key={i} className="dict-gap">
            [{p.index}]
          </span>
        ) : (
          <ClickableText key={i} text={p.text} base={p.start} sentence={sentence} onSpeak={onSpeak} />
        ),
      )}
    </div>
  )
}

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
  /** 填空模式每段最多多少词（越大并得越长、题越少）。 */
  clozeWords: number
  /** 每轮最多做多少题（0=不限）。 */
  maxQuestions: number
  /** 全篇总题数（用于显示「第 X–Y / 全篇 M」）。 */
  grandTotal: number
  /** 本轮从全篇第几题开始。 */
  roundOffset: number
  checked: boolean
  diff: DiffToken[] | null
  cloze: ClozeQuestion | null
  blanks: string[]
  input: string
  results: boolean[]
  wrongItems: DictItem[]
  /** 重开一轮（可带 mode / words / blanks 改动）。 */
  onStart: (opts?: { mode?: 'full' | 'cloze'; words?: number; blanks?: number; clozeWords?: number; max?: number }) => void
  onCheck: () => void
  onNext: () => void
  onWrongNow: () => void
  onRetryWrong: () => void
  onClose: () => void
  onSpeak: (text: string) => void
  /** 一键尝试唤醒假死的语音（真死需刷新，刷新后可续做）。 */
  onResetSpeech: () => void
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
  clozeWords,
  maxQuestions,
  grandTotal,
  roundOffset,
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
  onResetSpeech,
  onInputChange,
  onBlankChange,
}: DictPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const blankRefs = useRef<(HTMLInputElement | null)[]>([])

  /** 把焦点移到第 i 个空，并把光标放到已有文本末尾（接着已有内容继续输入）。 */
  const focusBlank = useCallback((i: number) => {
    const el = blankRefs.current[i]
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [])

  // 换题后把焦点送回输入框（autoFocus 只首次生效，换题必须手动聚焦）
  useEffect(() => {
    if (index >= queue.length || checked) return
    if (mode === 'cloze' && cloze) focusBlank(0)
    else inputRef.current?.focus()
  }, [index, checked, mode, cloze, queue.length, focusBlank])

  const current = queue[index]
  const correct = results.filter(Boolean).length

  /** 检查后：本次没听对的词（原文里高亮）。填空=填错的空；整句=漏写/拼错的词。 */
  const wrongSet = useMemo(() => {
    const s = new Set<string>()
    if (!checked) return s
    if (mode === 'cloze' && cloze) {
      cloze.blanks.forEach((b, i) => {
        if (!isClozeBlankCorrect(b, blanks[i] ?? '')) s.add(normWord(b.answer))
      })
    } else if (diff) {
      for (const t of diff) if (t.type === 'del') s.add(normWord(t.text))
    }
    return s
  }, [checked, mode, cloze, blanks, diff])

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
        {mode === 'full' ? (
          <select
            value={String(words)}
            onChange={(e) => onStart({ words: Number(e.target.value) })}
            title="整句模式下每句最多多少词（越长越难、题越少）；改完立即重开一轮"
          >
            <option value="1">每句 1 词</option>
            <option value="2">每句 2 词</option>
            <option value="3">每句 3 词</option>
            <option value="5">每句 5 词</option>
            <option value="8">每句 8 词</option>
            <option value="12">每句 12 词</option>
            <option value="20">每句 20 词</option>
            <option value="30">每句 30 词</option>
          </select>
        ) : (
          <>
            <select
              value={String(clozeWords)}
              onChange={(e) => onStart({ clozeWords: Number(e.target.value) })}
              title="填空模式下每段最多多少词：越大并得越长、题越少（越难）；改完立即重开一轮"
            >
              <option value="10">每段 10 词</option>
              <option value="15">每段 15 词</option>
              <option value="25">每段 25 词</option>
              <option value="40">每段 40 词</option>
              <option value="60">每段 60 词</option>
              <option value="80">每段 80 词</option>
              <option value="120">每段 120 词</option>
            </select>
            <select
              value={String(blankCount)}
              onChange={(e) => onStart({ blanks: Number(e.target.value) })}
              title="填空模式下每题挖几个空；改完立即重开一轮"
            >
              <option value="1">填空 1 个/题</option>
              <option value="2">填空 2 个/题</option>
              <option value="3">填空 3 个/题</option>
              <option value="5">填空 5 个/题</option>
              <option value="8">填空 8 个/题</option>
              <option value="10">填空 10 个/题</option>
              <option value="15">填空 15 个/题</option>
            </select>
          </>
        )}
        <select
          value={String(maxQuestions)}
          onChange={(e) => onStart({ max: Number(e.target.value) })}
          title="每轮最多做几题；做不完下次从断点继续，避免一开就是几十题"
        >
          <option value="0">不限题数</option>
          <option value="5">每轮 5 题</option>
          <option value="10">每轮 10 题</option>
          <option value="20">每轮 20 题</option>
          <option value="30">每轮 30 题</option>
          <option value="50">每轮 50 题</option>
        </select>
        <span className="muted">
          {Math.min(index + 1, queue.length)} / {queue.length}
          {grandTotal > queue.length
            ? `（第 ${roundOffset + 1}–${roundOffset + queue.length} / 全篇 ${grandTotal}）`
            : ''}
        </span>
        <button onClick={() => current && onSpeak(current.text)} title="再听一遍">
          🔊 再听一遍
        </button>
        <button
          onClick={() => {
            onResetSpeech()
            if (current) onSpeak(current.text)
          }}
          title="朗读卡住时点这里尝试唤醒；仍无效就刷新页面（刷新后进度会恢复）"
        >
          🔄 重启语音
        </button>
      </div>

      {index < queue.length ? (
        <>
          {mode === 'cloze' && cloze ? (
            <>
              <ClozeSentence parts={cloze.parts} sentence={cloze.sentence} onSpeak={onSpeak} />
              <div className="dict-blanks">
                {cloze.blanks.map((b, i) => (
                  <div className="dict-blank-row" key={i}>
                    <span className="dict-blank-no" title={`第 ${i + 1} 个空`}>
                      {i + 1}
                    </span>
                    <input
                      ref={(el) => {
                        blankRefs.current[i] = el
                      }}
                      className={
                        'study-input dict-blank' + (checked ? (isClozeBlankCorrect(b, blanks[i] ?? '') ? ' ok' : ' bad') : '')
                      }
                      placeholder={`听写第 ${i + 1} 个空`}
                      value={blanks[i] ?? ''}
                      disabled={checked}
                      onFocus={(e) => {
                        const el = e.currentTarget
                        el.setSelectionRange(el.value.length, el.value.length)
                      }}
                      onKeyDown={(e) => {
                        const el = e.currentTarget
                        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
                        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
                        if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && atEnd)) {
                          e.preventDefault()
                          focusBlank(i + 1)
                        } else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && atStart)) {
                          e.preventDefault()
                          focusBlank(i - 1)
                        }
                      }}
                      onChange={(e) => onBlankChange(i, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              {checked && (
                <div className="dict-reveal">
                  原文：
                  <ClickableText
                    text={cloze.sentence}
                    base={0}
                    sentence={cloze.sentence}
                    onSpeak={onSpeak}
                    isWrong={(w) => wrongSet.has(normWord(w))}
                  />
                </div>
              )}
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
              {checked && current && (
                <div className="dict-reveal">
                  原文：
                  <ClickableText
                    text={current.text}
                    base={0}
                    sentence={current.text}
                    onSpeak={onSpeak}
                    isWrong={(w) => wrongSet.has(normWord(w))}
                  />
                </div>
              )}
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
              {grandTotal > queue.length ? '继续下一批' : '再来一遍'}
            </button>
            <button onClick={onClose}>回到阅读</button>
          </div>
        </div>
      )}
    </div>
  )
}
