import type { VocabItem } from '../types/document'
import type { useStudySession } from './hooks/useStudySession'
import type { useQuizSession } from './hooks/useQuizSession'
import type { useQuickSession } from './hooks/useQuickSession'
import type { useDictation } from './hooks/useDictation'
import type { useListening } from './hooks/useListening'
import type { useWriting } from './hooks/useWriting'
import StudyPanel from './panels/StudyPanel'
import QuizSetupPanel from './panels/QuizSetupPanel'
import QuizPanel from './panels/QuizPanel'
import DrillWarmup from './panels/DrillWarmup'
import QuickPanel from './panels/QuickPanel'
import DictPanel from './panels/DictPanel'
import ListeningPanel from './panels/ListeningPanel'
import WritingPanel from './panels/WritingPanel'

type TtsState = 'idle' | 'loading' | 'playing'

export interface SessionHostProps {
  items: VocabItem[]
  speak: (text: string) => void
  resetSpeech: () => void
  ttsState: TtsState
  /** 听写播放：整句模式复用整句音频 + seek；填空直接播文本。 */
  playDictItem: (item: { text: string; src?: string; sw?: number; ew?: number }) => void
  study: {
    api: ReturnType<typeof useStudySession>
    /** 本会话累计时长 = 已落盘 + 未落盘。 */
    grandSeconds: number
    newLimit: number
    newToday: number
    onNewLimitChange: (n: number) => void
  }
  quiz: ReturnType<typeof useQuizSession>
  /** 文章级测验可出题数（由当前文章 + 题型算出，不属于会话状态）。 */
  quizArticleAvailable: number
  quick: ReturnType<typeof useQuickSession>
  dict: ReturnType<typeof useDictation>
  listening: {
    api: ReturnType<typeof useListening>
    transcript: string | null
    readingAll: boolean
    readMode: boolean
    onToggleRead: () => void
    onClose: () => void
  }
  writing: ReturnType<typeof useWriting>
}

/**
 * 会话面板路由：背词 / 考试 / 快刷 / 听写 / 听力 / 仿写。
 *
 * 这些面板的 props 几乎全由对应 hook 产出，之前铺在 `ReaderApp` 里做接线；
 * 现在统一在这里映射，`ReaderApp` 只传 hook 结果和少量外部回调。
 */
