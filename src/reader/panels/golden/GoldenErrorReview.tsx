import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  isWritingErrorAnswerCorrect,
  type WritingErrorCard,
} from '../../../core/writingErrorReview'
import {
  unpracticedWritingErrorCards,
  type WritingErrorProgress,
} from '../../../core/writingErrorProgress'
import { WRITING_RULE_LABEL } from '../../../core/writingErrorRules'
import type { ActivityCat } from '../../../core/activity'
import type { WritingRecord } from '../../../core/writing'
import ErrorFixAi from './ErrorFixAi'

export interface GoldenErrorReviewProps {
  cards: WritingErrorCard[]
  /** v11 复习状态；「练过的不练」用它判断 reviews / lastAt */
  writingErrorProgress?: readonly WritingErrorProgress[]
  /** 错因订正的 AI 批改记录；不传就隐藏 AI 批改按钮 */
  writingHistory?: WritingRecord[]
  setWritingHistory?: Dispatch<SetStateAction<WritingRecord[]>>
  flash?: (message: string) => void
  recordActivity?: (cat: ActivityCat, n?: number) => void
  onAnswer: (card: WritingErrorCard, correct: boolean) => void
  onPause?: (card: WritingErrorCard) => void
  onBack: () => void
}

function HighlightedSentence({ card }: { card: WritingErrorCard }) {
  const { text, original } = card
  if (!original || !text.includes(original)) {
    return (
      <div className="golden-recall-zh">
        {original ? (
          <>
            原句里的 <b className="bad">{original}</b> 有错；请写出改正后的片段。
          </>
        ) : (
          '这里缺一个成分；请写出应该补上的英文。'
        )}
        <div className="muted">{text}</div>
      </div>
    )
  }
  const at = text.indexOf(original)
  return (
    <div className="golden-recall-zh">
      {text.slice(0, at)}
      <mark>{original}</mark>
      {text.slice(at + original.length)}
    </div>
  )
}

