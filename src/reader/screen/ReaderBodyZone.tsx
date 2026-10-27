import { lemmaOf } from '../../core/vocab'
import SessionHost from '../SessionHost'
import ReaderOverlaysHost from '../ReaderOverlaysHost'
import GoldenPanel from '../panels/GoldenPanel'
import Composer from '../panels/Composer'
import ReaderArticle from '../ReaderArticle'
import type { ReaderScreenProps } from '../ReaderScreen'
import { bodyMode } from './bodyMode'

/**
 * 正文槽位：会话面板路由 + 各类覆盖层 + 新建文章 + 正文。
 * 纯映射/条件渲染，不读存储、不发请求。
 */
export default function ReaderBodyZone(props: ReaderScreenProps) {
  const {
    bookError,
    book,
    library,
    flash,
    ttsState,
    studyGrandSeconds,
    articleQuizCount,
    articleIdentity,
    articleTitle,
    articleKey,
    doc,
    articleRouting,
    selectedId,
    peekSid,
    vocabSidSet,
    selSid,
    selIndices,
    libraryLemmas,
    lastPicked,
    bubblePos,
    articleRef,
    examActive,
    speedReadOpen,
    planOpen,
    intensiveOpen,
    journalOpen,
    journalDay,
    setJournalDay,
    exportOpen,
    goalOpen,
    browseAll,
    setBrowseAll,
    browseArticle,
    setBrowseArticle,
    browseFilters,
    setComposing,
    setPlanOpen,
    setExportOpen,
    setJournalOpen,
    setIntensiveOpen,
    setGoalOpen,
    setSpeedReadOpen,
    setListenOpen,
    todayKey,
    startIntensiveDrill,
    openIntensiveStage,
    focusLemma,
    confirmDel,
  } = props
  const { newLimit, setNewLimit, newToday, translateView, showLanguage, vocabView, setVocabView, vocabSort, setVocabSort } =
    props.prefs
  const {
    golden,
    onExportGoldenMarkdown,
    onGenerateGolden,
    onOpenGoldenWriting,
    goldenBank,
    onPrintGoldenLesson,
  } = props
  const {
    knownLemmas,
    wordsInSentence,
    articleWords,
    articleNums,
    articleFirst,
    meaningOf,
  } = props.articleVocab

  const {
    composing,
    langOpen,
    setLangOpen,
    langTarget,
    openLangFor,
    saveLanguage,
    newTitle,
    setNewTitle,
    newBook,
    setNewBook,
    manual,
    setManual,
    pdfRange,
    setPdfRange,
    importing,
    onImportFiles,
    onPickPdf,
    onPickEpub,
    copyCleanupPrompt,
    createArticle,
    editing,
    savedId,
    draft,
    setDraft,
    renameArticle,
  } = props.workspace
  const {
    studyApi,
    studyQueue,
    startStudy,
    quizApi,
    quickApi,
    dictApi,
    listenApi,
    listenReadMode,
    setListenReadMode,
    openSpeedRead,
    writingApi,
    writingOpen,
    startSiege,
    vocabMode,
    toggleVocabMode,
  } = props.services
  const { speak, speakFromWord, startReadAll, stopReadAll, readingAll, resetSpeech } = props.speaking
  const {
    aiWebPending,
    aiLocalRunning,
    aiLocalDone,
    aiLocalTotal,
    aiLocalRound,
    aiLocalPhase,
    aiLocalError,
    runAiLocal,
    aiPack,
  } = props.ai
  const {
    addItems: addItemsToVocab,
    addPhrases: addPhrasesToVocab,
    removeWord: removeWordFromVocab,
    reviewWord: handleReview,
    editWord: handleEdit,
  } = props.vocabEdits
  const { playDictItem, askDelete, selectSentenceAndRead, revealVocabWord, altCopyText, karaoke } = props.ui
  const { todayCards, todayWrites } = props.derived
  const { journalAllDays, journalData, journalSummaryRows, journalHeat, exportArticles } = props.viewData
  const { intensivePlan, intensiveSkimmed, myRetells, outputBoard } = props.articleDerived
  const { todayReadDone, readDone, readGoal, setReadGoal, goalMemo, setGoalMemo, articleReadDay, markReadDone, undoReadDone, saveRetell, deleteRetell, toggleSkimmed } = props.learning
  const { doExportAnki, exportWordList, doPrint, doPrintRows, doExportWrong, doExportArticlePackage } = props.exporter

  /** 本篇语境释义（速读和正文悬浮提示共用；不再全库扫） */
  const wordMeaning = (w: string, sid?: string | null) => meaningOf(w, sid)

  /**
   * 正文槽位只有四种：用户主动新建 / URL 文章加载中 / URL 文章不存在 / 正常正文。
   * 旧条件 `composing || !doc` 会把深链接首帧误判成「新建」，先闪一下 Composer。
   */
  const body = bodyMode({
    composing,
    routeSlug: articleRouting.slug,
    indexReady: articleRouting.indexReady,
    routeRef: articleRouting.ref,
    currentRef: articleRouting.currentRef,
    hasDoc: !!doc,
  })
  const bodyVisible = !studyQueue && !browseAll && !browseArticle && !examActive && !writingOpen && !golden.open

  return (
    <>
      {bookError && !book && (
        <p className="muted">没取到 articles.json（要 http://localhost 打开且文件存在）。可直接把正文粘在下面。</p>
      )}

      <SessionHost
        items={library.items}
        speak={speak}
        resetSpeech={resetSpeech}
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
        back={props.services.backApi}
      />

      {golden.open && (
        <GoldenPanel
          api={golden}
          articleTitle={props.articleTitle}
          onSpeak={speak}
          onExportMarkdown={onExportGoldenMarkdown}
          onGenerate={onGenerateGolden}
          onOpenWriting={onOpenGoldenWriting}
          bank={goldenBank}
          onPrintLesson={onPrintGoldenLesson}
        />
      )}

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
          wordMeaning,
          onFinishRead: markReadDone,
          onAddPhrases: addPhrasesToVocab,
          onHint: flash,
          onCopyText: altCopyText,
          wordsInSentence,
          onRemoveWord: removeWordFromVocab,
          vocabMode,
          onToggleVocabMode: toggleVocabMode,
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
          todoPending: aiWebPending,
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
          articleId: articleIdentity,
          articleSavedId: savedId ?? undefined,
          articleEntries: library.articleEntries,
          articles: exportArticles,
          todayKey,
          onPrint: doPrint,
          onPrintRows: doPrintRows,
          onExportAnki: doExportAnki,
          onExportWordList: exportWordList,
          onExportArticlePackage: doExportArticlePackage,
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
          open: browseAll || browseArticle,
          filters: browseFilters.filters,
          onFiltersChange: browseFilters.setFilters,
          libraryItems: library.items,
          articleEntries: library.articleEntries ?? [],
          articleId: doc ? articleIdentity : '',
          articleTitle,
          articles: exportArticles,
          articleNums,
          meaningOf,
          view: vocabView,
          onViewChange: setVocabView,
          sortBy: vocabSort,
          onSortChange: setVocabSort,
          focusLemma,
          confirmDel,
          onSpeak: speak,
          onDelete: askDelete,
          onReview: handleReview,
          onEdit: handleEdit,
          onClose: () => (browseArticle ? setBrowseArticle(false) : setBrowseAll(false)),
          onExportAnki: doExportAnki,
          onPrint: doPrint,
          onPrintRows: doPrintRows,
          onExportWrong: doExportWrong,
        }}
      />

      {bodyVisible && body === 'composer' && (
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

      {bodyVisible && body === 'loading' && (
        <div className="article-loading" aria-live="polite">
          <p className="muted">正在打开文章…</p>
        </div>
      )}

      {bodyVisible && body === 'missing' && (
        <div className="article-missing">
          <p className="muted">这篇文章不在了（可能已删除，或链接不对）。</p>
          <p className="muted">从顶栏的「文章」重新选一篇，或点「新建」粘贴一篇。</p>
        </div>
      )}

      {bodyVisible && body === 'article' && doc && (
        <ReaderArticle
          doc={doc}
          articleTitle={articleTitle}
          articleKey={articleKey}
          onRename={() => void renameArticle()}
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
          wordMeaning={wordMeaning}
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
    </>
  )
}
