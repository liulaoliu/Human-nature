import { useEffect, useRef } from 'react'
import type { VocabItem } from '../../types/document'
import type { StudyDeck } from '../../core/entryKind'
import {
  cleanGloss,
  displayMeaning,
  isPriority,
  normalizePos,
  review,
  spellingMatches,
  vocabCardBlocks,
  type ReviewGrade,
  type StudyMode,
} from '../../core/vocab'
import { fmtDue, fmtInterval } from '../format'
import type { StudyDraft } from '../hooks/useStudyCardEdit'
import type { StudyScope } from '../hooks/useStudyPool'
import VocabBlocks from './VocabBlocks'
import DrillBoard, { MeaningQuiz, type MeaningReveal } from './StudyDrill'
import StudyEditForm from './StudyEditForm'
import StudyRoundDone from './StudyRoundDone'
import StudySpellingRound from './StudySpellingRound'
import type { SpellingRoundMiss } from '../hooks/useStudySpellingRound'
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
  /** 当前卡正在重学（拼错 / 记住过又忘）。 */
  relearning: boolean
  /** 拼写错误的判定提示；非空时只显示这张「判为不认识」的卡。 */
  spellMiss: { input: string; word: string; meaning: string | null; requeued: boolean } | null
  /** 组末拼写测试（学习模式每组结束）：非空时整页显示它，`card` 已换成测试里的当前词。 */
  roundTest: { index: number; total: number } | null
  roundMiss: SpellingRoundMiss | null
  roundInput: string
  /** 判定提示期间锁住导航（结束 / 上一个 / 下一个）。 */
  navLocked: boolean
  /** 学习模式每组多少词（0 = 跟随范围：本篇 = 全部）。 */
  groupSize: number
  onGroupSizeChange: (n: number) => void
  /** 超过 drillAfter 秒未评分 → 强制锤炼（拼写/选义/搭配/听写），完成后才能评分。 */
  drillOn: boolean
  /** 标过「不认识」的词在复习 / 加练时先选中文释义（规则在 core/vocab/review）。 */
  meaningGate: boolean
  /** 学习模式：这一卡正在过「4 条中文释义」这一关（判完才进单词卡）。 */
  learnPhase: boolean
  /** 学习模式揭示答案后的高亮（正确项浅绿 / 选错项浅红；auto = 停留后自动进卡）。 */
  learnReveal: MeaningReveal | null
  /** 学习模式：这一卡已判过，停在单词卡等「下一词」（不再评分）。 */
  learnGraded: boolean
  /** 复习模式：三键直接可点（看见单词就能判，不用先翻面）。 */
  reviewKeys: boolean
  /** 复习模式：模糊待定中（卡片已摊开，等「下一词」/「记错了」）。 */
  reviewFuzzy: boolean
  /** 复习模式：已判过并停卡（忘记 / 记错了），等「下一词」。 */
  reviewGraded: boolean
  /** 刚过释义关却点了「忘记了」：等用户确认按哪个排期（确认前不落库）。 */
  pendingForgot: boolean
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
  /** 「确实忘了」：确认按 again 落库（进入重学）。 */
  onConfirmForgot: () => void
  /** 「其实记得」：改按 hard 排期，不把进度清零。 */
  onSoftenForgot: () => void
  /** 返回重评（什么都不写）。 */
  onCancelForgot: () => void
  onBack: () => void
  onNext: () => void
  onMarkUnknown: () => void
  onDrillCleared: () => void
  onMeaningCleared: () => void
  onRoundInputChange: (v: string) => void
  onRoundCheck: () => void
  /** 学习模式「看答案」：判不认识并高亮正确项。 */
  onLearnReveal: () => void
  /** 学习模式选了某一项：判定 + 写库（选错会停在高亮页等「继续」）。 */
  onLearnPick: (index: number, correct: boolean) => void
  /** 打断「看答案」的停留，或选错后点「继续」：立刻进单词卡。 */
  onLearnContinue: () => void
  /** 复习模式：三键之一（认识 / 模糊 / 忘记了）。 */
  onReviewAnswer: (grade: ReviewGrade) => void
  /** 复习模式：模糊摊卡后的出口——「下一词」（认下模糊）/「记错了」（改成不认识）。 */
  onReviewChoice: (choice: 'next' | 'missed') => void
  /** 拼错后确认「判为不认识」，继续下一张（这个词已重排到队尾）。 */
  onAckSpellMiss: () => void
  /** 锤炼里拼错：立即判为不认识（不提供第二次输入）。 */
  onSpellMiss: (typed: string) => void
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
  learnPhase,
  learnReveal,
  learnGraded,
  reviewKeys,
  reviewFuzzy,
  reviewGraded,
  pendingForgot,
  relearning,
  spellMiss,
  roundTest,
  roundMiss,
  roundInput,
  navLocked,
  groupSize,
  onGroupSizeChange,
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
  onConfirmForgot,
  onSoftenForgot,
  onCancelForgot,
  onBack,
  onNext,
  onMarkUnknown,
  onDrillCleared,
  onMeaningCleared,
  onRoundInputChange,
  onRoundCheck,
  onLearnReveal,
  onLearnPick,
  onLearnContinue,
  onReviewAnswer,
  onReviewChoice,
  onAckSpellMiss,
  onSpellMiss,
  onRetryForgot,
  onRestart,
}: StudyPanelProps) {
  // 重学卡不直接考拼写：先看词、看释义，再进锤炼（否则「从头重学」变成又考一次）
  const spellingFront = spelling && !checked && !relearning
  const reviewMode = mode === 'review'
  /** 复习模式看见单词就能评分；其它模式仍要「翻面」或「判完拼写」。 */
  const canGrade = reviewMode ? reviewKeys : spelling ? checked : revealed
  const correct = card ? spellingMatches(input, card.word) : false
  /** 规则由 core 判断，这里只负责显示。 */
  const showMeaningGate = !!card && meaningGate
  /** 学习模式的「4 条释义」页：做题阶段 + 揭示答案后的停留，都停在这一页。 */
  const learnQuizOn = !!card && (learnPhase || !!learnReveal)

  // 自动朗读：每张卡（每个位置）读一次；拼写模式不读（会剧透），但重学卡要读
  const speakRef = useRef(onSpeak)
  speakRef.current = onSpeak
  const spokeKeyRef = useRef('')
  useEffect(() => {
    if (!card || (spelling && !relearning)) return
    const key = `${index}:${card.id}`
    if (spokeKeyRef.current === key) return
    spokeKeyRef.current = key
    speakRef.current(card.word)
  }, [index, card, spelling, relearning])

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
        navLocked={navLocked}
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
        groupSize={groupSize}
        onGroupSizeChange={onGroupSizeChange}
      />

      {roundTest && card ? (
        <StudySpellingRound
          card={card}
          index={roundTest.index}
          total={roundTest.total}
          input={roundInput}
          miss={roundMiss}
          onInputChange={onRoundInputChange}
          onCheck={onRoundCheck}
          onSpeak={onSpeak}
        />
      ) : spellMiss ? (
        <div className="study-card spell-miss">
          <div className="study-word">{spellMiss.word}</div>
          <div className="study-result bad">✘ 拼写错误：你写的是「{spellMiss.input || '（空）'}」</div>
          {spellMiss.meaning && <div className="study-meaning">{spellMiss.meaning}</div>}
          <div className="muted spell-miss-note">
            已判为「不认识」：这个词的复习进度已归零。
            {spellMiss.requeued
              ? '本轮稍后会从「看词 → 释义 → 拼写」重新学。'
              : '本轮已经练满 3 次，明天从「看词」开始重学。'}
            不能靠再输入一次蒙对，也不能直接跳过。
          </div>
          <button className="primary" autoFocus onClick={onAckSpellMiss}>
            确认，从头重学（稍后再出场）
          </button>
        </div>
      ) : card ? (
        <>
          {!drillOn && (learnQuizOn ? (
            <MeaningQuiz
              card={card}
              items={items}
              onSpeak={onSpeak}
              onPick={onLearnPick}
              onReveal={onLearnReveal}
              reveal={learnReveal}
            />
          ) : showMeaningGate ? (
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
          ))}

          {/* 超时未评分 → 强制锤炼 */}
          {drillOn ? (
            <DrillBoard card={card} items={items} onSpeak={onSpeak} onDone={onDrillCleared} onSpellMiss={onSpellMiss} />
          ) : learnQuizOn ? (
            // 选错后停在释义页：正确项浅绿、你选的那项浅红，点「继续」才进单词卡
            learnReveal && !learnReveal.auto ? (
              <div className="bar study-actions">
                <button className="primary" onClick={onLearnContinue}>
                  继续（看单词卡） <kbd>空格</kbd>
                </button>
              </div>
            ) : null
          ) : learnGraded && mode === 'learn' ? (
            // 学习模式判完了：只等「下一词」，不再显示三档评分（避免二次评分）
            <div className="bar study-actions">
              <button className="primary" onClick={onNext}>
                下一词 <kbd>空格</kbd>
              </button>
              {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
            </div>
          ) : reviewFuzzy ? (
            // 复习模式判了「模糊」：先摊开卡看释义，再决定是认下模糊还是其实不认识
            <div className="bar study-actions">
              <button className="primary" onClick={() => onReviewChoice('next')}>
                下一词 <kbd>空格</kbd>
              </button>
              <button className="danger" onClick={() => onReviewChoice('missed')}>
                记错了 · 其实不认识 <kbd>M</kbd>
              </button>
              <span className="muted">看过释义才想起来不认识？点「记错了」，按忘记重排</span>
            </div>
          ) : reviewGraded ? (
            // 复习模式已判「忘记了 / 记错了」：停在卡上看一眼答案，点「下一词」继续
            <div className="bar study-actions">
              <button className="primary" onClick={onNext}>
                下一词 <kbd>空格</kbd>
              </button>
              {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
            </div>
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

              {pendingForgot ? (
                <div className="forgot-confirm">
                  <div className="muted">你刚选对了释义，却又点了「忘记了」—— 按哪个排期？</div>
                  <div className="bar study-actions">
                    <button className="danger" onClick={onConfirmForgot}>
                      确实忘了 · 从头重学
                    </button>
                    <button className="primary" onClick={onSoftenForgot}>
                      其实记得 · 按模糊（{fmtInterval(review(card.reviewState, 'hard').interval)}）
                    </button>
                    <button onClick={onCancelForgot}>返回重评</button>
                  </div>
                </div>
              ) : canGrade ? (
                <>
                  {!reviewMode && (
                    <div className="muted grade-preview">
                      预计下次：认识 {fmtInterval(review(card.reviewState, 'good').interval)} · 模糊{' '}
                      {fmtInterval(review(card.reviewState, 'hard').interval)} · 忘记了{' '}
                      {fmtInterval(review(card.reviewState, 'again').interval)}
                    </div>
                  )}
                  <div className="bar study-actions">
                    <button className="primary" onClick={() => (reviewMode ? onReviewAnswer('good') : onGrade('good'))}>
                      认识 <kbd>1</kbd>
                    </button>
                    <button onClick={() => (reviewMode ? onReviewAnswer('hard') : onGrade('hard'))}>
                      模糊 <kbd>2</kbd>
                    </button>
                    <button onClick={() => (reviewMode ? onReviewAnswer('again') : onGrade('again'))}>
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
