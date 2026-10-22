import { useEffect, useRef } from 'react'
import type { VocabItem } from '../../types/document'
import { normalizePos } from '../../core/vocab'
import type { SpellingRoundMiss } from '../hooks/useStudySpellingRound'

export interface StudySpellingRoundProps {
  card: VocabItem
  /** 组内进度（1 起） */
  index: number
  total: number
  input: string
  /** 拼错的卡：显示原文 + 你写的；重打对才放行。 */
  miss: SpellingRoundMiss | null
  onInputChange: (v: string) => void
  onCheck: () => void
  onSpeak: (text: string) => void
}

/** 组末拼写测试（学习模式每组结束）：本组学了多少就拼多少，不封顶。 */
export default function StudySpellingRound({
  card,
  index,
  total,
  input,
  miss,
  onInputChange,
  onCheck,
  onSpeak,
}: StudySpellingRoundProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [card.id])

  /** 原文只在「还没有开始重新输入」时显示：一打字就消失，逼你凭记忆打完。 */
  const showAnswer = !!miss && input.trim() === ''

  return (
    <div className="study-card spelling-round">
      <div className="drill-head">
        <b>⌨ 组末拼写</b>
        <span className="muted">
          {index + 1}/{total} · 本组全部过一遍，认识且拼对才算记住
        </span>
      </div>
      <div className="study-prompt">
        <div className="study-meaning">
          {normalizePos(card.partOfSpeech) && <span className="cell-pos">{normalizePos(card.partOfSpeech)} </span>}
          {card.meaning || '（无释义）'}
          <button
            className="speak"
            onClick={() => onSpeak(card.word)}
            title="朗读释义对应的单词（拼错了才会自动给你看）"
            aria-label="朗读"
          >
            🔊
          </button>
        </div>

        {miss ? (
          <>
            <div className="study-result bad">✘ 拼写错误：你写的是「{miss.typed || '（空）'}」</div>
            {showAnswer && <div className="spelling-answer">{miss.word}</div>}
            {miss.meaning && <div className="muted">释义：{miss.meaning}</div>}
            <div className="muted">
              已判为「不认识」。照着再拼一遍加深印象——一开始输入，原文就会消失。
            </div>
          </>
        ) : null}

        <input
          ref={inputRef}
          className="study-input"
          autoFocus
          placeholder={miss ? '凭记忆再拼一遍，回车检查' : '拼出这个英文单词，回车检查'}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onCheck()
            }
          }}
        />
      </div>
      <button className="primary" onClick={onCheck}>
        {miss ? '再检查（回车）' : '检查（回车）'}
      </button>
    </div>
  )
}
