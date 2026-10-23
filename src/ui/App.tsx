import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { BackupBar, Empty, TakesList, fmt, interceptAudioPick } from './AppBits'
import { AppBanners } from './AppBanners'
import { ChunkList } from './ChunkList'
import { CycleRow } from './CycleRow'
import { AlignmentRow } from './AlignmentRow'
import { AbCompareRow, TransportBar } from './TransportBar'
import { RecorderPanel } from './RecorderPanel'

/**
 * 跟读页的装配层：建 store、把本机偏好和小状态挂上去、把各段交给子组件。
 *
 * 页面被拆成六块，都只接 props、不碰 store：
 * `ChunkList`（左侧块列表）/ `AppBanners`（顶部提示）/ `CycleRow`（连续跟读）/
 * `TransportBar`（播放与切块）/ `AlignmentRow`（对齐校准）/ `RecorderPanel`（录制与麦克风）。
 * 这样改一块的样式不用在六百行 JSX 里翻。
 */
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
        <Link className="navlink accent" to="/reader" title="打开 学吧老哥 / 生词本">
          学吧老哥 · 生词本 <span className="arrow">→</span>
        </Link>
      </header>

      <AppBanners
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        lowMic={s.lowMic}
        onDismissLowMic={() => store.dismissLowMic()}
        status={s.status}
        error={s.error}
      />

      {s.status === 'ready' && (
        <div className="body">
          <ChunkList
            chunks={s.chunks}
            current={s.current}
            takeCountByChunk={takeCountByChunk}
            splitTimes={splitTimes}
            onSelect={(i) => store.select(i)}
          />

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

            <CycleRow
              autoCycle={s.autoCycle}
              hangoverMs={hangoverMs}
              activeHangoverMs={s.hangoverMs}
              autoRecordMs={s.autoRecordMs}
              cycleStep={s.cycleStep}
              onToggle={(on) => void store.setAutoCycle(on)}
              onHangover={setHangoverMs}
            />

            <TransportBar
              current={s.current}
              chunkCount={s.chunks.length}
              playing={s.playing}
              autoCycle={s.autoCycle}
              cycleStep={s.cycleStep}
              rate={s.rate}
              granularity={s.granularity}
              splitOpen={splitOpen}
              chunkEditCount={s.chunkEditCount}
              onPrev={() => store.prev()}
              onPlay={() => void store.toggleChunkPlay()}
              onNext={() => store.next()}
              onRate={(r) => store.setRate(r)}
              onGranularity={(g) => store.setGranularity(g)}
              onToggleSplit={() => setSplitOpen((v) => !v)}
            />

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
              <AlignmentRow
                textStartChunk={s.textStartChunk}
                offsetWords={s.offsetWords}
                onSetTextStart={() => store.setTextStartChunk(s.current)}
                onClearTextStart={() => store.clearTextStart()}
                onNudgeWords={(delta) => store.nudgeOffsetWords(delta)}
                onResetAll={() => {
                  store.setOffsetWords(0)
                  store.clearTextStart()
                }}
              />
            )}

            <RecorderPanel
              recording={s.recording}
              level={s.level}
              micDevice={micDevice}
              inputs={inputs}
              micRaw={micRaw}
              takeBoost={takeBoost}
              onToggleRecord={() => void store.toggleRecording()}
              onMicDevice={setMicDevice}
              onMicRaw={setMicRaw}
              onTestMic={() => void runTestMic()}
              onTakeBoost={setTakeBoost}
            />

            <AbCompareRow
              abPlaying={s.abPlaying}
              onCompare={() => void store.compareAB(false)}
              onLoopCompare={() => void store.compareAB(true)}
              onStop={() => store.stopAb()}
              onPlayWhole={() => void store.playWhole()}
            />

            <TakesList
              takes={myTakes}
              chunkNumber={s.current + 1}
              onRemove={(id) => void store.removeTake(id)}
            />

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
