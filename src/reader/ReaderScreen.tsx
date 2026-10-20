import type { ComponentProps } from 'react'
import { displayMeaning, lemmaOf } from '../core/vocab'
import type { ArticleBook } from '../core/matchArticle'
import type { SavedArticle } from '../core/ports'
import type { Sentence, VocabItem, VocabLibrary } from '../types/document'
import type { ReaderDoc } from './hooks/useReaderDoc'
import ReaderShell from './ReaderShell'
import ReaderToolbarHost from './ReaderToolbarHost'
import ReaderSidebarHost from './ReaderSidebarHost'
import type { ReaderSideTab } from './panels/ReaderSidebar'
import SessionHost from './SessionHost'
import ReaderOverlaysHost from './ReaderOverlaysHost'
import Composer from './panels/Composer'
import ReaderArticle from './ReaderArticle'
import type { useArticleWorkspace } from './hooks/useArticleWorkspace'
import type { useSessionServices } from './hooks/useSessionServices'
import type { useAiServices } from './hooks/useAiServices'
import type { useArticleUiActions } from './hooks/useArticleUiActions'
import type { useReaderDerived } from './hooks/useReaderDerived'
import type { useArticleDerived } from './hooks/useArticleDerived'
import type { useReaderViewData } from './hooks/useReaderViewData'
import type { useLearningData } from './hooks/useLearningData'
import type { useSelection } from './hooks/useSelection'
import type { useBatchQueue } from './hooks/useBatchQueue'
import type { useVocabEdits } from './hooks/useVocabEdits'
import type { useSpeaking } from './hooks/useSpeaking'
import type { usePregenerate } from './hooks/usePregenerate'

type ShellP = ComponentProps<typeof ReaderShell>
type ToolbarP = ComponentProps<typeof ReaderToolbarHost>
type SidebarP = ComponentProps<typeof ReaderSidebarHost>
type OverlayP = ComponentProps<typeof ReaderOverlaysHost>
type SessionP = ComponentProps<typeof SessionHost>
type ArticleP = ComponentProps<typeof ReaderArticle>

export interface ReaderScreenProps {
  // ---- 外壳 / 字号 / 主题 ----
  fontSize: ShellP['fontSize']
  bold: boolean
  serif: boolean
  examActive: boolean
  sideTab: ReaderSideTab
  onSideTabChange: (tab: ReaderSideTab) => void
  sideRef: ShellP['sideRef']
  onMouseDown: ShellP['onMouseDown']
  onMouseUp: ShellP['onMouseUp']
  onContextMenu: ShellP['onContextMenu']
  toast: string
  setFontSize: (v: string) => void
  setBold: (v: boolean) => void
  setSerif: (v: boolean) => void
  eye: boolean
  setEye: (v: boolean) => void
  readingView: boolean

  // ---- 文章 / 词库 / 选区状态 ----
  saved: SavedArticle[]
  book: ArticleBook | null
  library: VocabLibrary
  restorePrevLibrary: () => void | Promise<void>
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  doc: ReaderDoc | null
  bookError: boolean
  selectedId: string | null
  exact: string
  useExact: boolean
  lastTask: string | null
  target: string
  sentence: Sentence | null
  batchCount: number
  articleWords: VocabItem[]
  articleNums: Map<string, number>
  articleFirst: ArticleP['articleFirst']
  articleAllPrinted: boolean
  articlePrintedAt: string | null
  languageSentCount: number
  knownLemmas: Set<string>
  libraryLemmas: Set<string>
  vocabSidSet: Set<string>
  wordsInSentence: (sid: string) => string[]
  allList: VocabItem[]
  studiedTodayIds: string[]

  // ---- 粘贴 / AI 配置 ----
  pasted: string
  setPasted: (v: string) => void
  pasteReport: string[]
  setPasteReport: (v: string[]) => void
  pasteMissing: Parameters<typeof useAiServices>[0]['pasteMissing']
  setPasteMissing: (v: Parameters<typeof useAiServices>[0]['pasteMissing']) => void
  aiPackScope: SidebarP['pick']['scope']
  setAiPackScope: (v: SidebarP['pick']['scope']) => void
  autoVocabDirect: boolean
  setAutoVocabDirect: (v: boolean) => void
  confusableBatchSize: number
  setConfusableBatchSize: (v: number) => void
  translateView: ToolbarP['vocab']['translateView']
  setTranslateView: (v: ToolbarP['vocab']['translateView']) => void
  autoSpeak: boolean
  setAutoSpeak: (v: boolean) => void
  vocabLevel: ToolbarP['vocab']['level']
  setVocabLevel: (v: ToolbarP['vocab']['level']) => void
  ttsVoice: ToolbarP['tts']['voice']
  setTtsVoice: (v: ToolbarP['tts']['voice']) => void
  ttsAccents: ToolbarP['tts']['accents']
  ttsState: SessionP['ttsState']

