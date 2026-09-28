import { useEffect, useRef, useState } from 'react'
import { SessionStore } from '../state/session'
import { useSession } from './useSession'
import { BrowserPlayer, BrowserRecorder } from '../adapters/browserAudio'
import { createTakeRepo } from '../adapters/takeRepo'
import { createScriptRepo } from '../adapters/scriptRepo'
import { createCalibrationRepo } from '../adapters/calibrationRepo'
import { GRANULARITY_LABEL, type Granularity } from '../core/ports'
import type { AlignedChunk } from '../core/alignText'

const RATES = [1, 0.75, 0.5]
const GRANS: Granularity[] = ['short', 'normal', 'long']

export default function App() {
  const storeRef = useRef<SessionStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new SessionStore({
      player: new BrowserPlayer(),
      recorder: new BrowserRecorder(),
      repo: createTakeRepo(),
      scripts: createScriptRepo(),
      calibration: createCalibrationRepo(),
    })
  }
  const store = storeRef.current
  const s = useSession(store)
  const [editing, setEditing] = useState(false)

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
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        store.next()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        store.prev()
      } else if (e.key === 'c' || e.key === 'C') {
        void store.compareAB(false)
      } else if (e.key === 't' || e.key === 'T') {
        setEditing((v) => !v)
      } else if (e.key === 's' || e.key === 'S') {
        store.setTextStartChunk(store.getState().current)
      } else if (e.key === '[') {
        store.nudgeOffsetWords(e.shiftKey ? -15 : -3)
      } else if (e.key === ']') {
        store.nudgeOffsetWords(e.shiftKey ? 15 : 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const current = s.chunks[s.current]
  const myTakes = current ? s.takes.filter((t) => t.chunkIndex === current.index) : []

  if (s.status === 'empty') return <Empty onPick={(f) => void store.load(f, f.name)} />

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
      </header>

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
              aligned={s.aligned}
              current={s.current}
              editing={editing}
              onToggle={() => setEditing((v) => !v)}
              onSubmit={(text) => {
                store.setScript(text)
                setEditing(false)
              }}
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
              <button onClick={() => store.prev()} disabled={s.current === 0} title="上一块，并直接播出来">
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
                title="下一块，并直接播出来"
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

            {s.script.trim() && (
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
              空格 播放/暂停 · R 录音 · ↑↓ 切块（直接播） · C 对比 · T 改文本 · S 标记正文起点 · [ ] 微调文字偏移（Shift 加大步长）。录音保存在本浏览器里，关掉页面不会丢。
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
  aligned,
  current,
  editing,
  onToggle,
  onSubmit,
}: {
  script: string
  scriptSource: 'auto' | 'manual' | 'none'
  scriptLibrary: boolean
  offsetWords: number
  textStartChunk: number
  aligned: AlignedChunk[]
  current: number
  editing: boolean
  onToggle: () => void
  onSubmit: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) return
    setDraft(script) // 打开时带上已有文本，不用重粘一遍
    ref.current?.focus()
  }, [editing, script])

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

  // 全文摊开、当前块高亮。分块和音频本来就有几个词的出入，
  // 与其只给一块看还看得将信将疑，不如全给出来自己对着听。
  return (
    <div className="script">
      <div className="full" ref={boxRef}>
        {aligned.map((a) => {
          const here = a.index === current
          return (
            <span key={a.index} className={here ? 'seg here' : 'seg'}>
              {a.text ? (
                `${a.text} `
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
      <div className="foot">
        <button className="ghost sm" onClick={onToggle}>
          改文本
        </button>
        <span className="lab">
          {scriptSource === 'auto' ? '原文库自动带上的 · ' : ''}
          全文都显示在这，高亮按比例估的，可能差几个词
          {offsetWords !== 0 ? ` · 已平移 ${offsetWords > 0 ? '+' : ''}${offsetWords} 词` : ''}
        </span>
      </div>
    </div>
  )
}

function Empty({ onPick }: { onPick: (f: File) => void }) {
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
    </div>
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
