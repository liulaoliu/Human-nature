import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { SessionStore } from '../state/session'
import { useSession } from './useSession'
import { BrowserPlayer, BrowserRecorder } from '../adapters/browserAudio'
import { createTakeRepo } from '../adapters/takeRepo'
import { createScriptRepo } from '../adapters/scriptRepo'
import { createScriptEditRepo } from '../adapters/scriptEditRepo'
import { createCalibrationRepo } from '../adapters/calibrationRepo'
import {
  applyLocalState,
  currentBackup,
  downloadBackup,
  saveToProject,
} from '../adapters/stateBackup'
import { parseBackup } from '../core/stateBackup'
import { GRANULARITY_LABEL, type Granularity } from '../core/ports'
import type { AlignedChunk, ResolvedAnchor } from '../core/alignText'
import { wordRangeFromText } from '../core/pickWords'

const RATES = [0.5, 0.75, 1, 1.5, 2]
const GRANS: Granularity[] = ['short', 'normal', 'long']

export default function App() {
  const storeRef = useRef<SessionStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new SessionStore({
      player: new BrowserPlayer(),
      recorder: new BrowserRecorder(),
      repo: createTakeRepo(),
      scripts: createScriptRepo(),
      scriptEdits: createScriptEditRepo(),
      calibration: createCalibrationRepo(),
    })
  }
  const store = storeRef.current
  const s = useSession(store)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const exportBackup = () => {
    downloadBackup(currentBackup())
    setNotice('已下载备份 json')
  }

  const saveToProjectFile = async () => {
    const backup = currentBackup()
    if (await saveToProject(backup)) {
      setNotice('已写入 public/shadowing-state.json（换电脑 git pull 后自动生效）')
    } else {
      downloadBackup(backup)
      setNotice('当前没有 dev 写入接口（生产/预览），已改成下载')
    }
  }

  const importBackup = async (file: File) => {
    const backup = parseBackup(await file.text())
    if (!backup) {
      setNotice('这个文件不是本工具的备份')
      return
    }
    const n = applyLocalState(backup.data)
    setNotice(`已导入 ${n} 项，正在刷新…`)
    setTimeout(() => window.location.reload(), 500)
  }

  // 不在这里 dispose：StrictMode 会 mount→unmount→mount，
  // 第一次 cleanup 会把 player 释放掉，第二次 mount 拿到的就是废 store。
  // 换文件时 player.load() 内部会先 release()，页面关闭时浏览器自己回收，够用了。

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.key === ' ') {
        e.preventDefault()
        void store.toggleChunkPlay()
      } else if (e.key === 'r' || e.key === 'R') {
        void store.toggleRecording()
      } else if (e.key === 'ArrowDown' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        store.next()
      } else if (e.key === 'ArrowUp' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        store.prev()
      } else if (e.key === 'c' || e.key === 'C') {
        void store.compareAB(false)
      } else if (e.key === 't' || e.key === 'T') {
        setEditing((v) => !v)
      } else if (e.key === 's' || e.key === 'S') {
        store.setTextStartChunk(store.getState().current)
      } else if (e.code === 'Comma' || e.key === ',' || e.key === '<') {
        // 用 e.code（物理键位）判断，中文输入法/布局把 e.key 改成 '，'/'。' 也不受影响。
        // 不带 Shift：起点 −1；Shift：终点 −1
        store.nudgeAnchor(e.shiftKey ? 'end' : 'start', -1)
      } else if (e.code === 'Period' || e.key === '.' || e.key === '>') {
        store.nudgeAnchor(e.shiftKey ? 'end' : 'start', 1)
      } else if (e.code === 'BracketLeft' || e.key === '[' || e.key === '{') {
        store.nudgeOffsetWords(e.shiftKey ? -15 : -3)
      } else if (e.code === 'BracketRight' || e.key === ']' || e.key === '}') {
        store.nudgeOffsetWords(e.shiftKey ? 15 : 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const current = s.chunks[s.current]
  const myTakes = current ? s.takes.filter((t) => t.chunkIndex === current.index) : []

  if (s.status === 'empty') {
    return (
      <div className="app">
        {notice && (
          <div className="banner">
            {notice}
            <button className="ghost sm" onClick={() => setNotice(null)}>
              知道了
            </button>
          </div>
        )}
        <Empty
          onPick={(f) => void store.load(f, f.name)}
          backup={
            <BackupBar
              onExport={exportBackup}
              onImport={(f) => void importBackup(f)}
              onSaveProject={() => void saveToProjectFile()}
            />
          }
        />
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <label className="file">
          换音频
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void store.load(f, f.name)
            }}
          />
        </label>
        <span className="name">{s.fileName}</span>
        <span className="meta">
          {s.chunks.length} 块 · {fmt(s.duration)}
        </span>
        <BackupBar
          onExport={exportBackup}
          onImport={(f) => void importBackup(f)}
          onSaveProject={() => void saveToProjectFile()}
        />
      </header>

      {notice && (
        <div className="banner">
          {notice}
          <button className="ghost sm" onClick={() => setNotice(null)}>
            知道了
          </button>
        </div>
      )}

      {s.status === 'loading' && <div className="banner">解码中…</div>}
      {s.status === 'error' && <div className="banner err">打不开：{s.error}</div>}
      {s.error && s.status === 'ready' && (
        <div className="banner err">
          {s.error}
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      )}

      {s.status === 'ready' && (
        <div className="body">
          <ol className="list">
            {s.chunks.map((c) => {
              const n = s.takes.filter((t) => t.chunkIndex === c.index).length
              return (
                <li key={c.index}>
                  <button
                    className={c.index === s.current ? 'row on' : 'row'}
                    onClick={() => store.select(c.index)}
                  >
                    <span className="i">{c.index + 1}</span>
                    <span className="t">{fmt(c.start)}</span>
                    <span className="d">{n > 0 ? <b title={`${n} 条录音`}>●{n}</b> : null}</span>
                  </button>
                </li>
              )
            })}
          </ol>

          <main>
            <div className="big">
              第 <b>{s.current + 1}</b> / {s.chunks.length} 块
              <span className="range">
                {fmt(current?.start ?? 0)} – {fmt(current?.end ?? 0)}
                （{((current?.end ?? 0) - (current?.start ?? 0)).toFixed(1)}s）
              </span>
            </div>

            <ScriptPanel
              script={s.script}
              scriptSource={s.scriptSource}
              scriptLibrary={s.scriptLibrary}
              offsetWords={s.offsetWords}
              textStartChunk={s.textStartChunk}
              manualAnchors={s.manualAnchors}
              manualRanges={s.manualRanges}
              aligned={s.aligned}
              current={s.current}
              editing={editing}
              onToggle={() => setEditing((v) => !v)}
              onSubmit={(text) => {
                store.setScript(text)
                setEditing(false)
              }}
              onPickWords={(a, b) => store.setAnchorWords(a, b)}
              onNudgeAnchor={(edge, delta) => store.nudgeAnchor(edge, delta)}
              onClearAnchorHere={() => store.clearAnchorHere()}
              onClearAnchors={() => store.clearAnchors()}
            />

            <div className="row">
              <label className="check" title="一圈下来：标准音 → 自动录音 → 回放刚才那条。手动录音（R）不受影响">
                <input
                  type="checkbox"
                  checked={s.autoCycle}
                  onChange={(e) => void store.setAutoCycle(e.target.checked)}
                />
                连续跟读（标准音 → 录音 → 回放）
              </label>
              {s.autoCycle && s.cycleStep === 'rec' && (
                <span className="lab">
                  录音中 · 说完停 1.6 秒自动结束（最长 {Math.round(s.autoRecordMs / 1000)} 秒），按空格直接结束
                </span>
              )}
              {s.autoCycle && s.cycleStep === 'ref' && <span className="lab">正在放标准音…</span>}
              {s.autoCycle && s.cycleStep === 'playback' && (
                <span className="lab">回放中（我的录音）…</span>
              )}
            </div>

            <div className="row">
              <button
                onClick={() => store.prev()}
                disabled={s.current === 0}
                title="上一块（A 或 ↑），并像按空格一样直接跑"
              >
                ↑ 上一块
              </button>
              <button
                className="primary"
                onClick={() => void store.toggleChunkPlay()}
                title="再按一次暂停；暂停后按空格是接着播，不是重头"
              >
                {s.autoCycle
                  ? s.cycleStep === 'idle'
                    ? '▶ 跟读一轮（空格）'
                    : '⏹ 停止本轮（空格）'
                  : s.playing
                    ? '⏸ 暂停（空格）'
                    : '▶ 标准音（空格）'}
              </button>
              <button
                onClick={() => store.next()}
                disabled={s.current === s.chunks.length - 1}
                title="下一块（D 或 ↓），并像按空格一样直接跑"
              >
                ↓ 下一块
              </button>
            </div>

            <div className="row">
              <span className="lab">语速</span>
              {RATES.map((r) => (
                <button
                  key={r}
                  className={s.rate === r ? 'chip on' : 'chip'}
                  onClick={() => store.setRate(r)}
                >
                  {r}x
                </button>
              ))}
              <span className="lab">切块</span>
              {GRANS.map((g) => (
                <button
                  key={g}
                  className={s.granularity === g ? 'chip on' : 'chip'}
                  onClick={() => store.setGranularity(g)}
                >
                  {GRANULARITY_LABEL[g]}
                </button>
              ))}
            </div>

            {s.script.trim() && s.manualAnchors === 0 && (
              <div className="row">
                <span className="lab">对齐校准</span>
                <button
                  className={s.textStartChunk > 0 ? 'chip on' : 'chip'}
                  onClick={() => store.setTextStartChunk(s.current)}
                  title="听到正文第一句时，切到那一块按下这个"
                >
                  正文从这块开始（S）
                </button>
                <span className="off">
                  {s.textStartChunk > 0 ? `第 ${s.textStartChunk + 1} 块` : '第 1 块'}
                </span>
                {s.textStartChunk > 0 && (
                  <button className="ghost sm" onClick={() => store.clearTextStart()}>
                    取消
                  </button>
                )}
                <span className="lab">文字偏移</span>
                <button className="chip" onClick={() => store.nudgeOffsetWords(-15)} title="文字往后挪 15 词">
                  −15
                </button>
                <button className="chip" onClick={() => store.nudgeOffsetWords(-3)} title="文字往后挪 3 词">
                  −3
                </button>
                <span className="off">
                  {s.offsetWords > 0 ? `+${s.offsetWords}` : s.offsetWords} 词
                </span>
                <button className="chip" onClick={() => store.nudgeOffsetWords(3)} title="文字往前赶 3 词">
                  +3
                </button>
                <button className="chip" onClick={() => store.nudgeOffsetWords(15)} title="文字往前赶 15 词">
                  +15
                </button>
                {(s.offsetWords !== 0 || s.textStartChunk > 0) && (
                  <button
                    className="ghost sm"
                    onClick={() => {
                      store.setOffsetWords(0)
                      store.clearTextStart()
                    }}
                  >
                    全部归零
                  </button>
                )}
              </div>
            )}

            <div className="row rec">
              <button
                className={s.recording ? 'rec on' : 'rec'}
                onClick={() => void store.toggleRecording()}
              >
                {s.recording ? '■ 停止（R）' : '● 录音（R）'}
              </button>
              <div className="meter">
                <div className="bar" style={{ width: `${Math.round(s.level * 100)}%` }} />
              </div>
            </div>

            <div className="row">
              <button onClick={() => void store.compareAB(false)}>标准 → 我的</button>
              <button onClick={() => void store.compareAB(true)}>循环对比</button>
              {s.abPlaying && (
                <button className="warn" onClick={() => store.stopAb()}>
                  停下
                </button>
              )}
              <button className="ghost" onClick={() => void store.playWhole()}>
                整篇连播
              </button>
            </div>

            {myTakes.length > 0 && (
              <ul className="takes">
                {myTakes.map((t, i) => (
                  <li key={t.id}>
                    <span>第 {i + 1} 条 · {t.durationSec.toFixed(1)}s</span>
                    <a
                      href={URL.createObjectURL(t.blob)}
                      download={`${s.current + 1}-${i + 1}.${extOf(t.mimeType)}`}
                    >
                      导出
                    </a>
                    <button className="ghost sm" onClick={() => void store.removeTake(t.id)}>
                      删
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="hint">
              空格 播放/暂停 · A/D（或 ↑↓）切块（直接跑）· R 录音 · C 对比 · T 改文本 ·
              S 标记正文起点 · 选字锚点用 , . 调起点、Shift+, . 调终点 ·
              [ ] 微调文字偏移（Shift 加大步长）。录音、进度都存本机，关页面不丢。
            </p>
          </main>
        </div>
      )}
    </div>
  )
}

/**
 * 原文面板。有文本时整篇摊开，当前块高亮。
 * 切分是按时长比例估的，不是逐字对齐 —— 所以干脆全给出来，自己对着听，
 * 别当精确字幕用。
 */
function ScriptPanel({
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
  onToggle: () => void
  onSubmit: (text: string) => void
  onPickWords: (startWord: number, endWord: number) => void
  onNudgeAnchor: (edge: 'start' | 'end', delta: number) => void
  onClearAnchorHere: () => void
  onClearAnchors: () => void
}) {
  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState(false)
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
      <div className="full-wrap">
        <div className={picking ? 'full picking' : 'full'} ref={boxRef}>
          {aligned.map((a) => {
            const here = a.index === current
            const cls = ['seg']
            if (here) cls.push('here')
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
        <label
          className={picking ? 'pick-toggle on' : 'pick-toggle'}
          title="打开后，用鼠标选中你听到的那段文字，就把第 N 块绑到它上面"
        >
          <input
            type="checkbox"
            checked={picking}
            onChange={(e) => setPicking(e.target.checked)}
          />
          选字定块
        </label>
      </div>

      {picking && (
        <div className="pick-hint">
          放第 {current + 1} 块 → 鼠标从这句的第一个词拖到最后一个词 → 松开就绑到第 {current + 1} 块
        </div>
      )}

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
          <button className="ghost sm" onClick={onClearAnchors}>
            清除全部锚定（{manualAnchors}）
          </button>
        )}
      </div>

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

function Empty({ onPick, backup }: { onPick: (f: File) => void; backup?: ReactNode }) {
  return (
    <div className="empty">
      <h1>跟读练习</h1>
      <p>选一个音频文件（mp3 / wav），自动切成块，然后一块一块听、跟读、对比。</p>
      <label className="big-btn">
        选择音频
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
          }}
        />
      </label>
      <p className="tip">
        浏览器不给 <code>file://</code> 页面麦克风权限。如果点录音没反应，在项目目录跑{' '}
        <code>npm run dev</code>，然后打开终端里给的 <code>http://localhost</code> 地址。
      </p>
      {backup && <div className="empty-backup">{backup}</div>}
    </div>
  )
}

/** 备份的导出/导入 + 存入项目。放 header 和空状态两处用。 */
function BackupBar({
  onExport,
  onImport,
  onSaveProject,
}: {
  onExport: () => void
  onImport: (f: File) => void
  onSaveProject: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        className="ghost sm"
        onClick={onExport}
        title="把本机的校准（选字锚点等）和改过的正文下载成一个 json，换电脑时带走"
      >
        导出备份
      </button>
      <button
        className="ghost sm"
        onClick={() => ref.current?.click()}
        title="从备份 json 恢复（会覆盖同名文章的进度）"
      >
        导入备份
      </button>
      <button
        className="ghost sm"
        onClick={onSaveProject}
        title="写入项目的 public/shadowing-state.json，只在 npm run dev 下可用"
      >
        存入项目
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImport(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function extOf(mime: string) {
  return mime.includes('mp4') ? 'm4a' : 'webm'
}
