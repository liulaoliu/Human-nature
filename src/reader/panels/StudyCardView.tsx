import type { VocabItem } from '../../types/document'
import {
  cleanGloss,
  displayMeaning,
  isPriority,
  normalizePos,
  spellingMatches,
  vocabCardBlocks,
  type StudyMode,
} from '../../core/vocab'
import { fmtDue } from '../format'
import VocabBlocks from './VocabBlocks'
import { MeaningQuiz, type MeaningReveal } from './StudyDrill'

export interface StudyCardViewProps {
  card: VocabItem
  items: VocabItem[]
  mode: StudyMode
  spelling: boolean
  revealed: boolean
  checked: boolean
  input: string
  /** 当前卡正在重学：不直接考拼写，先看词、看释义。 */
  relearning: boolean
  /** 学习模式的「4 条释义」页（做题中）。 */
  learnPhase: boolean
  /** 学习模式揭示答案后的高亮。 */
  learnReveal: MeaningReveal | null
  /** 学习模式：这一卡已判过，不再给「不认识」二次写库。 */
  learnGraded: boolean
  /** 复习模式：看见单词就能判，点卡片不翻面。 */
  reviewKeys: boolean
  /** 标过「不认识」的复习 / 加练卡：先选中文释义。 */
  meaningGate: boolean
  /** 卡片热度（0–4，越久越红）。 */
  heat: number

  onSpeak: (word: string) => void
  onReveal: () => void
  onInputChange: (value: string) => void
  onCheckSpelling: () => void
  onMarkUnknown: () => void
  onLearnPick: (index: number, correct: boolean) => void
  onLearnReveal: () => void
  onMeaningCleared: () => void
}

/**
 * 卡片正文：学习释义关 / 释义门禁 / 拼写正面 / 单词背面。
 *
 * 从 `StudyPanel` 拆出来的原因：这里只回答「这张卡长什么样」，
 * 不参与队列推进、评分、组末拼写和面板布局。拆开后每条分支都能单独渲染测试。
 */
export default function StudyCardView({
  card,
  items,
  mode,
  spelling,
  revealed,
  checked,
  input,
  relearning,
  learnPhase,
  learnReveal,
  learnGraded,
  reviewKeys,
  meaningGate,
  heat,
  onSpeak,
  onReveal,
  onInputChange,
  onCheckSpelling,
  onMarkUnknown,
  onLearnPick,
  onLearnReveal,
  onMeaningCleared,
}: StudyCardViewProps) {
  const reviewMode = mode === 'review'
  // 重学卡不直接考拼写：先看词、看释义，再进锤炼（否则「从头重学」变成又考一次）
  const spellingFront = spelling && !checked && !relearning
  const correct = spellingMatches(input, card.word)
  const learnQuizOn = learnPhase || !!learnReveal

  if (learnQuizOn) {
    return (
      <MeaningQuiz
        card={card}
        items={items}
        onSpeak={onSpeak}
        onPick={onLearnPick}
        onReveal={onLearnReveal}
        reveal={learnReveal}
      />
    )
  }

  if (meaningGate) {
    return (
      <MeaningQuiz
        card={card}
        items={items}
        onSpeak={onSpeak}
        onPass={() => {
          onMeaningCleared()
          onReveal()
        }}
      />
    )
  }

  return (
    <div className={'study-card heat-' + heat} onClick={spellingFront || reviewKeys ? undefined : onReveal}>
      {spellingFront ? (
        <div className="study-prompt">
          <div className="study-meaning">
            {normalizePos(card.partOfSpeech) && <span className="cell-pos">{normalizePos(card.partOfSpeech)} </span>}
            {displayMeaning(card) || '（无释义）'}
          </div>
          <input
            className="study-input"
            autoFocus
            placeholder="拼出这个英文单词，回车检查"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCheckSpelling()
              }
            }}
          />
        </div>
      ) : (
        <>
          <div className="study-word">
            {card.word}
            <button
              className="speak"
              onClick={(e) => {
                e.stopPropagation()
                onSpeak(card.word)
              }}
              title="朗读"
              aria-label="朗读"
            >
              🔊
            </button>
          </div>
          {card.phonetic && (
            <div
              className="study-phon"
              title="点读发音"
              onClick={(e) => {
                e.stopPropagation()
                onSpeak(card.word)
              }}
            >
              {card.phonetic}
            </div>
          )}
          {spelling && checked && (
            <div className={'study-result ' + (correct ? 'ok' : 'bad')}>
              {correct ? '✔ 正确' : `✘ 你写的是「${input || '（空）'}」`}
            </div>
          )}
          {(revealed || (spelling && checked)) && (
            <div className="study-back">
              <div className="study-meaning">
                {normalizePos(card.partOfSpeech) && <span className="cell-pos">{normalizePos(card.partOfSpeech)} </span>}
                {displayMeaning(card) || '（无释义）'}
                {card.grammarMarks?.length ? (
                  <span className="grammar-marks">
                    {card.grammarMarks.map((m) => (
                      <span className="gmark" key={m}>
                        {m}
                      </span>
                    ))}
                  </span>
                ) : null}
                {/* 学习模式已经判过 / 复习模式有「记错了」：再给「不认识」等于二次写库 */}
                {!(mode === 'learn' && learnGraded) && !reviewMode && (
                  <button
                    className="unknown-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onMarkUnknown()
                    }}
                    title="我不认识这个词（标为全新词，稍后重练）· 快捷键 U"
                  >
                    不认识 <kbd>U</kbd>
                  </button>
                )}
              </div>
              {cleanGloss(card.definition) && (
                <div className="study-def">
                  <span className="study-def-label">英英释义</span>
                  {cleanGloss(card.definition)}
                </div>
              )}
              <VocabBlocks className="study-blocks" blocks={vocabCardBlocks(card, { maxExamples: 3 })} />
              <div className="muted study-srs">
                复习 {card.reviewState.repetitions} 次
                {(card.reviewState.lapses ?? 0) > 0 ? ` · 忘记 ${card.reviewState.lapses} 次` : ''}
                {card.reviewState.due ? ` · 下次 ${fmtDue(card.reviewState.due)}` : ' · 还没排期'}
                {isPriority(card) ? ' · 🔥 优先重练' : ''}
                {relearning ? ' · ♻️ 重学中' : ''}
                {card.tags.includes('不认识') ? ' · 🆕 标为不认识' : ''}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
