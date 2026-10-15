import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Sentence } from '../../types/document'
import { wordSpans, toggleIndex, wordsAtIndex } from '../../core/wordSelect'
import { getSentenceLanguages } from '../../core/language'
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

type Phase = 'read' | 'reveal' | 'drill' | 'drill-answer'

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
  try {
    return parseInt(localStorage.getItem(k) || '0', 10) || 0
  } catch {
    return 0
  }
}

/** 「本页加入」清单里的一项：词/词组 + 来源句（跨句累积、持久化）。 */
interface CollectedItem {
  word: string
  sentenceId: string | null
  sentenceText: string
}
const collectedKey = (docKey: string) => `reader:speedCollected:${docKey}`
function loadCollected(docKey: string): CollectedItem[] {
  try {
    const raw = localStorage.getItem(collectedKey(docKey))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? arr.filter((x): x is CollectedItem => !!x && typeof x.word === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * 逐句速读：一次一句 → 我先读 → 空格揭示释义/语言点；超时算「不太理解」→ 四选一拷打；
 * 理解后下一句。带配速条、目标 WPM、进度与总结。拷打时原文隐藏，只给挖空句与选项。
 */
export default function SpeedReadPanel({ sentences, docKey, onClose, onSpeak, ttsState, onAddItems, isKnown, wordMeaning, onFinishRead, wordsInSentence, onRemoveWord, vocabMode, onOpenLang, langEditorOpen }: SpeedReadPanelProps) {
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

  /** 加生词：输入框草稿 + 本页加入清单（跨句汇总、持久化）+ 刚加入提示。 */
  const [wordDraft, setWordDraft] = useState('')
  const [addedWord, setAddedWord] = useState('')
  /** 本页从速读加入生词本的记录（跨句汇总、持久化），可在右上角清单里删除。 */
  const [collected, setCollected] = useState<CollectedItem[]>(() => loadCollected(docKey))
  /** 右上角「本页加入」清单是否展开（可折叠，持久化）。 */
  const [collectedOpen, setCollectedOpen] = useLocalStorageState('reader:speedCollectedOpen', true, persistentBoolTrue)
  /** 是否显示「已加入生词本」的单词（关掉则列表显示为空）。 */
  const [showCollected, setShowCollected] = useLocalStorageState('reader:speedShowCollected', true, persistentBoolTrue)
  /** 删除的两步确认（点一次变红，3 秒内再点才真删）。 */
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  /** 本句当前选中的词——按**词下标**记录，同一个词的不同位置互不影响。 */
  const [selIdx, setSelIdx] = useState<number[]>([])
  /** 是否已把选中的词「合成本句词组」（合成后作为一整条加入）。 */
  const [merged, setMerged] = useState(false)
  /** 两步确认移出的词。 */
  const [confirmDel, setConfirmDel] = useState('')
  /** 当前句按词切分（复用正文同款 wordSpans）。 */
  const spans = useMemo(() => (sentence ? wordSpans(sentence.text) : []), [sentence])

  // 本页加入清单落盘（翻页 / 关掉重开都不丢）
  useEffect(() => {
    try {
      localStorage.setItem(collectedKey(docKey), JSON.stringify(collected))
    } catch {
      // 忽略
    }
  }, [collected, docKey])

  // 换句清空当前选择
  useEffect(() => {
    setSelIdx([])
    setMerged(false)
  }, [index])

  /** 当前选中的词形（按句内顺序；「合成词组」时并成一条）。 */
  const selWords = useMemo(() => {
    const picked = wordsAtIndex(spans, selIdx)
    return merged && picked.length > 1 ? [picked.join(' ')] : picked
  }, [merged, selIdx, spans])

  const isSel = useCallback((i: number) => selIdx.includes(i), [selIdx])

  /** 点击词：切换**这一个位置**的选中（只选中，不入库）。 */
  const toggleSel = useCallback((i: number) => {
    setMerged(false)
    setSelIdx((prev) => toggleIndex(prev, i))
  }, [])

  /** 把一批词加入生词本，并记入本页清单。 */
  const commitAdd = useCallback(
    (items: CollectedItem[]) => {
      const list = items.filter((x) => x.word.trim())
      if (!list.length) return
      onAddItems(list.map((x) => ({ word: x.word.trim(), sentenceId: x.sentenceId, sentenceText: x.sentenceText })))
      setCollected((prev) => {
        const out = [...prev]
        for (const it of list) {
          if (!out.some((x) => x.word.toLowerCase() === it.word.toLowerCase() && x.sentenceId === it.sentenceId)) {
            out.push({ word: it.word.trim(), sentenceId: it.sentenceId, sentenceText: it.sentenceText })
          }
        }
        return out
      })
      const label = list.map((x) => x.word.trim()).join('、')
      setAddedWord(label)
      window.setTimeout(() => setAddedWord((cur) => (cur === label ? '' : cur)), 2000)
    },
    [onAddItems],
  )

  /** 「加入清单」：把本句选中的词（或合成后的词组）加入生词本。 */
  const addSelected = useCallback(() => {
    if (!sentence || !selWords.length) return
    commitAdd(selWords.map((w) => ({ word: w, sentenceId: sentence.id, sentenceText: sentence.text })))
    setSelIdx([])
    setMerged(false)
  }, [sentence, selWords, commitAdd])

  /** 输入框手打词/词组：直接加入。 */
  const addCustom = useCallback(
    (w: string) => {
      const t = w.trim()
      if (!t || !sentence) return
      commitAdd([{ word: t, sentenceId: sentence.id, sentenceText: sentence.text }])
      setWordDraft('')
    },
    [sentence, commitAdd],
  )

  /** 右键：把**这一个位置**的词加入生词本（等价于「加入清单」）。 */
  const addDirect = useCallback(
    (i: number) => {
      const word = spans[i]?.text
      if (!sentence || !word) return
      commitAdd([{ word, sentenceId: sentence.id, sentenceText: sentence.text }])
      setMerged(false)
      setSelIdx((prev) => prev.filter((x) => x !== i))
    },
    [sentence, spans, commitAdd],
  )

  /** 把本句选中的词按句内顺序合成一个词组（替换当前选择，待「加入清单」）。 */
  const mergePhrase = useCallback(() => {
    if (!sentence || merged || selIdx.length < 2) return
    if (wordsAtIndex(spans, selIdx).length < 2) return
    setMerged(true)
  }, [sentence, merged, selIdx, spans])

  /** 从本页清单删除一条（同时从生词本移除，用于剔除误加）。 */
  const removeCollected = useCallback(
    (i: number) => {
      const it = collected[i]
      if (!it) return
      onRemoveWord(it.word)
      setCollected((prev) => prev.filter((_, k) => k !== i))
    },
    [collected, onRemoveWord],
  )

  /** 删除（两步确认）：第一次点变红，3 秒内再点才真删。 */
  const tapDelete = useCallback(
    (i: number) => {
      if (confirmIdx === i) {
        removeCollected(i)
        setConfirmIdx(null)
        return
      }
      setConfirmIdx(i)
      window.setTimeout(() => setConfirmIdx((cur) => (cur === i ? null : cur)), 3000)
    },
    [confirmIdx, removeCollected],
  )

  /** 本句已在生词本的词 / 短语（含从本句加入的多词词组），用于「移出」。 */
  const knownWords = useMemo(() => {
    const out: string[] = []
    const push = (w: string) => {
      const t = w.trim()
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
    }
    for (const w of spans) if (isKnown(w.text)) push(w.text)
    if (sentence) for (const w of wordsInSentence(sentence.id)) push(w)
    return out
  }, [spans, isKnown, wordsInSentence, sentence])

  /** 两步确认移出生词本。 */
  const tapRemove = useCallback(
    (word: string) => {
      if (confirmDel === word) {
        onRemoveWord(word)
        setConfirmDel('')
        return
      }
      setConfirmDel(word)
      window.setTimeout(() => setConfirmDel((cur) => (cur === word ? '' : cur)), 3000)
    },
    [confirmDel, onRemoveWord],
  )

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
          }}
          onContextMenu={(e) => {
            if (!pickMode) return
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
        localStorage.setItem(cursorKey(docKey), String(next < n ? next : 0))
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
        localStorage.setItem(cursorKey(docKey), String(next))
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, chooseDrill, onClose, phase, drill, go, langEditorOpen])

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
      localStorage.setItem(cursorKey(docKey), '0')
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
              if (!e.target.checked) {
                setSelIdx([])
                setMerged(false)
              }
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

      {collected.length > 0 && (
        <div className={'speed-basket-panel' + (collectedOpen ? '' : ' collapsed')}>
          <div className="speed-basket-head">
            <b>本页加入（{collected.length}）</b>
            <label className="check-inline" title="开=显示已加入生词本的单词；关=列表显示为空">
              <input type="checkbox" checked={showCollected} onChange={(e) => setShowCollected(e.target.checked)} />
              显示已加入
            </label>
            <button onClick={() => setCollectedOpen((v) => !v)} title={collectedOpen ? '折叠清单' : '展开清单'}>
              {collectedOpen ? '▾ 折叠' : '▸ 展开'}
            </button>
          </div>
          <div className="speed-basket-body">
            {showCollected ? (
              <div className="speed-basket-list">
                {collected.map((it, i) => (
                  <div className="speed-basket-row" key={`${it.sentenceId}|${it.word}|${i}`}>
                    <span className="speed-basket-word">{it.word}</span>
                    {it.sentenceText && (
                      <span className="muted ellipsis" title={it.sentenceText}>
                        {it.sentenceText}
                      </span>
                    )}
                    <button
                      className={confirmIdx === i ? 'danger' : ''}
                      onClick={() => tapDelete(i)}
                      title={confirmIdx === i ? '再点一次确认移出（两步确认）' : '从生词本移出（剔除误加）'}
                    >
                      {confirmIdx === i ? '确认删除' : '删除'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted speed-basket-empty">已加入的单词已隐藏（勾选「显示已加入」查看）</div>
            )}
          </div>
        </div>
      )}

      {done ? (
        <div className="study-done speed-summary">
          <p>
            读完 <b>{summary.count}</b> 句 · 平均 <b>{summary.avgWpm}</b> 词/分 · 超时 <b>{summary.slow}</b> 句
            {summary.drillTotal > 0 ? ` · 拷打对 ${summary.drillCorrect}/${summary.drillTotal}` : ''}
          </p>
          <div className="bar">
            <button className="primary" onClick={restart}>
              再来一遍
            </button>
            <button onClick={onClose}>回到阅读</button>
          </div>
        </div>
      ) : (
        sentence && (
          <>
            <div className="study-card speed-card">
              <div className="bar speed-meta">
                <span className={over ? 'speed-pace over' : 'speed-pace ok'}>{over ? '⏱ 超时' : '⚡ 在配速内'}</span>
                <span className="muted">
                  {words} 词 · 目标 {(target / 1000).toFixed(1)}s · 已用 {(elapsed / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="speed-timebar">
                <div className={over ? 'over' : ''} style={{ width: `${pace}%` }} />
              </div>

              {/* 拷打时隐藏原文文字，但保留 div 占位，避免布局跳动 */}
              <div className="speed-sentence-slot">
                <div
                  className={'speed-sentence' + (phase === 'drill' ? ' is-hidden' : '')}
                  style={{ userSelect: pickMode || vocabMode ? 'none' : 'text' }}
                >
                  {sentenceParts}
                </div>
                {phase === 'drill' && (
                  <div className="speed-hidden-overlay">原文已隐藏 —— 只看挖空句，从选项里选</div>
                )}
              </div>

              {phase === 'read' && (
                <div className="speed-hint muted">
                  先自己读一遍 → 按 <kbd>空格</kbd> 看释义与语言点
                </div>
              )}

              {(phase === 'reveal' || phase === 'drill-answer') && (
                <div className="speed-reveal">
                  {sentence.translation && <div className="speed-tr">{sentence.translation}</div>}
                  {getSentenceLanguages(sentence).map((L, li) => (
                    <div className="speed-lang" key={li}>
                      {L.source === 'manual' && <div className="muted">手动语言点</div>}
                      {L.structure && <div>结构：{L.structure}</div>}
                      {L.grammar && <div>语法：{L.grammar}</div>}
                      {L.idioms?.length ? <div>习语：{L.idioms.join('；')}</div> : null}
                      {L.phrases?.length ? <div>词组：{L.phrases.join('；')}</div> : null}
                      {L.usage?.length ? <div>用法：{L.usage.join('；')}</div> : null}
                    </div>
                  ))}
                  {sentence.collocations.length > 0 && <div className="muted">搭配：{sentence.collocations.join('；')}</div>}
                  {readMs > 0 && (
                    <div className="muted">
                      本句速度 {Math.round((words / readMs) * 60000)} 词/分{slow ? '（超时）' : ''}
                    </div>
                  )}
                  {slow && (
                    <div className="speed-banner">
                      {autoDrill && drill ? '⏱ 超时了，先来一道再继续' : '⏱ 这句超时了（没题可练，直接继续）'}
                    </div>
                  )}
                </div>
              )}

              {(phase === 'drill' || phase === 'drill-answer') && drill && (
                <div className="speed-drill">
                  <div className="speed-drill-title">
                    拷打：把空填回来
                    <span className="muted">（{drill.via === 'phrase' ? '语言点搭配' : drill.via === 'vocab' ? '本句生词' : '实词'}）</span>
                  </div>
                  <div className="speed-drill-prompt">{drill.prompt}</div>
                  <div className="quiz-options">
                    {drill.options.map((opt, i) => {
                      const cls = !picked
                        ? ''
                        : opt === drill.answer
                          ? 'primary'
                          : opt === picked
                            ? 'danger'
                            : ''
                      return (
                        <button key={opt} className={cls} disabled={!!picked} onClick={() => chooseDrill(opt)}>
                          <kbd>{i + 1}</kbd> {opt}
                        </button>
                      )
                    })}
                  </div>
                  {picked && (
                    <div className={'speed-drill-result ' + (drillOk ? 'ok' : 'bad')}>
                      {drillOk ? '✔ 正确' : `✘ 正确答案：${drill.answer}`}
                      <div className="muted speed-answer-sentence">{sentence.text}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {phase !== 'drill' && (
              <div className="speed-addword">
                <div className="speed-selbar">
                  <span className="muted">勾顶栏「选词模式」后：点词选中 → 「加入清单」或右键入库；右上角清单可删除误加。</span>
                  {selWords.length > 0 && <b>已选：{selWords.join(' · ')}</b>}
                  {addedWord && <span className="speed-added">✔ 已加入：{addedWord}</span>}
                </div>
                <div className="speed-addword-row">
                  <button className="primary" disabled={!selWords.length} onClick={addSelected}>
                    ＋ 加入清单{selWords.length ? `（${selWords.length}）` : ''}
                  </button>
                  {selWords.length > 1 && (
                    <button
                      onClick={mergePhrase}
                      title="把本句选中的词按顺序合成一个词组（中间夹着的词不加入；同一个词的不同位置互不影响）"
                    >
                      ＋ 合成本句词组
                    </button>
                  )}
                  <input
                    className="speed-addword-input"
                    placeholder="也可手打词 / 词组，回车加入"
                    value={wordDraft}
                    onChange={(e) => setWordDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustom(wordDraft)
                      }
                    }}
                  />
                  <button disabled={!wordDraft.trim()} onClick={() => addCustom(wordDraft)}>
                    加入
                  </button>
                </div>
                {knownWords.length > 0 && (
                  <div className="speed-known">
                    <span className="muted">本句已在生词本（点两下移出）：</span>
                    {knownWords.map((w) => (
                      <button
                        key={w}
                        className={'speed-known-chip' + (confirmDel === w ? ' danger' : '')}
                        onClick={() => tapRemove(w)}
                        title={confirmDel === w ? '再点一次确认移出' : '移出生词本（两步确认）'}
                      >
                        {confirmDel === w ? `确认移出「${w}」` : w}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bar study-actions">
              <button onClick={() => onSpeak(sentence.text)} title="朗读本句（已缓存则秒播）">
                {ttsState === 'loading' ? '🔊 合成中…' : '🔊 读本句'}
              </button>
              {phase === 'read' && (
                <button className="primary" onClick={advance}>
                  读完了（空格）
                </button>
              )}
              {phase === 'reveal' && (
                <button className="primary" onClick={advance}>
                  {slow && autoDrill && drill ? '来一道（空格）' : '下一句（空格）'}
                </button>
              )}
              {phase === 'drill-answer' && (
                <button className="primary" onClick={advance}>
                  下一句（空格）
                </button>
              )}
              <button onClick={onClose}>退出</button>
            </div>
          </>
        )
      )}
    </div>
  )
}