export default function SessionHost({
  items,
  speak,
  resetSpeech,
  ttsState,
  playDictItem,
  study,
  quiz,
  quizArticleAvailable,
  quick,
  dict,
  listening,
  writing,
}: SessionHostProps) {
  const quickCurrent =
    quick.queue && quick.index < quick.queue.length
      ? (items.find((it) => it.id === quick.queue![quick.index].id) ?? quick.queue[quick.index])
      : null

  return (
    <>
      {study.api.queue && (
        <StudyPanel
          card={study.api.card}
          items={items}
          queueLength={study.api.queue.length}
          roundTotal={study.api.roundTotal}
          extraCount={study.api.extraCount}
          index={study.api.index}
          mode={study.api.mode}
          deck={study.api.deck}
          scope={study.api.scope}
          spelling={study.api.spelling}
          revealed={study.api.revealed}
          checked={study.api.checked}
          input={study.api.input}
          counts={study.api.counts}
          cardSeconds={study.api.cardSeconds}
          liveSeconds={study.api.liveSeconds}
          grandSeconds={study.grandSeconds}
          newCount={study.api.newCount}
          dueCount={study.api.dueCount}
          newLimit={study.newLimit}
          newToday={study.newToday}
          gradeInfo={study.api.gradeInfo}
          editOpen={study.api.editOpen}
          draft={study.api.draft}
          delArmed={study.api.delArmed}
          forgotCount={study.api.forgotCount}
          canRetryForgot={study.api.canRetryForgot}
          drillOn={study.api.drillOn}
          meaningGate={study.api.meaningGate}
          learnPhase={study.api.learnPhase}
          learnReveal={study.api.learnReveal}
          learnGraded={study.api.learnGraded}
          reviewKeys={study.api.reviewKeys}
          reviewFuzzy={study.api.reviewFuzzy}
          reviewGraded={study.api.reviewGraded}
          roundTest={study.api.roundTest}
          roundMiss={study.api.roundMiss}
          roundInput={study.api.roundInput}
          onRoundInputChange={study.api.onRoundInputChange}
          onRoundCheck={study.api.onRoundCheck}
          groupSize={study.api.groupSize}
          onGroupSizeChange={study.api.setGroupSize}
          pendingForgot={study.api.pendingForgot}
          relearning={study.api.relearning}
          spellMiss={study.api.spellMiss}
          navLocked={study.api.navLocked}
          drillAfter={study.api.drillAfter}
          onClose={study.api.close}
          onExam={() => {
            study.api.close()
            quiz.setResults([])
            quiz.setSetupOpen(true)
          }}
          onSwitchMode={study.api.switchMode}
          onSwitchDeck={study.api.switchDeck}
          onSwitchScope={study.api.switchScope}
          onStartArticleAll={study.api.startArticleAll}
          onNewLimitChange={study.onNewLimitChange}
          onDrillAfterChange={study.api.setDrillAfter}
          onSpellingChange={(on) => {
            study.api.setSpelling(on)
            study.api.setChecked(false)
            study.api.setInput('')
          }}
          onReveal={() => study.api.setRevealed(true)}
          onInputChange={study.api.setInput}
          onCheckSpelling={study.api.checkSpelling}
          onSpeak={speak}
          onOpenEdit={study.api.openEdit}
          onDelete={study.api.removeCard}
          onDraftChange={study.api.setDraft}
          onSaveEdit={study.api.saveEdit}
          onCancelEdit={() => {
            study.api.setEditOpen(false)
            study.api.setDraft(null)
          }}
          onGrade={study.api.grade}
          onConfirmForgot={study.api.confirmForgot}
          onSoftenForgot={study.api.softenForgot}
          onCancelForgot={study.api.cancelForgot}
          onBack={study.api.back}
          onNext={study.api.forward}
          onMarkUnknown={study.api.markUnknown}
          onDrillCleared={study.api.clearDrill}
          onMeaningCleared={study.api.clearMeaningGate}
          onLearnReveal={study.api.revealLearnAnswer}
          onLearnPick={study.api.answerLearn}
          onLearnContinue={study.api.continueLearn}
          onReviewAnswer={study.api.answerReview}
          onReviewChoice={study.api.chooseReview}
          onSpellMiss={study.api.applySpellingMiss}
          onAckSpellMiss={study.api.ackSpellMiss}
          onRetryForgot={study.api.retryForgot}
          onRestart={() => study.api.start()}
        />
      )}

      {quiz.setupOpen && !quiz.queue && (
        <QuizSetupPanel
          kinds={quiz.kinds}
          scope={quiz.scope}
          limit={quiz.limit}
          auto={quiz.auto}
          unique={quiz.unique}
          speakAfter={quiz.speakAfter}
          availableCount={quiz.availableCount}
          poolUnmastered={quiz.poolSizes.unmastered}
          articleKinds={quiz.articleKinds}
          articleAvailable={quizArticleAvailable}
          onToggleKind={(k, on) => quiz.setKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)))}
          onToggleArticleKind={(k, on) =>
            quiz.setArticleKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)))
          }
          onScopeChange={quiz.setScope}
          onLimitChange={quiz.setLimit}
          onAutoChange={quiz.setAuto}
          onUniqueChange={quiz.setUnique}
          onSpeakChange={quiz.setSpeakAfter}
          loopWrong={quiz.loopWrong}
          onLoopWrongChange={quiz.setLoopWrong}
          onCancel={() => quiz.setSetupOpen(false)}
          onStart={quiz.start}
          onStartArticle={quiz.startArticle}
        />
      )}

      {/* 「先学一遍再考」：队列还没开始，先摊开这轮要考的词 */}
      {quiz.warmup && (
        <DrillWarmup
          title={quiz.warmup.title}
          kind={quiz.warmup.kind}
          cards={quiz.warmup.cards}
          onStart={quiz.beginWarmup}
          onCancel={quiz.cancelWarmup}
        />
      )}

      {quiz.queue && (
        <QuizPanel
          question={quiz.index < quiz.queue.length ? quiz.queue[quiz.index] : null}
          scope={quiz.scope}
          articleRun={quiz.articleRun}
          queueLength={quiz.queue.length}
          index={quiz.index}
          seconds={quiz.seconds}
          results={quiz.results}
          checked={quiz.checked}
          input={quiz.input}
          result={quiz.result}
          items={items}
          drillRound={quiz.drillRound}
          spellMiss={quiz.spellMiss}
          onClose={quiz.close}
          onSpeak={speak}
          onResetSpeech={resetSpeech}
          ttsState={ttsState}
          onSubmit={() => quiz.check()}
          onNext={quiz.next}
          onRetryWrong={quiz.retryWrong}
          onRestart={quiz.start}
          onAckSpellMiss={quiz.ackSpellMiss}
          onRelearn={quiz.relearnSpellMiss}
          onSelectOption={(opt) => {
            quiz.setInput(opt)
            quiz.check(opt)
          }}
          onInputChange={quiz.setInput}
        />
      )}

      {quick.queue && (
        <QuickPanel
          current={quickCurrent}
          queueLength={quick.queue.length}
          index={quick.index}
          revealed={quick.revealed}
          onClose={quick.close}
          onReveal={() => quick.setRevealed(true)}
          onSpeak={speak}
          onGrade={quick.grade}
          onRestart={quick.start}
        />
      )}

      {dict.queue && (
        <DictPanel
          queue={dict.queue}
          index={dict.index}
          mode={dict.mode}
          words={dict.words}
          blankCount={dict.blankCount}
          clozeWords={dict.clozeWords}
          maxQuestions={dict.maxQuestions}
          grandTotal={dict.roundInfo.grand}
          roundOffset={dict.roundInfo.offset}
          checked={dict.checked}
          diff={dict.diff}
          cloze={dict.cloze}
          blanks={dict.blanks}
          input={dict.input}
          results={dict.results}
          wrongItems={dict.wrongItems}
          onStart={dict.start}
          onCheck={dict.check}
          onNext={dict.next}
          onWrongNow={dict.wrongNow}
          onRetryWrong={dict.retryWrong}
          onClose={dict.close}
          onSpeak={speak}
          onPlayItem={playDictItem}
          onResetSpeech={resetSpeech}
          ttsState={ttsState}
          onInputChange={dict.setInput}
          onBlankChange={dict.setBlank}
        />
      )}

      {listening.api.open && listening.api.quiz && (
        <ListeningPanel
          questions={listening.api.questions}
          answers={listening.api.answers}
          submitted={listening.api.submitted}
          result={listening.api.result}
          onlyWrong={!!listening.api.wrongIds}
          readingAll={listening.readingAll}
          transcript={listening.transcript}
          readMode={listening.readMode}
          onClose={listening.onClose}
          onToggleRead={listening.onToggleRead}
          onResetSpeech={resetSpeech}
          ttsState={ttsState}
          onAnswer={(id, value) => listening.api.setAnswers((a) => ({ ...a, [id]: value }))}
          onSubmit={listening.api.submit}
          onRetryWrong={listening.api.retryWrong}
          onShowAll={listening.api.showAll}
          onRegenerate={() => void listening.api.copyPrompt()}
        />
      )}

      {writing.open && (
        <WritingPanel
          model={writing.model}
          text={writing.text}
          task={writing.task}
          feedback={writing.feedback}
          history={writing.history}
          onClose={() => writing.setOpen(false)}
          onGenerateTask={() => void writing.copyImitationTask()}
          onFeedback={() => void writing.copyFeedback()}
          onModelChange={writing.setModel}
          onTextChange={writing.setText}
          onClearHistory={() => writing.setHistory([])}
          onLoadRecord={writing.loadRecord}
        />
      )}
    </>
  )
}
