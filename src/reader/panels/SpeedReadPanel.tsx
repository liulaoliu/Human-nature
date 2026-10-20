import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Sentence } from '../../types/document'
import { readNum, writeNum } from '../storage'
import { useHotkeys } from '../useHotkeys'
import {
  DEFAULT_WPM,
  checkDrill,
  contentWords,
  pickDrill,
  summarize,
  targetMs,
  wordCount,
  type SpeedReadDrill,
  type SpeedRow,
} from '../../core/speedRead'
import { useLocalStorageState, persistentBool, persistentBoolTrue, persistentNumber } from '../hooks/useLocalStorageState'
import { useSpeedReadWords } from '../hooks/useSpeedReadWords'
import SpeedReadSentence, { type SpeedReadPhase as Phase } from './SpeedReadSentence'
import SpeedReadBasket, { SpeedReadDone } from './SpeedReadBasket'

export interface SpeedReadPanelProps {
  sentences: Sentence[]
  docKey: string
  onClose: () => void
  onSpeak: (text: string) => void
  ttsState: 'idle' | 'loading' | 'playing'
  /** 把「待加入」清单写进生词本（每项自带来源句，可跨句）。 */
  onAddItems: (items: { word: string; sentenceId: string | null; sentenceText: string }[]) => void
  /** 该词是否已在生词本（用于标记 / 禁用快捷词）。 */
  isKnown: (word: string) => boolean
  /** 已在生词本里的词的「含义」（速读时悬浮显示；返回 null 表示没有） */
  wordMeaning?: (word: string) => string | null
  /** 这篇过完时回调一次（「读完」目标记一笔）。 */
  onFinishRead?: () => void
  /** 把语言点里的词组 / 习语一键加入生词本（`英文 — 中文` 会拆成词条 + 释义）。 */
  onAddPhrases?: (items: string[], sentence: Sentence) => void
  /** 轻提示（如「先勾选词模式」）。 */
  onHint?: (msg: string) => void
  /** 本句来源的词条（含短语），用于「本句已在生词本」行。 */
  wordsInSentence: (sentenceId: string) => string[]
  /** 把误加的词从生词本移除（调用方自行做两步确认 UI）。 */
  onRemoveWord: (word: string) => void
  /** 阅读页「选词模式」是否开启：开启时禁用正文选中/复制（避免和点词打架）。 */
  vocabMode: boolean
  /** 给这一句加/改语言点（复用阅读页的语言点编辑器）。 */
  onOpenLang: (sentence: Sentence) => void
  /** 语言点编辑器是否在速读之上打开（打开时不抢键盘）。 */
  langEditorOpen: boolean
}

const cursorKey = (docKey: string) => `reader:speedCursor:${docKey}`
function readCursor(k: string): number {
  return readNum(k, 0)
}

/**
 * 逐句速读：一次一句 → 我先读 → 空格揭示释义/语言点；超时算「不太理解」→ 四选一拷打；
 * 理解后下一句。带配速条、目标 WPM、进度与总结。拷打时原文隐藏，只给挖空句与选项。
 */
