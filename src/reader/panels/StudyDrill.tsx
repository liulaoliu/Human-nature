import { useEffect, useMemo, useState } from 'react'
import type { VocabItem } from '../../types/document'
import { useHotkeys } from '../useHotkeys'
import { canQuizMeaning, displayMeaning, normalizePos } from '../../core/vocab'

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
/** 去掉首尾标点，便于搭配比对。 */
const stripPunct = (s: string) => s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').trim()

/** 稳定哈希（用卡 id 做种子，保证同一卡的选项顺序不乱跳）。 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

interface DrillStep {
  kind: 'spell' | 'meaning' | 'usage'
}

/** 由当前卡构造「强制锤炼」步骤（有数据的才出）。听写句子那一步已去掉。 */
function buildSteps(card: VocabItem, items: VocabItem[]): DrillStep[] {
  const steps: DrillStep[] = []
  if (card.word) steps.push({ kind: 'spell' })
  if (canQuizMeaning(card, items)) steps.push({ kind: 'meaning' })
  if (card.usage.length || card.phrases?.length) steps.push({ kind: 'usage' })
  return steps
}

/** 可用于「写搭配」的答案：用法 + 词组。 */
function collocationsOf(card: VocabItem): string[] {
  return [...card.usage, ...(card.phrases ?? [])]
}

