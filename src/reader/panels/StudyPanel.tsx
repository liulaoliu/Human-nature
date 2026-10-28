import { useEffect, useRef } from 'react'
import type { StudyPanelModel } from './studyPanelModel'
import StudyActions from './StudyActions'
import StudyCardTools from './StudyCardTools'
import StudyCardView from './StudyCardView'
import StudyRoundDone from './StudyRoundDone'
import StudySpellMiss from './StudySpellMiss'
import StudySpellingRound from './StudySpellingRound'
import StudyToolbar from './StudyToolbar'

export interface StudyPanelProps {
  model: StudyPanelModel
}

/**
 * 背单词 / 快刷主界面：只做布局与分支选择。
 *
 * 数据按「谁一起变」分成六组（见 `studyPanelModel.ts`），由 `StudyPanelFromModel`
 * 从会话 hook 翻译过来；本组件不读 hook、不读存储，也不写业务规则。
 */
export default function StudyPanel({ model }: StudyPanelProps) {
  const { round, settings, cardUi, modes, edit, actions } = model
  const {
    card,
    items,
    queueLength,
    roundTotal,
    extraCount,
    index,
    mode,
    deck,
    scope,
    counts,
    cardSeconds,
    liveSeconds,
    grandSeconds,
    forgotCount,
    canRetryForgot,
  } = round
  const { spelling, groupSize, drillAfter, newLimit, newToday, newCount, dueCount } = settings
  const { revealed, checked, input } = cardUi
  const {
    drillReason,
    meaningGate,
    learnPhase,
    learnReveal,
    learnGraded,
    reviewKeys,
    reviewFuzzy,
    reviewGraded,
    relearning,
    spellMiss,
    roundTest,
    roundMiss,
    roundInput,
    navLocked,
  } = modes
  const { editOpen, draft, delArmed, gradeInfo } = edit
  const {
    onClose,
    onExam,
    onSwitchMode,
    onSwitchDeck,
    onSwitchScope,
    onStartArticleAll,
    onNewLimitChange,
    onDrillAfterChange,
    onSpellingChange,
    onGroupSizeChange,
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
  } = actions

  const reviewMode = mode === 'review'
  /** 复习模式看见单词就能评分；其它模式仍要「翻面」或「判完拼写」。 */
  const canGrade = reviewMode ? reviewKeys : spelling ? checked : revealed
  const spellingFront = spelling && !checked && !relearning
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
    // 左侧一列放工具条、右侧一列放卡片与评分按钮：卡片不会被工具条挤到折叠线以下
    // editing：编辑表单很高，右栏临时改成可滚（卡片让出高度），否则保存/取消被裁在屏幕外
    <div className={'study study-split' + (editOpen ? ' editing' : '')}>
      <aside className="study-side">
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
      </aside>

      <div className="study-main">
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
          <StudySpellMiss miss={spellMiss} onAck={onAckSpellMiss} />
        ) : card ? (
          <>
            {!drillReason && (
              <StudyCardView
                card={card}
                items={items}
                mode={mode}
                spelling={spelling}
                revealed={revealed}
                checked={checked}
                input={input}
                relearning={relearning}
                learnPhase={learnPhase}
                learnReveal={learnReveal}
                learnGraded={learnGraded}
                reviewKeys={reviewKeys}
                meaningGate={meaningGate}
                heat={heat}
                onSpeak={onSpeak}
                onReveal={onReveal}
                onInputChange={onInputChange}
                onCheckSpelling={onCheckSpelling}
                onMarkUnknown={onMarkUnknown}
                onLearnPick={onLearnPick}
                onLearnReveal={onLearnReveal}
                onMeaningCleared={onMeaningCleared}
              />
            )}

            {/* 卡内维护：改词形/释义、删误加的词。
                只要停在单词卡上就可用——判完等「下一词」、模糊待定、复习已判也都是在这张卡上。 */}
            {!drillReason && !learnQuizOn && !showMeaningGate && (
              <StudyCardTools
                card={card}
                delArmed={delArmed}
                gradeInfo={gradeInfo}
                editOpen={editOpen}
                draft={draft}
                onOpenEdit={onOpenEdit}
                onDelete={onDelete}
                onDraftChange={onDraftChange}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
              />
            )}

            {/* 超时未评分 / 重学卡要评分 → 强制锤炼 / 学习释义页 / 判完等下一词 / 复习三态 / 评分或翻面：
                这一整条状态机在 StudyActions 里，优先级与按钮组都在那儿排好了 */}
            <StudyActions
              card={card}
              items={items}
              mode={mode}
              drillReason={drillReason}
              learnQuizOn={learnQuizOn}
              learnReveal={learnReveal}
              learnGraded={learnGraded}
              reviewMode={reviewMode}
              reviewFuzzy={reviewFuzzy}
              reviewGraded={reviewGraded}
              showMeaningGate={showMeaningGate}
              canGrade={canGrade}
              spellingFront={spellingFront}
              gradeInfo={gradeInfo}
              onSpeak={onSpeak}
              onDrillCleared={onDrillCleared}
              onSpellMiss={onSpellMiss}
              onLearnContinue={onLearnContinue}
              onNext={onNext}
              onReviewChoice={onReviewChoice}
              onGrade={onGrade}
              onReviewAnswer={onReviewAnswer}
              onCheckSpelling={onCheckSpelling}
              onReveal={onReveal}
            />
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
    </div>
  )
}