export default function SpeedReadPanel({ sentences, docKey, onClose, onSpeak, ttsState, onAddItems, isKnown, wordMeaning, onFinishRead, onAddPhrases, onHint, wordsInSentence, onRemoveWord, vocabMode, onOpenLang, langEditorOpen }: SpeedReadPanelProps) {
  const n = sentences.length
  const [wpm, setWpm] = useLocalStorageState('reader:speedWpm', DEFAULT_WPM, persistentNumber)
  const [autoDrill, setAutoDrill] = useLocalStorageState('reader:speedAutoDrill', true, persistentBoolTrue)
  /** 选词模式：开启后才能点词选中（配合「加入清单」）；默认关闭，避免误点。 */
  const [pickMode, setPickMode] = useLocalStorageState('reader:speedPickMode', false, persistentBool)
  const [index, setIndex] = useState(() => Math.min(readCursor(cursorKey(docKey)), Math.max(0, n - 1)))
  const [phase, setPhase] = useState<Phase>('read')
  const [elapsed, setElapsed] = useState(0)
  const [readMs, setReadMs] = useState(0)
  const [slow, setSlow] = useState(false)
  const [drill, setDrill] = useState<SpeedReadDrill | null>(null)
  const [picked, setPicked] = useState('')
  const [drillOk, setDrillOk] = useState<boolean | null>(null)
  const [rows, setRows] = useState<SpeedRow[]>([])
  const t0 = useRef(0)
  /** 拷打答对后自动下一句的定时器。 */
  const drillTimerRef = useRef<number | null>(null)

  const sentence = sentences[index] as Sentence | undefined
  const done = index >= n

  /** 选词 / 加词 / 本页清单（数据与操作都在这里，面板只负责渲染）。 */
  const {
    spans,
    wordDraft,
    setWordDraft,
    addedWord,
    collected,
    collectedOpen,
    setCollectedOpen,
    showCollected,
    setShowCollected,
    confirmIdx,
    confirmDel,
    selWords,
    isSel,
    toggleSel,
    clearSelection,
    addSelected,
    addCustom,
    addDirect,
    mergePhrase,
    tapDelete,
    knownWords,
    tapRemove,
  } = useSpeedReadWords({
    docKey,
    sentence,
    selectionResetKey: index,
    isKnown,
    wordsInSentence,
    onAddItems,
    onRemoveWord,
  })

  /** 这篇过完（推到结尾）→ 回调一次，用于「目标备忘 · 今日读文」记账。 */
  const finishedRef = useRef(false)
  useEffect(() => {
    if (!done) {
      finishedRef.current = false
      return
    }
    if (finishedRef.current) return
    finishedRef.current = true
    onFinishRead?.()
  }, [done, onFinishRead])

  const target = sentence ? targetMs(sentence.text, wpm) : 0
  const words = sentence ? wordCount(sentence.text) : 0
  const summary = useMemo(() => summarize(rows), [rows])
  /** 干扰项池：整篇实词，选最像的做选项。 */
  const pool = useMemo(() => [...new Set(sentences.flatMap((s) => contentWords(s.text)))], [sentences])

  /** 渲染带词级点选的句子（保留标点/空格）。 */
  const sentenceParts = useMemo(() => {
    if (!sentence) return null
    const text = sentence.text
    const nodes: ReactNode[] = []
    let pos = 0
    spans.forEach((w, i) => {
      if (w.start > pos) nodes.push(text.slice(pos, w.start))
      const known = isKnown(w.text)
      const sel = isSel(i)
      const meaning = known ? wordMeaning?.(w.text) ?? null : null
      const hint = pickMode
        ? '点一下选中/取消（再点「加入清单」入库）；右键直接加入生词本'
        : '选词模式未开（勾上顶栏「选词模式」才能点选 / 右键入库）'
      nodes.push(
        <span
          key={i}
          className={'speed-w' + (sel ? ' sel' : '') + (known ? ' known' : '') + (pickMode ? ' pick' : '')}
          title={meaning ? `含义：${meaning}\n${hint}` : hint}
          onClick={(e) => {
            e.stopPropagation()
            if (pickMode) toggleSel(i)
            else onHint?.('先勾上顶栏「选词模式」才能点选 / 右键入库')
          }}
          onContextMenu={(e) => {
            if (!pickMode) {
              e.preventDefault()
              onHint?.('先勾上顶栏「选词模式」才能右键入库')
              return
            }
            e.preventDefault()
            e.stopPropagation()
            addDirect(i)
          }}
        >
          {w.text}
        </span>,
      )
      pos = w.end
    })
    if (pos < text.length) nodes.push(text.slice(pos))
    return nodes
  }, [sentence, spans, isSel, toggleSel, isKnown, wordMeaning, addDirect, pickMode])

  useEffect(() => {
    if (phase !== 'read' || done) return
    t0.current = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => setElapsed(Date.now() - t0.current), 100)
    return () => window.clearInterval(id)
  }, [phase, index, done])

  const finish = useCallback(
    (okForDrill: boolean | null) => {
      if (drillTimerRef.current != null) {
        window.clearTimeout(drillTimerRef.current)
        drillTimerRef.current = null
      }
      if (!sentence) return
      setRows((r) => [...r, { words, ms: readMs || elapsed, slow, drillOk: okForDrill }])
      const next = index + 1
      try {
        writeNum(cursorKey(docKey), next < n ? next : 0)
      } catch {
        // 忽略
      }
      setIndex(next)
      setPhase('read')
      setReadMs(0)
      setSlow(false)
      setDrill(null)
      setPicked('')
      setDrillOk(null)
    },
    [sentence, words, readMs, elapsed, slow, index, n, docKey],
  )

  const advance = useCallback(() => {
    if (done || !sentence) return
    if (phase === 'read') {
      const ms = Math.max(1, elapsed)
      const isSlow = ms > target
      setReadMs(ms)
      setSlow(isSlow)
      setDrill(pickDrill(sentence, pool))
      setPicked('')
      setDrillOk(null)
      setPhase('reveal')
      return
    }
    if (phase === 'reveal') {
      if (slow && autoDrill && drill) {
        setPhase('drill')
        return
      }
      finish(null)
      return
    }
    if (phase === 'drill-answer') {
      finish(drillOk)
    }
  }, [done, sentence, phase, elapsed, target, slow, autoDrill, drill, drillOk, pool, finish])

  /** 前后翻句：只移动游标、不记成绩，并把游标落盘方便续读。 */
  const go = useCallback(
    (dir: 1 | -1) => {
      if (!n) return
      const next = Math.max(0, Math.min(n - 1, index + dir))
      if (next === index) return
      if (drillTimerRef.current != null) {
        window.clearTimeout(drillTimerRef.current)
        drillTimerRef.current = null
      }
      setIndex(next)
      setPhase('read')
      setDrill(null)
      setPicked('')
      setDrillOk(null)
      setReadMs(0)
      setSlow(false)
      try {
        writeNum(cursorKey(docKey), next)
      } catch {
        // 忽略
      }
    },
    [index, n, docKey],
  )

  const chooseDrill = useCallback(
    (opt: string) => {
      if (phase !== 'drill' || !drill) return
      const ok = checkDrill(drill, opt)
      setPicked(opt)
      setDrillOk(ok)
      setPhase('drill-answer')
      // 答对 → 短停后自动下一句；答错 → 停下看答案（按空格继续）
      if (ok) {
        if (drillTimerRef.current != null) window.clearTimeout(drillTimerRef.current)
        drillTimerRef.current = window.setTimeout(() => {
          drillTimerRef.current = null
          finish(true)
        }, 650)
      }
    },
    [phase, drill, finish],
  )

  // 卸载时清掉自动下一句的定时器
  useEffect(() => {
    return () => {
      if (drillTimerRef.current != null) window.clearTimeout(drillTimerRef.current)
    }
  }, [])

  useHotkeys(
    (e) => {
      // 正在输入框里打字时，不要触发空格翻页 / 数字选项
      const el = e.target as HTMLElement | null
      if (langEditorOpen) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'w' || k === 'a') {
        e.preventDefault()
        go(-1)
        return
      }
      if (k === 'd') {
        e.preventDefault()
        go(1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (phase === 'drill' && drill) {
        const k = Number(e.key)
        if (k >= 1 && k <= drill.options.length) {
          e.preventDefault()
          chooseDrill(drill.options[k - 1])
          return
        }
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        advance()
      }
    },
    !langEditorOpen,
    25,
  )

  const restart = () => {
    setRows([])
    setIndex(0)
    setPhase('read')
    setDrill(null)
    setPicked('')
    setDrillOk(null)
    setReadMs(0)
    setSlow(false)
    try {
      writeNum(cursorKey(docKey), 0)
    } catch {
      // 忽略
    }
  }

  const pace = target > 0 ? Math.min(100, Math.round((elapsed / target) * 100)) : 0
  const over = elapsed > target

  return (
    <div className="study speed">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <span className="speed-nav">
          <button onClick={() => go(-1)} disabled={index <= 0} title="上一句（←）">
            ‹
          </button>
          <span className="muted">{done ? '完成' : `第 ${index + 1} / ${n} 句`}</span>
          <button onClick={() => go(1)} disabled={done} title="下一句（→）">
            ›
          </button>
        </span>
        <label className="check-inline" title="目标阅读速度：低于这个速度就算「不太理解」">
          速度
          <select value={String(wpm)} onChange={(e) => setWpm(Number(e.target.value))}>
            <option value="80">80 词/分</option>
            <option value="100">100</option>
            <option value="120">120</option>
            <option value="150">150</option>
            <option value="180">180（快）</option>
            <option value="220">220（很快）</option>
          </select>
        </label>
        <label className="check-inline" title="超时就先来一道四选一再继续">
          <input type="checkbox" checked={autoDrill} onChange={(e) => setAutoDrill(e.target.checked)} />
          超时拷打
        </label>
        <label className="check-inline" title="开启后才能点词选中（配合「加入清单」）；默认关闭，避免误点">
          <input
            type="checkbox"
            checked={pickMode}
            onChange={(e) => {
              setPickMode(e.target.checked)
              if (!e.target.checked) clearSelection()
            }}
          />
          选词模式
        </label>
        <button
          onClick={() => sentence && onOpenLang(sentence)}
          disabled={!sentence}
          title="给这一句加/改语言点（结构 / 语法 / 习语 / 词组 / 用法）"
        >
          ＋ 语言点
        </button>
        <span className="muted">平均 {summary.avgWpm} 词/分 · 超时 {summary.slow}</span>
      </div>

      <div className="speed-progress" title="整篇进度">
        <div style={{ width: `${n ? (Math.min(index, n) / n) * 100 : 0}%` }} />
      </div>

      <SpeedReadBasket
        collected={collected}
        collectedOpen={collectedOpen}
        showCollected={showCollected}
        confirmIdx={confirmIdx}
        onToggleOpen={() => setCollectedOpen((v) => !v)}
        onShowChange={setShowCollected}
        onTapDelete={tapDelete}
      />

      {done ? (
        <SpeedReadDone summary={summary} onRestart={restart} onClose={onClose} />
      ) : (
        sentence && (
          <SpeedReadSentence
            sentence={sentence}
            phase={phase}
            sentenceParts={sentenceParts}
            over={over}
            words={words}
            target={target}
            elapsed={elapsed}
            pace={pace}
            pickMode={pickMode}
            vocabMode={vocabMode}
            autoDrill={autoDrill}
            drill={drill}
            picked={picked}
            drillOk={drillOk}
            readMs={readMs}
            slow={slow}
            selWords={selWords}
            addedWord={addedWord}
            wordDraft={wordDraft}
            knownWords={knownWords}
            confirmDel={confirmDel}
            ttsState={ttsState}
            onAddPhrases={onAddPhrases}
            addSelected={addSelected}
            mergePhrase={mergePhrase}
            setWordDraft={setWordDraft}
            addCustom={addCustom}
            tapRemove={tapRemove}
            advance={advance}
            onClose={onClose}
            onSpeak={onSpeak}
            chooseDrill={chooseDrill}
          />
        )
      )}
    </div>
  )
}