export default function GoldenErrorReview({
  cards,
  writingErrorProgress,
  writingHistory,
  setWritingHistory,
  flash,
  recordActivity,
  onAnswer,
  onPause,
  onBack,
}: GoldenErrorReviewProps) {
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [result, setResult] = useState<{
    correct: boolean
    revealed: boolean
    pending?: boolean
  } | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [skipPracticed, setSkipPracticed] = useState(false)
  /**
   * 进入复习时给进度拍个快照。
   *
   * 不能直接跟着 live progress 过滤：本轮刚答完一张，reviews 立刻 +1，
   * 如果实时重算，卡会当场从队列里消失，结果块和下一张就错位了。
   */
  const [progressSnapshot] = useState(() => writingErrorProgress ?? [])
  const resultRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const visibleCards = useMemo(
    () =>
      skipPracticed
        ? unpracticedWritingErrorCards(cards, progressSnapshot)
        : cards,
    [cards, skipPracticed, progressSnapshot],
  )
  const card = visibleCards[index]
  const longAnswer =
    !!card &&
    (card.suggestion.length > 60 || card.suggestion.trim().split(/\s+/).filter(Boolean).length > 8)
  const skippedCount = cards.length - visibleCards.length

  const next = () => {
    setIndex((i) => i + 1)
    setInput('')
    setResult(null)
  }

  // 判完把焦点放到结果块：Enter 直接下一个，鼠标不用来回找按钮。
  useEffect(() => {
    if (result && !result.pending) resultRef.current?.focus()
  }, [result])

  // 下一张卡复用同一个 input；autoFocus 不会再次触发，必须自己把焦点送回去。
  useEffect(() => {
    if (!result) inputRef.current?.focus()
  }, [index, result])

  const toggleSkip = (checked: boolean) => {
    setSkipPracticed(checked)
    setIndex(0)
    setInput('')
    setResult(null)
    setCorrectCount(0)
  }

  const skipToggle = (
    <label className="check-inline" title="只跳过已经复习过的卡（有复习记录）">
      <input
        type="checkbox"
        checked={skipPracticed}
        onChange={(e) => toggleSkip(e.target.checked)}
      />
      练过的不练
    </label>
  )

  if (!cards.length) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={onBack}>← 返回错因复盘</button>
          <b>错因复习</b>
        </div>
        <div className="golden-summary">今天没有到期的错因卡。去练几句仿写，新的错因会进队列。</div>
      </div>
    )
  }

  if (!visibleCards.length) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={onBack}>← 返回错因复盘</button>
          <b>错因复习</b>
          {skipToggle}
        </div>
        <div className="golden-summary">
          这 {cards.length} 张都练过；取消「练过的不练」可以再练，或等下次到期。
        </div>
      </div>
    )
  }

  if (!card) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={onBack}>← 返回错因复盘</button>
          <b>错因复习</b>
          {skipToggle}
          <span className="muted">
            本轮答对 {correctCount} / {visibleCards.length} 张
          </span>
        </div>
        <div className="golden-summary">
          本轮完成：答对 {correctCount} / {visibleCards.length} 张。
          <div className="bar golden-plan-bar">
            <button
              onClick={() => {
                setIndex(0)
                setInput('')
                setResult(null)
                setCorrectCount(0)
              }}
            >
              再来一轮
            </button>
            <button onClick={onBack}>回到错因复盘</button>
          </div>
        </div>
      </div>
    )
  }

  const submit = () => {
    if (result || !input.trim()) return
    const correct = isWritingErrorAnswerCorrect(input, card)
    setResult({ correct, revealed: false })
    if (correct) setCorrectCount((n) => n + 1)
    onAnswer(card, correct)
  }

  const reveal = () => {
    if (result) return
    if (longAnswer) {
      // 长答案（整句/长搭配）不逼用户逐字打；先看答案，再自评。
      setResult({ correct: false, revealed: true, pending: true })
      return
    }
    setResult({ correct: false, revealed: true })
    onAnswer(card, false)
  }

  const selfGrade = (correct: boolean) => {
    if (!result?.pending) return
    setResult({ correct, revealed: true })
    if (correct) setCorrectCount((n) => n + 1)
    onAnswer(card, correct)
  }

  const pause = () => {
    if (result) return
    onPause?.(card)
    next()
  }

  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 返回错因复盘</button>
        <b>错因复习</b>
        {skipToggle}
        {skippedCount > 0 && <span className="muted">已跳过 {skippedCount} 张练过的</span>}
        <span className="muted">
          第 {index + 1} / {visibleCards.length} 张 · 本轮答对 {correctCount}
        </span>
      </div>

      <div className="golden-errors-row">
        <div className="golden-errors-head">
          <span className="golden-chip">{WRITING_RULE_LABEL[card.rule]}</span>
          <span className="muted">只填改正后的片段，不用重写整句</span>
        </div>
        <HighlightedSentence card={card} />
        <form
          className="golden-lp-head"
          onSubmit={(e) => {
            e.preventDefault()
            if (result) next()
            else submit()
          }}
        >
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="改正后的英文…"
            disabled={!!result}
            aria-label="错因答案"
          />
          {!result && (
            <>
              <button type="submit" className="primary" disabled={!input.trim()}>
                检查
              </button>
              <button type="button" onClick={reveal}>
                不会，看答案
              </button>
              {onPause && (
                <button type="button" onClick={pause}>
                  以后不再考
                </button>
              )}
            </>
          )}
          {result && !result.pending && (
            <button type="submit" className="primary">
              {index + 1 >= visibleCards.length ? '看本轮结果' : '下一个'}
            </button>
          )}
        </form>
        {result && (
          <div
            ref={resultRef}
            className={`golden-recall-result ${result.correct ? 'good' : 'bad'}`}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
              // 只接结果块自己的焦点；按钮 / 粘贴框 / 链接上的 Enter 各干各的。
              if (e.target !== e.currentTarget) return
              e.preventDefault()
              if (!result.pending) next()
            }}
          >
            {result.pending
              ? '先看答案，按你刚才的思路自评：'
              : result.correct
                ? '✅ 对了'
                : result.revealed
                  ? '先看答案，算一次错'
                  : '❌ 还不对'}
            <div>
              正确写法：<b>{card.suggestion}</b>
            </div>
            {card.reason && <div className="muted">{card.reason}</div>}
            {result.pending && (
              <div className="bar golden-plan-bar">
                <button type="button" className="primary" onClick={() => selfGrade(true)}>
                  我写对了
                </button>
                <button type="button" onClick={() => selfGrade(false)}>
                  还是不会
                </button>
              </div>
            )}
          </div>
        )}
        {result && setWritingHistory && flash && recordActivity && (
          <ErrorFixAi
            card={card}
            answer={input}
            articleTitle={card.articleTitle}
            writingHistory={writingHistory ?? []}
            setWritingHistory={setWritingHistory}
            flash={flash}
            recordActivity={recordActivity}
          />
        )}
      </div>
    </div>
  )
}
