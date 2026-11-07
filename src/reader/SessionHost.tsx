import type { Dispatch, SetStateAction } from 'react'
import type { ActivityCat } from '../core/activity'
import type { WritingRecord } from '../core/writing'
import type { VocabItem } from '../types/document'
import type { useStudySession } from './hooks/useStudySession'
import type { useQuizSession } from './hooks/useQuizSession'
import type { useQuickSession } from './hooks/useQuickSession'
import type { useDictation } from './hooks/useDictation'
import type { useListening } from './hooks/useListening'
import type { useWriting } from './hooks/useWriting'
import type { useBackTranslate } from './hooks/useBackTranslate'
import type { useProductionSession } from './hooks/useProductionSession'
import type { ProductionPanelActions } from './panels/ProductionPanel'
import StudyPanelFromModel from './panels/StudyPanelFromModel'
import ProductionPanel from './panels/ProductionPanel'
import QuizSetupPanel from './panels/QuizSetupPanel'
import QuizPanel from './panels/QuizPanel'
import DrillWarmup from './panels/DrillWarmup'
import QuickPanel from './panels/QuickPanel'
import DictPanel from './panels/DictPanel'
import ListeningPanel from './panels/ListeningPanel'
import WritingPanel from './panels/WritingPanel'
import BackTranslatePanel from './panels/BackTranslatePanel'
import DrillSentenceStage from './panels/DrillSentenceStage'

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
  back: ReturnType<typeof useBackTranslate>
  production: ReturnType<typeof useProductionSession>
  /** 奶牛工棚的子视图 / 历史筛选接线（`route.ts` 解析出来的 URL 状态）。 */
  productionActions: ProductionPanelActions
  /** 记忆 / 词块拷打结算页造句：写作历史 + 活动记录由 ReaderApp 的学习域统一提供。 */
  drillWriting: {
    writingHistory: WritingRecord[]
    setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
    flash: (message: string) => void
    recordActivity: (cat: ActivityCat, n?: number) => void
    articleId: string
    articleTitle: string
  }
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
  back,
  production,
  productionActions,
  drillWriting,
}: SessionHostProps) {
  // 记忆 / 词块拷打结算页：用本轮考到的词 / 词块出一道造句，批改复用金句课本句仿写。
  const sentenceDrill =
    quiz.drill && quiz.queue && quiz.index >= quiz.queue.length ? (
      <DrillSentenceStage
        kind={quiz.drill}
        items={items}
        results={quiz.results}
        articleId={drillWriting.articleId}
        articleTitle={drillWriting.articleTitle}
        writingHistory={drillWriting.writingHistory}
        setWritingHistory={drillWriting.setWritingHistory}
        flash={drillWriting.flash}
        recordActivity={drillWriting.recordActivity}
      />
    ) : null

  const quickCurrent =
    quick.queue && quick.index < quick.queue.length
      ? (items.find((it) => it.id === quick.queue![quick.index].id) ?? quick.queue[quick.index])
      : null

  // 产出训练是整页会话：打开时只画它，避免和背词 / 考试 / 金句课叠在一起。
  if (production.open) return <ProductionPanel model={production} {...productionActions} />

  return (
    <>
      {study.api.queue && (
        <StudyPanelFromModel
          study={study}
          items={items}
          speak={speak}
          onExam={() => {
            study.api.close()
            quiz.setResults([])
            quiz.setSetupOpen(true)
          }}
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
          limit={quiz.warmup.limit}
          onLimitChange={(n) => {
            const w = quiz.warmup
            if (!w) return
            // 记忆 / 词块各自的「本轮题数」在这里改，也在这里落盘；预习页重建后再开始。
            quiz.setDrillLimit(w.kind, n)
            quiz.setWarmupLimit(n)
          }}
          onStart={quiz.beginWarmup}
          onCancel={quiz.cancelWarmup}
        />
      )}

      {!quiz.warmup && quiz.queue && (
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
          onRestart={(limit) => {
            // 刷新恢复的会话没有 lastRound：按当前是不是文章测验回退到对应的开局。
            if (quiz.lastRound) quiz.restart(limit)
            else if (quiz.articleRun) quiz.startArticle(limit)
            else quiz.start({ limit })
          }}
          restartLimit={quiz.lastRound?.limit ?? quiz.queue?.length ?? quiz.limit}
          restartWithPreview={!!quiz.lastRound?.warmup}
          sentenceDrill={sentenceDrill}
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
          articleId={writing.articleId}
          articleTitle={writing.articleTitle}
          onClose={() => writing.setOpen(false)}
          onGenerateTask={() => void writing.copyImitationTask()}
          onFeedback={() => void writing.copyFeedback()}
          onModelChange={writing.setModel}
          onTextChange={writing.setText}
          onClearHistory={writing.clearHistory}
          onLoadRecord={writing.loadRecord}
        />
      )}

      {back.open && <BackTranslatePanel api={back} />}
    </>
  )
}