  // ---- 学习配额 / 生词本视图 ----
  newLimit: number
  setNewLimit: (v: number) => void
  newToday: number
  studyGrandSeconds: number
  articleQuizCount: number
  dailyGoal: number
  setDailyGoal: (v: number) => void
  showLanguage: boolean
  setShowLanguage: (v: boolean) => void
  vocabView: 'card' | 'table'
  setVocabView: (v: 'card' | 'table') => void
  vocabSort: SidebarP['vocab']['sortBy']
  setVocabSort: (v: SidebarP['vocab']['sortBy']) => void
  statsOpen: boolean
  setStatsOpen: (updater: boolean | ((prev: boolean) => boolean)) => void
  focusLemma: string | null
  setFocusLemma: (v: string | null) => void
  confirmDel: string | null
  setConfirmDel: (v: string | null) => void
  todayKey: string

  // ---- 面板开关 ----
  setComposing: (updater: boolean | ((prev: boolean) => boolean)) => void
  setPlanOpen: (v: boolean) => void
  setBrowseAll: (v: boolean) => void
  setExportOpen: (v: boolean) => void
  setJournalOpen: (v: boolean) => void
  setIntensiveOpen: (v: boolean) => void
  setGoalOpen: (v: boolean) => void
  setSpeedReadOpen: (v: boolean) => void
  setListenOpen: (v: boolean) => void
  speedReadOpen: boolean
  planOpen: boolean
  intensiveOpen: boolean
  journalOpen: boolean
  journalDay: string
  setJournalDay: (v: string) => void
  exportOpen: boolean
  goalOpen: boolean
  browseAll: boolean
  flash: (message: string) => void
  peekSid: string | null
  selSid: string | null
  selIndices: number[]
  lastPicked: { word: string; sid: string } | null
  bubblePos: { top: number; left: number } | null
  articleRef: ArticleP['articleRef']
  startIntensiveDrill: (kind: Parameters<OverlayP['intensive']['onDrill']>[0]) => void
  openIntensiveStage: OverlayP['intensive']['onStage']
  dictTools: SidebarP['dictTools']
  dictReady: boolean
  tatoebaReady: boolean
  exporter: SidebarP['exporter']

  // ---- 各领域 hook 的完整结果 ----
  workspace: ReturnType<typeof useArticleWorkspace>
  services: ReturnType<typeof useSessionServices>
  ai: ReturnType<typeof useAiServices>
  ui: ReturnType<typeof useArticleUiActions>
  derived: ReturnType<typeof useReaderDerived>
  articleDerived: ReturnType<typeof useArticleDerived>
  viewData: ReturnType<typeof useReaderViewData>
  learning: ReturnType<typeof useLearningData>
  selection: ReturnType<typeof useSelection>
  batchQueue: ReturnType<typeof useBatchQueue>
  vocabEdits: ReturnType<typeof useVocabEdits>
  speaking: ReturnType<typeof useSpeaking>
  pregenApi: ReturnType<typeof usePregenerate>
}

/**
 * 阅读页视图：只负责把各领域 hook 的结果映射到子组件槽位。
 *
 * 状态与动作都在 `ReaderApp` / hooks 里；这一层不读存储、不发请求，
 * 方便单独调布局与条件渲染。
 */
