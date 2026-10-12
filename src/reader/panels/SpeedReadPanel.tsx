import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Sentence } from '../../types/document'
import { wordSpans } from '../../core/wordSelect'
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
import { useLocalStorageState, persistentBoolTrue, persistentNumber } from '../hooks/useLocalStorageState'

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
  /** 本句来源的词条（含短语），用于「本句已在生词本」行。 */
  wordsInSentence: (sentenceId: string) => string[]
  /** 把误加的词从生词本移除（调用方自行做两步确认 UI）。 */
  onRemoveWord: (word: string) => void
}

const cursorKey = (docKey: string) => `reader:speedCursor:${docKey}`
function readCursor(k: string): number {
  try {
    return parseInt(localStorage.getItem(k) || '0', 10) || 0
  } catch {
    return 0
  }
}

/** 「待加入」清单里的一项：词/词组 + 来源句（跨句累积、持久化）。 */
interface BasketItem {
  word: string
  sentenceId: string | null
  sentenceText: string
}
const basketKey = (docKey: string) => `reader:speedBasket:${docKey}`
function loadBasket(docKey: string): BasketItem[] {
  try {
    const raw = localStorage.getItem(basketKey(docKey))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? arr.filter((x): x is BasketItem => !!x && typeof x.word === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * 逐句速读：一次一句 → 我先读 → 空格揭示释义/语言点；超时算「不太理解」→ 四选一拷打；
 * 理解后下一句。带配速条、目标 WPM、进度与总结。拷打时原文隐藏，只给挖空句与选项。
 */
export default function SpeedReadPanel({ sentences, docKey, onClose, onSpeak, ttsState, onAddItems, isKnown, wordsInSentence, onRemoveWord }: SpeedReadPanelProps) {
  const n = sentences.length
  const [wpm, setWpm] = useLocalStorageState('reader:speedWpm', DEFAULT_WPM, persistentNumber)
  const [autoDrill, setAutoDrill] = useLocalStorageState('reader:speedAutoDrill', true, persistentBoolTrue)
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
  const target = sentence ? targetMs(sentence.text, wpm) : 0
  const words = sentence ? wordCount(sentence.text) : 0
  const summary = useMemo(() => summarize(rows), [rows])
  /** 干扰项池：整篇实词，选最像的做选项。 */
  const pool = useMemo(() => [...new Set(sentences.flatMap((s) => contentWords(s.text)))], [sentences])

  /** 加生词：输入框草稿 + 待加入清单（跨句累积、持久化）+ 刚加入的提示。 */
  const [wordDraft, setWordDraft] = useState('')
  const [addedWord, setAddedWord] = useState('')
  const [basket, setBasket] = useState<BasketItem[]>(() => loadBasket(docKey))
  /** 两步确认移出的词。 */
  const [confirmDel, setConfirmDel] = useState('')
  /** 当前句按词切分（复用正文同款 wordSpans）。 */
  const spans = useMemo(() => (sentence ? wordSpans(sentence.text) : []), [sentence])

  // 待加入清单落盘（翻页 / 关掉重开都不丢）
  useEffect(() => {
    try {
      localStorage.setItem(basketKey(docKey), JSON.stringify(basket))
    } catch {
      // 忽略
    }
  }, [basket, docKey])

  const sid = sentence?.id ?? null
  const inBasket = useCallback(
    (word: string) => basket.some((x) => x.sentenceId === sid && x.word.toLowerCase() === word.toLowerCase()),
    [basket, sid],
  )
  /** 本句已进清单的词（用于合成词组）。 */
  const selHere = useMemo(() => basket.filter((x) => x.sentenceId === sid), [basket, sid])

  const toggleWord = useCallback(
    (word: string) => {
      if (!sentence) return
      setBasket((prev) => {
        const i = prev.findIndex(
          (x) => x.sentenceId === sentence.id && x.word.toLowerCase() === word.toLowerCase(),
        )
        if (i >= 0) return prev.filter((_, k) => k !== i)
        return [...prev, { word, sentenceId: sentence.id, sentenceText: sentence.text }]
      })
    },
    [sentence],
  )

  const addCustom = useCallback(
    (w: string) => {
      const t = w.trim()
      if (!t || !sentence) return
      setBasket((prev) =>
        prev.some((x) => x.sentenceId === sentence.id && x.word.toLowerCase() === t.toLowerCase())
          ? prev
          : [...prev, { word: t, sentenceId: sentence.id, sentenceText: sentence.text }],
      )
      setWordDraft('')
    },
    [sentence],
  )

  const removeBasket = useCallback((i: number) => setBasket((prev) => prev.filter((_, k) => k !== i)), [])

  /** 把本句已选中的词按顺序合成一个词组条目（中间夹着的词不加入）。 */
  const mergePhrase = useCallback(() => {
    if (!sentence || selHere.length < 2) return
    const phrase = selHere.map((x) => x.word).join(' ')
    setBasket((prev) => [
      ...prev.filter((x) => x.sentenceId !== sentence.id),
      { word: phrase, sentenceId: sentence.id, sentenceText: sentence.text },
    ])
  }, [sentence, selHere])

  /** 一次性把清单里所有项写进生词本。 */
  const addAll = useCallback(() => {
    const items = basket
      .map((x) => ({ word: x.word.trim(), sentenceId: x.sentenceId, sentenceText: x.sentenceText }))
      .filter((x) => x.word)
    if (!items.length) return
    onAddItems(items)
    const label = items.map((x) => x.word).join('、')
    setAddedWord(label)
    setBasket([])
    setWordDraft('')
    window.setTimeout(() => setAddedWord((cur) => (cur === label ? '' : cur)), 2200)
  }, [basket, onAddItems])

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
      const sel = inBasket(w.text)
      nodes.push(
        <span
          key={i}
          className={'speed-w' + (sel ? ' sel' : '') + (known ? ' known' : '')}
          title={known ? '已在生词本' : sel ? '点一下移出「待加入」' : '点一下加入「待加入」'}
          onClick={(e) => {
            e.stopPropagation()
            toggleWord(w.text)
          }}
        >
          {w.text}
        </span>,
      )
      pos = w.end
    })
    if (pos < text.length) nodes.push(text.slice(pos))
    return nodes
  }, [sentence, spans, inBasket, toggleWord, isKnown])

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
  }, [advance, chooseDrill, onClose, phase, drill, go])

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
        <span className="muted">平均 {summary.avgWpm} 词/分 · 超时 {summary.slow}</span>
      </div>

      <div className="speed-progress" title="整篇进度">
        <div style={{ width: `${n ? (Math.min(index, n) / n) * 100 : 0}%` }} />
      </div>

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
                <div className={'speed-sentence' + (phase === 'drill' ? ' is-hidden' : '')}>{sentenceParts}</div>
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
                  {sentence.language && (
                    <div className="speed-lang">
                      {sentence.language.structure && <div>结构：{sentence.language.structure}</div>}
                      {sentence.language.grammar && <div>语法：{sentence.language.grammar}</div>}
                      {sentence.language.idioms?.length ? <div>习语：{sentence.language.idioms.join('；')}</div> : null}
                      {sentence.language.phrases?.length ? <div>词组：{sentence.language.phrases.join('；')}</div> : null}
                      {sentence.language.usage?.length ? <div>用法：{sentence.language.usage.join('；')}</div> : null}
                    </div>
                  )}
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
                  <span className="muted">点词加入「待加入」清单（跨句累积，翻页 / 重开都不丢）：</span>
                  {basket.length ? <b>{basket.length} 个待加入</b> : <span className="muted">还没选</span>}
                  {basket.length > 0 && (
                    <>
                      <button className="primary" onClick={addAll}>
                        ＋ 全部加入生词本（{basket.length}）
                      </button>
                      <button onClick={() => setBasket([])} title="清空待加入清单（不影响已入库的）">
                        清空
                      </button>
                    </>
                  )}
                  {addedWord && <span className="speed-added">✔ 已加入：{addedWord}</span>}
                </div>
                {basket.length > 0 && (
                  <div className="speed-basket">
                    {basket.map((it, i) => (
                      <button
                        key={`${it.sentenceId}|${it.word}|${i}`}
                        className="speed-basket-chip"
                        title={`点一下移除。来源：${it.sentenceText.slice(0, 50)}${it.sentenceText.length > 50 ? '…' : ''}`}
                        onClick={() => removeBasket(i)}
                      >
                        {it.word} <span className="speed-x">×</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="speed-addword-row">
                  <input
                    className="speed-addword-input"
                    placeholder="也可手打词 / 词组，回车加入清单"
                    value={wordDraft}
                    onChange={(e) => setWordDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustom(wordDraft)
                      }
                    }}
                  />
                  <button className="primary" disabled={!wordDraft.trim()} onClick={() => addCustom(wordDraft)}>
                    ＋ 加入清单
                  </button>
                  {selHere.length > 1 && (
                    <button onClick={mergePhrase} title="把本句已选中的词按顺序合成一个词组条目（中间夹着的词不加入）">
                      ＋ 合成本句词组
                    </button>
                  )}
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
