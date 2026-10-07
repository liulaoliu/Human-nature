import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence } from '../../types/document'
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
}

const cursorKey = (docKey: string) => `reader:speedCursor:${docKey}`
function readCursor(k: string): number {
  try {
    return parseInt(localStorage.getItem(k) || '0', 10) || 0
  } catch {
    return 0
  }
}

/**
 * 逐句速读：一次一句 → 我先读 → 空格揭示释义/语言点；超时算「不太理解」→ 四选一拷打；
 * 理解后下一句。带配速条、目标 WPM、进度与总结。拷打时原文隐藏，只给挖空句与选项。
 */
export default function SpeedReadPanel({ sentences, docKey, onClose, onSpeak, ttsState }: SpeedReadPanelProps) {
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
  }, [advance, chooseDrill, onClose, phase, drill])

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
        <span className="muted">{done ? '完成' : `第 ${index + 1} / ${n} 句`}</span>
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
                <div className={'speed-sentence' + (phase === 'drill' ? ' is-hidden' : '')}>{sentence.text}</div>
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