export default function ReaderScreen(props: ReaderScreenProps) {
  const {
    fontSize,
    bold,
    serif,
    examActive,
    sideTab,
    onSideTabChange,
    sideRef,
    onMouseDown,
    onMouseUp,
    onContextMenu,
    toast,
    setFontSize,
    setBold,
    setSerif,
    eye,
    setEye,
    readingView,
    saved,
    book,
    library,
    restorePrevLibrary,
    articleIdentity,
    articleTitle,
    articleKey,
    selectedId,
    exact,
    useExact,
    lastTask,
    target,
    sentence,
    batchCount,
    articleWords,
    articleNums,
    articleFirst,
    articleAllPrinted,
    articlePrintedAt,
    languageSentCount,
    knownLemmas,
    libraryLemmas,
    vocabSidSet,
    wordsInSentence,
    allList,
    studiedTodayIds,
    pasted,
    setPasted,
    pasteReport,
    setPasteReport,
    pasteMissing,
    setPasteMissing,
    aiPackScope,
    setAiPackScope,
    autoVocabDirect,
    setAutoVocabDirect,
    confusableBatchSize,
    setConfusableBatchSize,
    translateView,
    setTranslateView,
    autoSpeak,
    setAutoSpeak,
    vocabLevel,
    setVocabLevel,
    ttsVoice,
    setTtsVoice,
    ttsAccents,
    ttsState,
    newLimit,
    setNewLimit,
    newToday,
    studyGrandSeconds,
    articleQuizCount,
    dailyGoal,
    setDailyGoal,
    showLanguage,
    setShowLanguage,
    vocabView,
    setVocabView,
    vocabSort,
    setVocabSort,
    statsOpen,
    setStatsOpen,
    focusLemma,
    setFocusLemma,
    confirmDel,
    setConfirmDel,
    todayKey,
    setComposing,
    setPlanOpen,
    setBrowseAll,
    setExportOpen,
    setJournalOpen,
    setIntensiveOpen,
    setGoalOpen,
    setSpeedReadOpen,
    setListenOpen,
    speedReadOpen,
    planOpen,
    intensiveOpen,
    journalOpen,
    journalDay,
    setJournalDay,
    exportOpen,
    goalOpen,
    browseAll,
    flash,
    peekSid,
    selSid,
    selIndices,
    lastPicked,
    bubblePos,
    articleRef,
    startIntensiveDrill,
    openIntensiveStage,
    dictTools,
    dictReady,
    tatoebaReady,
    exporter,
    doc,
    bookError,
    workspace,
    services,
    ai,
    ui,
    derived,
    articleDerived,
    viewData,
    learning,
    selection,
    batchQueue,
    vocabEdits,
    speaking,
    pregenApi,
  } = props

  const { docApi: readerDocApi, edition, setEdition, currentValue, editing, draft, setDraft, composing, manual, setManual, newTitle, setNewTitle, newBook, setNewBook, pdfRange, setPdfRange, importing, langOpen, setLangOpen, langTarget, openLangFor, saveLanguage, copyCleanupPrompt, createArticle, onImportFiles, onPickPdf, onPickEpub, savedId } = workspace
  const { studyApi, studyQueue, startStudy, quizApi, listenApi, listenCount, setListenCount, listenReadMode, setListenReadMode, openListening, openListeningMode, openSpeedRead, openWriting, startArticleQuiz, startSiege, retryMistakeVocab, retryMistakeListen, retryMistakeDict, toggleVocabMode, vocabMode, vocabSeconds, sessionPickedRef, dictApi, quickApi, writingApi, writingOpen } = services
  const { aiTasksApi, aiPack, applyAnyPaste, aiWebPending, aiLocalRunning, aiLocalDone, aiLocalTotal, aiLocalRound, aiLocalPhase, aiLocalError, runAiLocal } = ai
  const { copyTranslateAll, copyAutoVocab, copyLanguagePrompt, copyMissingAgain } = aiTasksApi
  const { karaoke, altCopyText, askDelete, revealVocabWord, playDictItem, selectSentenceAndRead, enrichExamplesFromTatoeba } = ui
  const { savedGroups, totals, dayStats, studyTodaySeconds, studyTotalSeconds, studyTotalCards, todayCards, todayWrites, last7, dueForecastRows, byArticle, visibleBatch, confusableBatch, confusableTodo, lemmaCandidates, posCandidates } = derived
  const { articleMastery, intensiveSkimmed, intensivePlan, myRetells, outputBoard } = articleDerived
  const { readyRows, journalAllDays, journalData, journalSummaryRows, journalHeat, exportArticles } = viewData
  const { mistakes, activity, practice, setMistakes, readGoal, setReadGoal, goalMemo, setGoalMemo, readDone, todayReadDone, articleReadDay, readDays, markReadDone, undoReadDone, saveRetell, deleteRetell, toggleSkimmed } = learning
  const { addSelectionToBatch, mark, jumpToSource } = selection
  const { addToBatch, setBatch } = batchQueue
  const { addItems: addItemsToVocab, addPhrases: addPhrasesToVocab, removeWord: removeWordFromVocab, reviewWord: handleReview, editWord: handleEdit } = vocabEdits
  const { speak, speakFromWord, startReadAll, stopReadAll, readingAll } = speaking
  const { pregen, pregenerateAll, cancelPregenerate } = pregenApi
  const { doExportAnki, exportWordList, doExportWrong, doPrint } = exporter

  return (
    <ReaderShell
      fontSize={fontSize}
      bold={bold}
      serif={serif}
      examActive={examActive}
      studying={!!studyQueue}
      sideTab={sideTab}
      sideRef={sideRef}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      toast={toast}
      toolbar={
        <ReaderToolbarHost
          visible={readingView}
          docApi={readerDocApi}
          edition={edition}
          onEditionChange={setEdition}
          book={book}
          saved={saved}
          savedGroups={savedGroups}
          readDays={readDays}
          currentValue={currentValue}
          doc={doc}
          selectedId={selectedId}
          speak={speak}
          editing={editing}
          savedId={savedId}
          onNewArticle={() => setComposing((v) => !v)}
          vocab={{
            mode: vocabMode,
            onToggle: toggleVocabMode,
            level: vocabLevel,
            onLevelChange: setVocabLevel,
            translateView,
            onTranslateViewChange: setTranslateView,
            autoSpeak,
            onAutoSpeakChange: setAutoSpeak,
            onTranslateAll: () => void copyTranslateAll(),
            onAutoVocab: () => void copyAutoVocab(),
          }}
          reading={{
            all: readingAll,
            onToggleAll: readingAll ? stopReadAll : startReadAll,
            onSpeedRead: openSpeedRead,
            onOpenIntensive: () => setIntensiveOpen(true),
            onOpenJournal: () => setJournalOpen(true),
            onOpenGoals: () => setGoalOpen(true),
          }}
          tts={{ state: ttsState, voice: ttsVoice, onVoiceChange: setTtsVoice, accents: ttsAccents }}
          pregen={{ ...pregen, onStart: () => void pregenerateAll(), onCancel: cancelPregenerate }}
          edit={{ draft, onCleanup: () => void copyCleanupPrompt(draft, '「完成」') }}
          stats={{
            vocabSeconds,
            sessionPicked: sessionPickedRef.current,
            todayPicked: dayStats.todayPicked,
            streak: dayStats.streak,
            totalPicked: totals.picked,
            totalSeconds: totals.seconds,
            studiedCount: studiedTodayIds.length,
            dailyGoal,
            libraryCount: library.items.length,
          }}
          display={{
            fontSize,
            onFontSizeChange: setFontSize,
            bold,
            onBoldChange: setBold,
            serif,
            onSerifChange: setSerif,
            eye,
            onEyeChange: setEye,
          }}
          confirmDelSave={workspace.confirmDelSave}
        />
      }
      sidebar={
        <ReaderSidebarHost
          sideTab={sideTab}
          onSideTabChange={onSideTabChange}
          learning={{ mistakes, activity, practice, onClearMistakes: () => setMistakes([]) }}
          overview={{
            readyRows,
            onRetryVocab: retryMistakeVocab,
            onSiege: startSiege,
            onRetryListen: retryMistakeListen,
            onRetryDict: retryMistakeDict,
          }}
          mastery={{ mastery: articleMastery, onStartArticle: startArticleQuiz }}
          derived={{
            totals,
            dayStats,
            studyTodaySeconds,
            studyTotalSeconds,
            studyTotalCards,
            studiedCount: studiedTodayIds.length,
            last7,
            dueForecast: dueForecastRows,
            byArticle,
            visibleBatch,
            confusableBatchCount: confusableBatch.length,
            confusableTodoCount: confusableTodo.length,
            lemmaCount: lemmaCandidates.length,
            posCount: posCandidates.length,
            articleWords,
            articleNums,
            articleAllPrinted,
            articlePrintedAt,
            languageCount: languageSentCount,
          }}
          study={studyApi}
          quiz={quizApi}
          quick={quickApi}
          dict={dictApi}
          speech={speak}
          library={library}
          restorePrev={() => void restorePrevLibrary()}
          listening={{ open: openListeningMode, start: openListening }}
          openSpeedRead={openSpeedRead}
          openWriting={openWriting}
          ai={aiPack}
          tasks={aiTasksApi}
          exporter={exporter}
          dictTools={dictTools}
          dictReady={dictReady}
          tatoeba={{ ready: tatoebaReady, enrichExamples: () => void enrichExamplesFromTatoeba() }}
          selection={{ addSelectionToBatch, mark, jumpToSource }}
          pick={{
            lastTask,
            target,
            useExact,
            vocabMode,
            canMark: !!exact,
            batchCount,
            pasted,
            onPastedChange: (v) => {
              setPasted(v)
              if (pasteReport.length) setPasteReport([])
              if (pasteMissing) setPasteMissing(null)
            },
            pasteReport,
            pasteMissingCount: pasteMissing?.words.length ?? 0,
            onApplyPaste: applyAnyPaste,
            onCopyMissingAgain: () => void copyMissingAgain(),
            onOpenLang: () => openLangFor(sentence),
            onRemoveWord: (b) => addToBatch([b.word], b.sentence, b.sentenceId),
            onClearBatch: () => setBatch([]),
            scope: aiPackScope,
            onScopeChange: setAiPackScope,
            autoVocabDirect,
            onAutoVocabDirectChange: setAutoVocabDirect,
            confusableBatchSize,
            onConfusableBatchSizeChange: setConfusableBatchSize,
          }}
          vocab={{
            view: vocabView,
            onViewChange: setVocabView,
            sortBy: vocabSort,
            onSortChange: setVocabSort,
            hasDoc: !!doc,
            listenCount,
            onListenCountChange: setListenCount,
            onLanguagePrompt: () => void copyLanguagePrompt(),
            showLanguage,
            onShowLanguageChange: setShowLanguage,
            onOpenPlan: () => setPlanOpen(true),
            onBrowseAll: () => setBrowseAll(true),
            printTitle: articleTitle || articleKey || '本篇生词',
            onOpenExport: () => setExportOpen(true),
            onToggleStats: () => setStatsOpen((v) => !v),
            statsOpen,
            dailyGoal,
            onDailyGoalChange: setDailyGoal,
            focusLemma,
            onFocusLemmaChange: setFocusLemma,
            confirmDel,
            onConfirmDelChange: setConfirmDel,
            onDelete: askDelete,
            onEdit: handleEdit,
            onReview: handleReview,
          }}
        />
      }
    >
      {bookError && !book && (
        <p className="muted">没取到 articles.json（要 http://localhost 打开且文件存在）。可直接把正文粘在下面。</p>
      )}

      <SessionHost
        items={library.items}
        speak={speak}
        resetSpeech={speaking.resetSpeech}
        ttsState={ttsState}
        playDictItem={playDictItem}
        study={{ api: studyApi, grandSeconds: studyGrandSeconds, newLimit, newToday, onNewLimitChange: setNewLimit }}
        quiz={quizApi}
        quizArticleAvailable={articleQuizCount}
        quick={quickApi}
        dict={dictApi}
        listening={{
          api: listenApi,
          transcript: doc ? doc.sentences.map((s) => s.text).join(' ') : null,
          readingAll,
          readMode: listenReadMode,
          onToggleRead: readingAll ? stopReadAll : startReadAll,
          onClose: () => {
            setListenOpen(false)
            setListenReadMode(false)
          },
        }}
        writing={writingApi}
      />

      <ReaderOverlaysHost
        speed={{
          open: speedReadOpen && !!doc,
          sentences: doc?.sentences ?? [],
          docKey: articleIdentity,
          onClose: () => setSpeedReadOpen(false),
          onSpeak: speak,
          ttsState,
          onAddItems: addItemsToVocab,
          isKnown: (w) => knownLemmas.has(lemmaOf(w)),
          wordMeaning: (w) => {
            const it = library.items.find((x) => x.lemma === lemmaOf(w) || x.word.toLowerCase() === w.toLowerCase())
            return it ? displayMeaning(it) || it.meaning || null : null
          },
          onFinishRead: markReadDone,
          onAddPhrases: addPhrasesToVocab,
          onHint: flash,
          wordsInSentence,
          onRemoveWord: removeWordFromVocab,
          vocabMode,
          onOpenLang: openLangFor,
          langEditorOpen: langOpen,
        }}
        lang={{ open: langOpen, sentence: langTarget, onSave: saveLanguage, onClose: () => setLangOpen(false) }}
        plan={{
          open: planOpen,
          onClose: () => setPlanOpen(false),
          hasDoc: !!doc,
          articleTitle,
          todoPending: aiWebPending,
          todayCards,
          todayWrites,
          todayKey,
          onNewArticle: () => {
            setPlanOpen(false)
            setComposing(() => true)
          },
          onStartStudy: () => {
            setPlanOpen(false)
            startStudy()
          },
          onOpenSpeedRead: () => {
            setPlanOpen(false)
            openSpeedRead()
          },
        }}
        intensive={{
          open: intensiveOpen,
          onClose: () => setIntensiveOpen(false),
          articleTitle,
          hasDoc: !!doc,
          plan: intensivePlan,
          skimmed: intensiveSkimmed,
          onToggleSkimmed: toggleSkimmed,
          onRunBatch: () => void runAiLocal(),
          batchRunning: aiLocalRunning,
          onCancelBatch: aiPack.cancelLocal,
          batchRound: aiLocalRound,
          batchPhase: aiLocalPhase,
          batchDone: aiLocalDone,
          batchTotal: aiLocalTotal,
          batchError: aiLocalError,
          board: outputBoard,
          retells: myRetells,
          onSaveRetell: saveRetell,
          onDeleteRetell: deleteRetell,
          onStage: openIntensiveStage,
          onDrill: startIntensiveDrill,
          onSiege: startSiege,
        }}
        goal={{
          open: goalOpen,
          onClose: () => setGoalOpen(false),
          todayKey,
          done: todayReadDone,
          allDone: readDone,
          goal: readGoal,
          onGoalChange: setReadGoal,
          memo: goalMemo,
          onMemoChange: setGoalMemo,
          articleTitle,
          articleDone: articleReadDay !== null,
          articleReadDay,
          onMarkDone: markReadDone,
          onUndo: undoReadDone,
        }}
        exporter={{
          open: exportOpen,
          onClose: () => setExportOpen(false),
          libraryItems: library.items,
          articleTitle,
          articleWords,
          articles: exportArticles,
          todayKey,
          onPrint: doPrint,
          onExportAnki: doExportAnki,
          onExportWordList: exportWordList,
        }}
        journal={{
          open: journalOpen,
          onClose: () => setJournalOpen(false),
          days: journalAllDays,
          day: journalDay,
          onDayChange: setJournalDay,
          data: journalData,
          summary: journalSummaryRows,
          heat: journalHeat,
          onSpeak: speak,
        }}
        allVocab={{
          open: browseAll,
          items: library.items,
          list: allList,
          view: vocabView,
          onViewChange: setVocabView,
          focusLemma,
          confirmDel,
          onSpeak: speak,
          onDelete: askDelete,
          onReview: handleReview,
          onEdit: handleEdit,
          onClose: () => setBrowseAll(false),
          onExportAnki: doExportAnki,
          onPrint: doPrint,
          onExportWrong: doExportWrong,
        }}
      />

      {!studyQueue && !browseAll && !examActive && (composing || !doc) && (
        <Composer
          composing={composing}
          onCancel={() => setComposing(() => false)}
          title={newTitle}
          onTitleChange={setNewTitle}
          book={newBook}
          onBookChange={setNewBook}
          manual={manual}
          onManualChange={setManual}
          pdfRange={pdfRange}
          onPdfRangeChange={setPdfRange}
          importing={importing}
          onImportFiles={(files) => void onImportFiles(files)}
          onPickPdf={(f) => void onPickPdf(f)}
          onPickEpub={(f) => void onPickEpub(f)}
          onCleanupPrompt={() => void copyCleanupPrompt(manual, '「创建文章」')}
          onCreate={() => void createArticle()}
        />
      )}

      {!studyQueue && !browseAll && !examActive && !writingOpen && doc && !composing && (
        <ReaderArticle
          doc={doc}
          articleTitle={articleTitle}
          articleKey={articleKey}
          onRename={() => void workspace.renameArticle()}
          editing={editing}
          draft={draft}
          onDraftChange={setDraft}
          translateView={translateView}
          selectedId={selectedId}
          peekSid={peekSid}
          vocabSidSet={vocabSidSet}
          selSid={selSid}
          selIndices={selIndices}
          libraryLemmas={libraryLemmas}
          articleNums={articleNums}
          articleFirst={articleFirst}
          showLanguage={showLanguage}
          vocabMode={vocabMode}
          lastPicked={lastPicked}
          bubblePos={bubblePos}
          articleRef={articleRef}
          onSelectSentence={selectSentenceAndRead}
          onFocusEntry={revealVocabWord}
          onAltCopyText={altCopyText}
          karaoke={karaoke}
          onSpeakFromWord={speakFromWord}
          onAddPhrase={addPhrasesToVocab}
        />
      )}
    </ReaderShell>
  )
}