/** 选词义：正确释义 + 3 个来自其它词的释义（确定性排序）。 */
function meaningOptions(card: VocabItem, items: VocabItem[]): { text: string; correct: boolean }[] {
  const correct = displayMeaning(card)
  const pool = [...new Set(items.filter((it) => it.id !== card.id).map((it) => displayMeaning(it)).filter(Boolean))]
    .filter((m) => m !== correct)
  const picked = pool
    .map((m) => ({ m, k: hash(card.id + '|' + m) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map((x) => x.m)
  return [correct, ...picked]
    .map((t) => ({ t, correct: t === correct, k: hash(card.id + '#' + t) }))
    .sort((a, b) => a.k - b.k)
    .map(({ t, correct: c }) => ({ text: t, correct: c }))
}

/** 词库够不够出 4 个释义选项（正确 + 3 个干扰项）。 */
/**
 * 「选中文释义」独立组件：强制锤炼和「不认识」复习加练共用。
 * 选对才回调 onPass；选错只标红当前项，不泄露正确答案。
 */
export function MeaningQuiz({
  card,
  items,
  onSpeak,
  onPass,
}: {
  card: VocabItem
  items: VocabItem[]
  onSpeak?: (text: string) => void
  onPass: () => void
}) {
  const options = useMemo(() => meaningOptions(card, items), [card, items])
  /** -1 = 还没按 A/D，不预选，避免泄露答案。 */
  const [focus, setFocus] = useState(-1)
  const [wrongPick, setWrongPick] = useState<number | null>(null)

  useEffect(() => {
    setFocus(-1)
    setWrongPick(null)
  }, [card.id])

  const pick = (o: { text: string; correct: boolean } | undefined, i: number) => {
    if (!o) return
    if (o.correct) onPass()
    else setWrongPick(i)
  }

  // 1-4 直接选，A/D（或 ←/→）切换高亮，回车确认
  useHotkeys(
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      const n = Number(k)
      if (n >= 1 && n <= options.length) {
        e.preventDefault()
        pick(options[n - 1], n - 1)
        return
      }
      if (k === 'a' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setFocus((f) => (f <= 0 ? options.length - 1 : f - 1))
      } else if (k === 'd' || e.key === 'ArrowRight') {
        e.preventDefault()
        setFocus((f) => (f < 0 || f >= options.length - 1 ? 0 : f + 1))
      } else if (e.key === 'Enter' && focus >= 0) {
        e.preventDefault()
        pick(options[focus], focus)
      }
    },
    true,
    40,
  )

  return (
    <div className="drill meaning-gate">
      <div className="drill-head">
        <b>🧠 选中文释义</b>
        <span className="muted">这个词标过「不认识」；先选对释义，再评分</span>
      </div>
      <div className="drill-body">
        <div className="study-word">
          {card.word}
          {onSpeak && (
            <button className="speak" onClick={() => onSpeak(card.word)} title="朗读" aria-label="朗读">
              🔊
            </button>
          )}
        </div>
        <div className="quiz-options">
          {options.map((o, i) => (
            <button
              key={o.text}
              className={`${i === wrongPick ? 'wrong-choice ' : ''}${i === focus ? 'focused' : ''}`}
              onClick={() => pick(o, i)}
              title={`按 ${i + 1} 选择`}
            >
              <kbd>{i + 1}</kbd> {o.text}
            </button>
          ))}
        </div>
        {wrongPick != null && <div className="study-result bad">✘ 不对，再来一次</div>}
        <div className="muted drill-keys">1–4 选择 · A / D 切换 · 回车确认</div>
      </div>
    </div>
  )
}

const STEP_LABEL: Record<DrillStep['kind'], string> = {
  spell: '拼写',
  meaning: '选词义',
  usage: '写搭配',
}

/** 超时「强制锤炼」/ 重学卡：拼写 → 选词义 → 写搭配，全过才解锁评分。 */
export default function DrillBoard({
  card,
  items,
  onSpeak,
  onDone,
  onSpellMiss,
}: {
  card: VocabItem
  items: VocabItem[]
  onSpeak: (text: string) => void
  onDone: () => void
  /** 拼错：立即判为不认识（一次判定，不提供重试）。 */
  onSpellMiss: (typed: string) => void
}) {
  const steps = useMemo(() => buildSteps(card, items), [card, items])
  const [step, setStep] = useState(0)
  const [text, setText] = useState('')
  const [wrong, setWrong] = useState(false)
  // 换卡重置
  useEffect(() => {
    setStep(0)
    setText('')
    setWrong(false)
  }, [card.id])

  const cur = steps[step]
  const total = steps.length

  const next = () => {
    setText('')
    setWrong(false)
    if (step + 1 >= total) onDone()
    else setStep(step + 1)
  }

  const submit = () => {
    if (!cur) return
    if (cur.kind === 'spell') {
      // 拼写只判一次：对 → 下一步；错 → 外层直接判「不认识」并重排，
      // 不再把输入框留着让人反复试（那会退化成抄写）。
      if (norm(text) === norm(card.word)) next()
      else onSpellMiss(text)
    } else if (cur.kind === 'usage') {
      const ok = collocationsOf(card).some((u) => {
        const n = norm(stripPunct(u))
        return n.length >= 3 && (norm(text) === n || norm(text).includes(n))
      })
      if (ok) next()
      else setWrong(true)
    }
  }

  if (!cur) {
    // 没有任何可锤炼步骤：直接放行
    return (
      <div className="drill">
        <div className="muted">这个词没有可用于锤炼的数据，直接评分吧。</div>
        <button className="primary" onClick={onDone}>
          继续
        </button>
      </div>
    )
  }

  return (
    <div className="drill">
      <div className="drill-head">
        <b>⛓ 强制锤炼</b>
        <span className="muted">
          {step + 1}/{total} · {STEP_LABEL[cur.kind]}
        </span>
        <span className="muted">全过才能评分（时间越长=越难记）</span>
      </div>

      {cur.kind === 'spell' && (
        <div className="drill-body">
          <div className="study-meaning">
            {normalizePos(card.partOfSpeech) && <span className="cell-pos">{normalizePos(card.partOfSpeech)} </span>}
            {displayMeaning(card) || '（无释义）'}
          </div>
          <input
            className="study-input"
            autoFocus
            placeholder="拼出这个英文单词"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
          />
        </div>
      )}

      {cur.kind === 'meaning' && <MeaningQuiz card={card} items={items} onSpeak={onSpeak} onPass={next} />}

      {cur.kind === 'usage' && (
        <div className="drill-body">
          <div className="study-word">
            {card.word}
            <button className="speak" onClick={() => onSpeak(card.word)} title="朗读" aria-label="朗读">
              🔊
            </button>
          </div>
          <input
            className="study-input"
            autoFocus
            placeholder="写出它的一个搭配 / 用法"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
          />
          {wrong && collocationsOf(card).length > 0 && (
            <div className="muted">参考：{collocationsOf(card).join('；')}</div>
          )}
        </div>
      )}

      {wrong && <div className="study-result bad">✘ 不对，再来一次</div>}
      {cur.kind !== 'meaning' && (
        <button className="primary" onClick={submit}>
          提交（回车）
        </button>
      )}
    </div>
  )
}

