import { useEffect, useRef, useState } from 'react'
import { SessionStore } from '../state/session'
import { useSession } from './useSession'
import { BrowserPlayer, BrowserRecorder, listAudioInputs } from '../adapters/browserAudio'
import { ChunkSplitter } from './ChunkSplitter'
import FishLayer from './FishLayer'
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
import {
  VIEW_MODES,
  readHangover,
  readMicDevice,
  readMicRaw,
  readTakeBoost,
  readViewMode,
  saveHangover,
  saveMicDevice,
  saveMicRaw,
  saveTakeBoost,
  saveViewMode,
  type ViewMode,
} from '../state/shadowingPrefs'
import ScriptPanel from './ScriptPanel'
import { BackupBar, Empty, TakeExport, extOf, fmt, interceptAudioPick } from './AppBits'

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
  const listRef = useRef<HTMLOListElement>(null)
  const prevChunkCount = useRef(0)
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)
  const [splitOpen, setSplitOpen] = useState(false)
  const [micRaw, setMicRaw] = useState<boolean>(readMicRaw)
  const [micDevice, setMicDevice] = useState<string>(readMicDevice)
  const [hangoverMs, setHangoverMs] = useState<number>(readHangover)
  const [takeBoost, setTakeBoost] = useState<number>(readTakeBoost)
  const [inputs, setInputs] = useState<Array<{ deviceId: string; label: string }>>([])

  // UI 偏好（显示模式 / 麦克风）存本机，刷新还在。读写都在 state/shadowingPrefs（带脏值兜底）
  useEffect(() => saveViewMode(viewMode), [viewMode])
  useEffect(() => saveMicRaw(micRaw), [micRaw])
  useEffect(() => saveMicDevice(micDevice), [micDevice])
  // 「说完静音多久算结束」交给 store（连续跟读跑那一轮时读它）
  useEffect(() => {
    store.setHangoverMs(hangoverMs)
    saveHangover(hangoverMs)
  }, [store, hangoverMs])
  // 录音回放的额外放大倍数
  useEffect(() => {
    store.setTakeBoost(takeBoost)
    saveTakeBoost(takeBoost)
  }, [store, takeBoost])
  // 采集参数要在录音前交给录音器
  useEffect(() => {
    store.setMicOptions({ raw: micRaw, deviceId: micDevice || undefined })
  }, [store, micRaw, micDevice])
  // 首次授权前 label 可能为空，拿到一次权限后（试录/录音）再刷新
  useEffect(() => {
    void listAudioInputs().then(setInputs)
  }, [])

  // 左侧块列表自动滚到当前块；刚撕开新增了一块时，滚到那块，让它一眼能看见
  useEffect(() => {
    if (s.status !== 'ready') return
    const ol = listRef.current
    const grew = prevChunkCount.current > 0 && s.chunks.length > prevChunkCount.current
    prevChunkCount.current = s.chunks.length
    if (!ol || ol.children.length === 0) return
    const idx = grew ? Math.min(s.current + 1, s.chunks.length - 1) : s.current
    const el = ol.children[idx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [s.status, s.current, s.chunks.length])

  const exportBackup = () => {
    downloadBackup(currentBackup())
    setNotice('已下载备份 json')
  }

  /** 试录几秒马上回放，用来现场对比设备/音质；顺带把设备名刷新出来 */
  const runTestMic = async () => {
    await store.testMic(2500)
    setInputs(await listAudioInputs())
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
      // 撕块面板开着时，空格/方向键/回车归它管（面板自己用捕获阶段处理）
      if (splitOpen && (e.key === ' ' || e.key.startsWith('Arrow') || e.key === 'Enter')) return
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
      } else if (e.key === 'v' || e.key === 'V') {
        // 原文显示模式：全文 → 聚焦 → 单块
        setViewMode((v) => VIEW_MODES[(VIEW_MODES.indexOf(v) + 1) % VIEW_MODES.length])
      } else if (e.key === 'x' || e.key === 'X') {
        setSplitOpen((v) => !v)
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
  }, [store, splitOpen])

  const current = s.chunks[s.current]
  const myTakes = current ? s.takes.filter((t) => t.chunkIndex === current.index) : []

  // 每次渲染算一次（不是每行一次）：块数 × 录音数 的 O(n·m) 挪到 O(n+m)
  const takeCountByChunk = new Map<number, number>()
  for (const t of s.takes) takeCountByChunk.set(t.chunkIndex, (takeCountByChunk.get(t.chunkIndex) ?? 0) + 1)
  // 撕开时间取到 20ms 精度做成 Set，行内查表；原来每行都 some() 全量扫
  const splitTimes = new Set(s.splitPoints.map((t) => Math.round(t * 50)))

  if (s.status === 'empty') {
    return (
      <div className="app">
        <FishLayer pageKey="shadowing" />
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
      <FishLayer pageKey="shadowing" />
      <header>
        <label className="file">
          换音频
          <input
            type="file"
            accept="audio/*"
            onClick={(e) => interceptAudioPick(e, (f) => void store.load(f, f.name))}
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
        <a className="navlink accent" href="./reader.html" title="打开 学吧老哥 / 生词本">
          学吧老哥 · 生词本 <span className="arrow">→</span>
        </a>
      </header>

      {notice && (
        <div className="banner">
          {notice}
          <button className="ghost sm" onClick={() => setNotice(null)}>
            知道了
          </button>
        </div>
      )}

      {s.lowMic && (
        <div className="banner">
          麦克风电平很低（录音峰值 &lt; 0.03），录出来会又小又难判定。去系统「声音 → 输入」把这个麦的
          音量 / 增强调大，或在下拉里换一个设备端点（同名设备常有好几个）再试。
          <button className="ghost sm" onClick={() => store.dismissLowMic()}>
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
          <ol className="list" ref={listRef}>
            {s.chunks.map((c) => {
              // 计数和 ✂ 都在 map 外面先算好：原来每行都 filter 全部录音、
              // 扫全部撕开点，一篇 250 块 × 250 条录音 = 每帧几万次（录音时 25fps）
              const n = takeCountByChunk.get(c.index) ?? 0
              const cut = splitTimes.has(Math.round(c.start * 50))
              return (
                <li key={c.index}>
                  <button
                    className={c.index === s.current ? 'row on' : 'row'}
                    onClick={() => store.select(c.index)}
                  >
                    <span className="i">{c.index + 1}</span>
                    <span className="t">{fmt(c.start)}</span>
                    <span className="d">
                      {cut && (
                        <span className="cut" title="手动撕开的新边界">
                          ✂
                        </span>
                      )}
                      {n > 0 ? <b title={`${n} 条录音`}>●{n}</b> : null}
                    </span>
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
              viewMode={viewMode}
              onViewMode={setViewMode}
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
              <label className="check" title="一圈下来：标准音 → 自动录音 → 自动回放。手动录音按 R 停录后也会自动回放">
                <input
                  type="checkbox"
                  checked={s.autoCycle}
                  onChange={(e) => void store.setAutoCycle(e.target.checked)}
                />
                连续跟读（标准音 → 录音 → 回放）
              </label>
              {s.autoCycle && (
                <>
                  <span className="lab">说完静音</span>
                  <select
                    value={String(hangoverMs)}
                    onChange={(e) => setHangoverMs(Number(e.target.value))}
                    title="连续跟读里，说完之后静多久算「读完」并自动进回放。读得慢、句中有停顿就调长"
                  >
                    <option value="1600">1.6s</option>
                    <option value="2500">2.5s</option>
                    <option value="4000">4s</option>
                    <option value="6000">6s</option>
                  </select>
                  <span className="lab">算读完</span>
                </>
              )}
              {s.autoCycle && s.cycleStep === 'rec' && (
                <span className="lab">
                  录音中 · 说完停 {(s.hangoverMs / 1000).toFixed(1)} 秒自动结束（最长{' '}
                  {Math.round(s.autoRecordMs / 1000)} 秒），按空格或 R 直接结束并回放
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
                title="上一块（A，或方向键 ↑），并像按空格一样直接跑"
              >
                A ← 上一块
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
                title="下一块（D，或方向键 ↓），并像按空格一样直接跑"
              >
                下一块 → D
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
              <button
                className={splitOpen ? 'chip on' : 'chip'}
                onClick={() => setSplitOpen((v) => !v)}
                title="打开波形，把这一大块手动撕成两段（X）"
              >
                撕开 / 微调（X）
              </button>
              {s.chunkEditCount > 0 && <span className="off">已手动切 {s.chunkEditCount} 处</span>}
            </div>

            {splitOpen && current && (
              <ChunkSplitter
                samples={store.audioSamples().samples}
                sampleRate={store.audioSamples().sampleRate}
                chunk={current}
                editCount={s.chunkEditCount}
                canMergeNext={s.current < s.chunks.length - 1}
                onAudition={(a, b) => store.auditionRange(a, b)}
                onStop={() => store.stopPreview()}
                getPosition={() => store.playbackPosition()}
                onSplit={(t) => {
                  const before = store.getState().chunks.length
                  const at = store.getState().current
                  store.splitCurrentChunk(t)
                  const after = store.getState().chunks.length
                  if (after > before) {
                    setNotice(
                      `已撕开第 ${at + 1} 块：左侧列表新增了第 ${at + 2} 块（带 ✂ 标记）· 已存本机`,
                    )
                  }
                }}
                onMergeNext={() => {
                  const before = store.getState().chunks.length
                  store.mergeCurrentWithNext()
                  if (store.getState().chunks.length < before) setNotice('已合并相邻两块 · 已存本机')
                }}
                onReset={() => {
                  store.resetChunkEdits()
                  setNotice('已清除本篇的手动切分 · 已存本机')
                }}
                onClose={() => setSplitOpen(false)}
              />
            )}

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
                title="开始/停止录音；停止后自动回放刚录的这条"
              >
                {s.recording ? '■ 停止并回放（R）' : '● 录音（R）'}
              </button>
              <div className="meter">
                <div className="bar" style={{ width: `${Math.round(s.level * 100)}%` }} />
              </div>
              <span className="lv" title="当前输入电平（峰值）。说话时应明显高于安静时的数">
                {s.level.toFixed(2)}
              </span>
            </div>

            <div className="row mic">
              <span className="lab">麦克风</span>
              <select
                value={micDevice}
                onChange={(e) => setMicDevice(e.target.value)}
                title="换一个输入设备试试——蓝牙耳麦只有窄带，天生发闷"
              >
                <option value="">系统默认</option>
                {inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="lab">音质</span>
              <button
                className={micRaw ? 'chip on' : 'chip'}
                onClick={() => setMicRaw(true)}
                title="关掉浏览器的降噪 / 回声消除，保真优先（发闷通常就是降噪干的）；自动增益保留，保证音量"
              >
                原声
              </button>
              <button
                className={!micRaw ? 'chip on' : 'chip'}
                onClick={() => setMicRaw(false)}
                title="打开浏览器那套降噪，嘈杂环境用"
              >
                降噪
              </button>
              <button
                className="ghost sm"
                onClick={() => void runTestMic()}
                disabled={s.recording}
                title="录 2.5 秒马上回放，用来对比不同设备/音质。不会占当前块的录音"
              >
                试录 2.5 秒
              </button>
              <span className="lab">回放放大</span>
              <select
                value={String(takeBoost)}
                onChange={(e) => setTakeBoost(Number(e.target.value))}
                title="录音回放的额外音量（在「对齐标准音」之上再乘）。觉得还是小就往大调；太大可能削波"
              >
                <option value="1">不放大</option>
                <option value="1.5">+50%</option>
                <option value="2">+100%</option>
                <option value="3">+200%</option>
                <option value="4">+300%</option>
              </select>
              <span className="lab">
                {micRaw ? '原声（推荐）' : '降噪'} · 蓝牙麦换有线常有奇效
              </span>
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
                    <TakeExport take={t} fileName={`${s.current + 1}-${i + 1}.${extOf(t.mimeType)}`} />
                    <button className="ghost sm" onClick={() => void store.removeTake(t.id)}>
                      删
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="hint">
              空格 播放/暂停 · A/D（或 ↑↓）切块（直接跑）· R 录音（停了自动回放）· C 对比 · T 改文本 ·
              V 原文显示模式 · X 撕开/微调当前块（面板里点波形试听、Enter 在播放头撕开） ·
              S 标记正文起点 · 选字锚点用 , . 调起点、Shift+, . 调终点 ·
              [ ] 微调文字偏移（Shift 加大步长）。录音、进度都存本机，关页面不丢。
            </p>
          </main>
        </div>
      )}
    </div>
  )
}
