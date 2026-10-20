import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AlignedChunk, ResolvedAnchor } from '../core/alignText'
import { wordRangeFromText } from '../core/pickWords'
import { VIEW_MODES, type ViewMode } from '../state/shadowingPrefs'

/** 显示模式的中文名（键与顺序在 state/shadowingPrefs，这里只管显示） */
const VIEW_LABEL: Record<ViewMode, string> = { full: '全文', focus: '聚焦', block: '单块' }

const nextViewMode = (v: ViewMode): ViewMode =>
  VIEW_MODES[(VIEW_MODES.indexOf(v) + 1) % VIEW_MODES.length]

/**
 * 原文面板。有文本时整篇摊开，当前块高亮。
 * 切分是按时长比例估的，不是逐字对齐 —— 所以干脆全给出来，自己对着听，
 * 别当精确字幕用。
 */
export default function ScriptPanel({
  script,
  scriptSource,
  scriptLibrary,
  offsetWords,
  textStartChunk,
  manualAnchors,
  manualRanges,
  aligned,
  current,
  editing,
  viewMode,
  onViewMode,
  onToggle,
  onSubmit,
  onPickWords,
  onNudgeAnchor,
  onClearAnchorHere,
  onClearAnchors,
}: {
  script: string
  scriptSource: 'auto' | 'manual' | 'none'
  scriptLibrary: boolean
  offsetWords: number
  textStartChunk: number
  manualAnchors: number
  manualRanges: ResolvedAnchor[]
  aligned: AlignedChunk[]
  current: number
  editing: boolean
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  onToggle: () => void
  onSubmit: (text: string) => void
  onPickWords: (startWord: number, endWord: number) => void
  onNudgeAnchor: (edge: 'start' | 'end', delta: number) => void
  onClearAnchorHere: () => void
  onClearAnchors: () => void
}) {
  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState(false)
  // 清除全部锚定的二步确认：得手打 Delete
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearInput, setClearInput] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) return
    setDraft(script) // 打开时带上已有文本，不用重粘一遍
    ref.current?.focus()
  }, [editing, script])

  // 选字定块：开关打开时，松开鼠标就把选中的词绑到当前块
  useEffect(() => {
    if (!picking) return
    const onUp = () => {
      const box = boxRef.current
      const sel = window.getSelection()
      if (!box || !sel || sel.isCollapsed || sel.rangeCount === 0) return
      const wr = selectedWordRange(sel.getRangeAt(0), box)
      if (!wr) return
      onPickWords(wr[0], wr[1])
      sel.removeAllRanges()
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [picking, onPickWords])

  // 整篇都摊在上面，换块时把当前那块滚进视野中间，
  // 不然全显示之后要自己找高亮在哪。
  useEffect(() => {
    const box = boxRef.current
    const el = box?.querySelector<HTMLElement>('.seg.here')
    if (!box || !el) return
    const b = box.getBoundingClientRect()
    const e = el.getBoundingClientRect()
    box.scrollTop += e.top - b.top - box.clientHeight / 3
  }, [current, aligned])

  if (editing) {
    return (
      <div className="script edit">
        <textarea
          ref={ref}
          value={draft}
          placeholder="把这一篇的原文粘进来（从 PDF 或 App 里复制）。粘完按时长比例摊到各块上，会有几个词的偏差。"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onToggle()
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSubmit(draft)
          }}
        />
        <div className="row">
          <button className="primary" onClick={() => onSubmit(draft)}>
            用这段文本
          </button>
          <button className="ghost" onClick={onToggle}>
            取消
          </button>
          {script.trim() && (
            <button className="ghost" onClick={() => onSubmit('')}>
              清空
            </button>
          )}
          <span className="lab">Ctrl+Enter 保存</span>
        </div>
      </div>
    )
  }

  if (aligned.length === 0) {
    return (
      <div className="row">
        <button className="ghost" onClick={onToggle}>
          ＋ 粘上原文，对着念（T）
        </button>
        <span className="lab">
          {scriptLibrary
            ? '原文库里没有这一篇，得手动粘'
            : '原文库没取到（articles.json 请求失败）—— 按 F12 看控制台，或确认是 http://localhost 打开的'}
        </span>
      </div>
    )
  }

  const hereRange = manualRanges.find((r) => r.chunkIndex === current)
  const anchorByChunk = new Map(manualRanges.map((r) => [r.chunkIndex, r]))

  // 全文摊开、当前块高亮，手动锚定的块额外标出起点/终点。
  // 标记按锚点的精确词位插，不画在整段两端 —— 相邻锚点把段边界盖住时也不会“看着不动”。
  return (
    <div className="script">
      <div className="script-head">
        <span className="lab">
          {picking
            ? `选中第 ${current + 1} 块听到的文字（从第一个词拖到最后一个词）`
            : ''}
        </span>
        <button
          className="chip sm"
          onClick={() => onViewMode(nextViewMode(viewMode))}
          title="原文显示模式：全文 → 聚焦（当前块大字、邻近压暗）→ 单块（只看当前）。快捷键 V"
        >
          显示：{VIEW_LABEL[viewMode]}（V）
        </button>
        <label
          className={picking ? 'pick-toggle on' : 'pick-toggle'}
          title="打开后，用鼠标选中你听到的那段文字，就把第 N 块绑到它上面"
        >
          <input
            type="checkbox"
            checked={picking}
            onChange={(e) => {
              setPicking(e.target.checked)
              // 单块/聚焦把别的段藏了就没法跨段拖选，选字时先回到全文
              if (e.target.checked) onViewMode('full')
            }}
          />
          选字定块
        </label>
      </div>
      <div className={picking ? `full picking mode-${viewMode}` : `full mode-${viewMode}`} ref={boxRef}>
        {aligned.map((a) => {
          const here = a.index === current
          const near = Math.abs(a.index - current) === 1
          const cls = ['seg']
          if (here) cls.push('here')
          if (near) cls.push('near')
          if (a.anchored) cls.push('anchored')

          const marks: Mark[] = []
          if (here) {
            // 当前块：起点黄粗线、终点天蓝粗线（没锚定就用当前对齐的位置）
            const r = anchorByChunk.get(a.index)
            const start = r ? r.startWord : a.wordRange[0]
            const end = r ? r.endWord : a.wordRange[1]
            marks.push({ at: start, cls: 'mark-active-start' })
            marks.push({ at: end, cls: 'mark-active-end' })
          } else if (a.anchored) {
            // 其他已锚定的块：起点绿粗线、终点红细线
            const r = anchorByChunk.get(a.index)
            if (r) {
              marks.push({ at: r.startWord, cls: 'mark-start' })
              marks.push({ at: r.endWord, cls: 'mark-end' })
            }
          }

          return (
            <span
              key={a.index}
              className={cls.join(' ')}
              data-s={a.wordRange[0]}
              data-e={a.wordRange[1]}
            >
              {a.text ? (
                <SegBody a={a} marks={marks} />
              ) : here ? (
                <i className="none">
                  {current < textStartChunk
                    ? `（这块在正文之前 —— 正文从第 ${textStartChunk + 1} 块开始）`
                    : '（这块没分到词）'}
                </i>
              ) : null}
            </span>
          )
        })}
      </div>

      <div className="row anchor-row">
        {hereRange ? (
          <>
            <span className="lab anchored-ok">
              第 {current + 1} 块已锚定：词 {hereRange.startWord + 1}–{hereRange.endWord}（绿线）
            </span>
            <span className="lab">起点（键盘 , .）</span>
            <button className="chip" onClick={() => onNudgeAnchor('start', -1)} title="起点往前一个词（快捷键 ,）">
              −
            </button>
            <button className="chip" onClick={() => onNudgeAnchor('start', 1)} title="起点往后一个词（快捷键 .）">
              ＋
            </button>
            <span className="lab">终点（键盘 Shift , .）</span>
            <button className="chip" onClick={() => onNudgeAnchor('end', -1)} title="终点往前一个词（快捷键 Shift+,）">
              −
            </button>
            <button className="chip" onClick={() => onNudgeAnchor('end', 1)} title="终点往后一个词（快捷键 Shift+.）">
              ＋
            </button>
            <button className="ghost sm" onClick={onClearAnchorHere}>
              取消本块锚定
            </button>
          </>
        ) : (
          <span className="lab">
            第 {current + 1} 块未锚定 · 打开右上角「选字定块」，用鼠标从第一个词拖到最后一个词，
            松开即锚定；之后用按钮或 , .（起点）/ Shift+, .（终点）微调
          </span>
        )}
        {manualAnchors > 0 && (
          <button
            className="ghost sm"
            onClick={() => {
              setClearInput('')
              setConfirmClear(true)
            }}
          >
            清除全部锚定（{manualAnchors}）
          </button>
        )}
      </div>

      {confirmClear && (
        <div className="confirm-mask" role="dialog" aria-modal="true">
          <div className="confirm-box">
            <h3>清除全部锚定？</h3>
            <p>
              这会删掉这一篇的 <b>全部 {manualAnchors} 个手动锚点</b>，之后回到按时长比例自动估计。
              <b>无法撤销。</b>
            </p>
            <p>
              确认请输入 <code>Delete</code>：
            </p>
            <input
              autoFocus
              value={clearInput}
              placeholder="Delete"
              spellCheck={false}
              onChange={(e) => setClearInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setConfirmClear(false)
                } else if (e.key === 'Enter' && clearInput === 'Delete') {
                  onClearAnchors()
                  setConfirmClear(false)
                }
              }}
            />
            <div className="row confirm-actions">
              <button
                className="danger"
                disabled={clearInput !== 'Delete'}
                onClick={() => {
                  onClearAnchors()
                  setConfirmClear(false)
                }}
              >
                确认清除
              </button>
              <button className="ghost" onClick={() => setConfirmClear(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="foot">
        <button className="ghost sm" onClick={onToggle}>
          改文本
        </button>
        <span className="lab">
          {scriptSource === 'auto'
            ? '原文库自动带上的 · '
            : scriptSource === 'manual'
              ? '你改过的文本（已存本机）· '
              : ''}
          {manualAnchors > 0
            ? `手动锚定 ${manualAnchors} 块（已存本机，刷新还在）· 其余按比例估`
            : '全文都显示在这，高亮按比例估的，可能差几个词'}
          {manualAnchors === 0 && offsetWords !== 0
            ? ` · 已平移 ${offsetWords > 0 ? '+' : ''}${offsetWords} 词`
            : ''}
        </span>
      </div>
    </div>
  )
}

interface Mark {
  /** 全局词序号（锚点边界） */
  at: number
  cls: string
}

/**
 * 把一个 segment 的文字在锚点词位处切开，插进竖线标记。
 * 标记 span 里没有文字，所以整段的 textContent 不变 —— 不影响选字定位。
 */
function SegBody({ a, marks }: { a: AlignedChunk; marks: Mark[] }) {
  const text = a.text
  if (!text) return null
  const words = text.split(' ')
  const inserts = marks
    .map((m) => ({ pos: m.at - a.wordRange[0], cls: m.cls }))
    .filter((x) => x.pos >= 0 && x.pos <= words.length)
    .sort((x, y) => x.pos - y.pos)
  if (inserts.length === 0) return <>{`${text} `}</>

  const charAt = (k: number) => {
    let p = 0
    for (let i = 0; i < k && i < words.length; i++) p += words[i].length + 1
    return Math.min(p, text.length)
  }

  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const ins of inserts) {
    const cp = charAt(ins.pos)
    if (cp > last) out.push(text.slice(last, cp))
    out.push(<span key={`m${key++}`} className={`mark ${ins.cls}`} />)
    last = cp
  }
  if (last < text.length) out.push(text.slice(last))
  out.push(' ')

  return (
    <>
      {out.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </>
  )
}

/**
 * 把 DOM 选区映射成原文的词序号 [start, end)。
 *
 * 不按子节点去猜（选区端点常落在元素上、或在段与段交界，容易失败），
 * 改成量出两端在整段文字里的**字符下标**，再交给纯函数换算 —— 稳得多。
 */
function selectedWordRange(range: Range, box: HTMLElement): [number, number] | null {
  if (!range.intersectsNode(box)) return null
  const text = box.textContent ?? ''
  const startOffset = offsetInBox(box, range.startContainer, range.startOffset) ?? 0
  const endOffset = offsetInBox(box, range.endContainer, range.endOffset) ?? text.length
  return wordRangeFromText(text, startOffset, endOffset)
}

/** 边界点在整段文字里的字符下标；在 box 之前时返回 null（由调用方兜底） */
function offsetInBox(box: HTMLElement, container: Node, offset: number): number | null {
  const r = document.createRange()
  r.selectNodeContents(box)
  try {
    r.setEnd(container, offset)
  } catch {
    return null
  }
  return r.toString().length
}
