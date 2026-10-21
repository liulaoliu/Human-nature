import { useEffect, useRef } from 'react'
import type { VocabItem } from '../../types/document'
import type { StudyDeck } from '../../core/entryKind'
import {
  cleanGloss,
  displayMeaning,
  isPriority,
  normalizePos,
  review,
  vocabCardBlocks,
  type ReviewGrade,
  type StudyMode,
} from '../../core/vocab'
import { fmtDue, fmtInterval } from '../format'
import type { StudyDraft } from '../hooks/useStudyCardEdit'
import type { StudyScope } from '../hooks/useStudyPool'
import VocabBlocks from './VocabBlocks'
import DrillBoard, { MeaningQuiz } from './StudyDrill'
import StudyEditForm from './StudyEditForm'
import StudyRoundDone from './StudyRoundDone'
import StudyToolbar from './StudyToolbar'

export type { StudyDraft, StudyScope }

export interface StudyPanelProps {
  card: VocabItem | null
  /** 整个词库（「强制锤炼」里「选词义」的干扰项来源）。 */
  items: VocabItem[]
  queueLength: number
  /** 本轮总数（进度分母，开始时冻结；忘记/模糊加练不改动它）。 */
  roundTotal: number
  /** 忘记/模糊触发的加练次数（单独计数，不计入分母）。 */
  extraCount: number
  index: number
  mode: StudyMode
  /** 当前牌组：普通单词 / 搭配（词组·习语） */
  deck: StudyDeck
  scope: StudyScope
  spelling: boolean
  revealed: boolean
  checked: boolean
  input: string
  counts: { know: number; fuzzy: number; forgot: number }
  cardSeconds: number
  liveSeconds: number
  grandSeconds: number
  newCount: number
  dueCount: number
  newLimit: number
  newToday: number
  gradeInfo: string
  editOpen: boolean
  draft: StudyDraft | null
  delArmed: boolean
  forgotCount: number
  /** 本轮还能不能点「重练忘记的」（每轮只发起一次；规则在 core/vocab/extra）。 */
  canRetryForgot: boolean
  /** 超过 drillAfter 秒未评分 → 强制锤炼（拼写/选义/搭配/听写），完成后才能评分。 */
  drillOn: boolean
  /** 标过「不认识」的词在复习 / 加练时先选中文释义（规则在 core/vocab/review）。 */
  meaningGate: boolean
  drillAfter: number

  onClose: () => void
  onExam: () => void
  onSwitchMode: (mode: StudyMode) => void
  onSwitchDeck: (deck: StudyDeck) => void
  onSwitchScope: (scope: StudyScope) => void
  onStartArticleAll: () => void
  onNewLimitChange: (n: number) => void
  onDrillAfterChange: (n: number) => void
  onSpellingChange: (on: boolean) => void
  onReveal: () => void
  onInputChange: (value: string) => void
  onCheckSpelling: () => void
  onSpeak: (word: string) => void
  onOpenEdit: () => void
  onDelete: () => void
  onDraftChange: (draft: StudyDraft) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onGrade: (grade: ReviewGrade) => void
  onBack: () => void
  onNext: () => void
  onMarkUnknown: () => void
  onDrillCleared: () => void
  onMeaningCleared: () => void
  onRetryForgot: () => void
  onRestart: () => void
}

/** 背单词 / 快刷主界面：卡片、卡内维护、SRS 评分、超时锤炼、本轮小结。逻辑在外层。 */
export default function StudyPanel({
  card,
  items,
  queueLength,
  roundTotal,
  extraCount,
  index,
  mode,
  deck,
  scope,
  spelling,
  revealed,
  checked,
  input,
  counts,
  cardSeconds,
  liveSeconds,
  grandSeconds,
  newCount,
  dueCount,
  newLimit,
  newToday,
  gradeInfo,
  editOpen,
  draft,
  delArmed,
  forgotCount,
  canRetryForgot,
  drillOn,
  meaningGate,
  drillAfter,
  onClose,
  onExam,
  onSwitchMode,
  onSwitchDeck,
  onSwitchScope,
  onStartArticleAll,
  onNewLimitChange,
  onDrillAfterChange,
  onSpellingChange,
  onReveal,
  onInputChange,
  onCheckSpelling,
  onSpeak,
  onOpenEdit,
  onDelete,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onGrade,
  onBack,
  onNext,
  onMarkUnknown,
  onDrillCleared,
  onMeaningCleared,
  onRetryForgot,
  onRestart,
}: StudyPanelProps) {
  const spellingFront = spelling && !checked
  const canGrade = spelling ? checked : revealed
  const correct = card ? input.trim().toLowerCase() === card.word.trim().toLowerCase() : false
  /** 规则由 core 判断，这里只负责显示。 */
  const showMeaningGate = !!card && meaningGate

  // 自动朗读：每张卡（每个位置）读一次；拼写模式不读（会剧透）
  const speakRef = useRef(onSpeak)
  speakRef.current = onSpeak
  const spokeKeyRef = useRef('')
  useEffect(() => {
    if (!card || spelling) return
    const key = `${index}:${card.id}`
    if (spokeKeyRef.current === key) return
    spokeKeyRef.current = key
    speakRef.current(card.word)
  }, [index, card, spelling])

  // 卡片颜色随时间变化（越久越"烫"）
  const heat =
    cardSeconds >= 90 ? 4 : cardSeconds >= drillAfter && drillAfter > 0 ? 3 : cardSeconds >= 30 ? 2 : cardSeconds >= 12 ? 1 : 0

  return (
    <div className="study">
      <StudyToolbar
        index={index}
        queueLength={queueLength}
        roundTotal={roundTotal}
        extraCount={extraCount}
        mode={mode}
        deck={deck}
        scope={scope}
        newLimit={newLimit}
        newToday={newToday}
        dueCount={dueCount}
        newCount={newCount}
        spelling={spelling}
        drillAfter={drillAfter}
        cardSeconds={cardSeconds}
        liveSeconds={liveSeconds}
        grandSeconds={grandSeconds}
        heat={heat}
        onClose={onClose}
        onBack={onBack}
        onNext={onNext}
        onExam={onExam}
        onSwitchMode={onSwitchMode}
        onSwitchDeck={onSwitchDeck}
        onSwitchScope={onSwitchScope}
        onStartArticleAll={onStartArticleAll}
        onNewLimitChange={onNewLimitChange}
        onDrillAfterChange={onDrillAfterChange}
        onSpellingChange={onSpellingChange}
      />

      {card ? (
        <>
          {!drillOn && (showMeaningGate ? (
            <MeaningQuiz
              card={card}
              items={items}
              onSpeak={onSpeak}
              onPass={() => {
                onMeaningCleared()
                onReveal()
              }}
            />
          ) : (
          <div className={'study-card heat-' + heat} onClick={spellingFront ? undefined : onReveal}>
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
                      <button
                        className="unknown-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onMarkUnknown()
                        }}
                        title="我不认识这个词（标为全新词，稍后重练）"
                      >
                        不认识
                      </button>
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
                      {card.tags.includes('不认识') ? ' · 🆕 标为不认识' : ''}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          ))}

          {/* 超时未评分 → 强制锤炼 */}
          {drillOn ? (
            <DrillBoard card={card} items={items} onSpeak={onSpeak} onDone={onDrillCleared} />
          ) : showMeaningGate ? null : (
            <>
              {/* 卡内维护：改词形/释义、删误加的词 */}
              <div className="bar study-tools">
                <button onClick={onOpenEdit} title="改单词/音标/词性/释义/用法（会持久保存）">
                  ✎ 编辑
                </button>
                <button className={delArmed ? 'danger' : ''} onClick={onDelete} title="删除这个误加的词（两步确认）">
                  {delArmed ? '确认删除' : '删除'}
                </button>
                {(!card.meaning || card.usage.length === 0) && (
                  <button className="primary" onClick={onOpenEdit} title="补上释义 / 用法后，才能出「拼写 / 填空 / 听力」题">
                    ＋ 补全释义/用法
                  </button>
                )}
                {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
              </div>

              {editOpen && draft && (
                <StudyEditForm draft={draft} onDraftChange={onDraftChange} onSave={onSaveEdit} onCancel={onCancelEdit} />
              )}

              {canGrade ? (
                <>
                  <div className="muted grade-preview">
                    预计下次：认识 {fmtInterval(review(card.reviewState, 'good').interval)} · 模糊{' '}
                    {fmtInterval(review(card.reviewState, 'hard').interval)} · 忘记了{' '}
                    {fmtInterval(review(card.reviewState, 'again').interval)}
                  </div>
                  <div className="bar study-actions">
                    <button className="primary" onClick={() => onGrade('good')}>
                      认识 <kbd>1</kbd>
                    </button>
                    <button onClick={() => onGrade('hard')}>
                      模糊 <kbd>2</kbd>
                    </button>
                    <button onClick={() => onGrade('again')}>
                      忘记了 <kbd>3</kbd>
                    </button>
                  </div>
                </>
              ) : spellingFront ? (
                <button className="primary" onClick={onCheckSpelling}>
                  检查（回车）
                </button>
              ) : (
                <button className="primary" onClick={onReveal}>
                  显示释义（空格）
                </button>
              )}
            </>
          )}
        </>
      ) : (
        <StudyRoundDone
          counts={counts}
          liveSeconds={liveSeconds}
          forgotCount={forgotCount}
          canRetryForgot={canRetryForgot}
          mode={mode}
          onRetryForgot={onRetryForgot}
          onRestart={onRestart}
          onExam={onExam}
          onClose={onClose}
        />
      )}
    </div>
  )
}
