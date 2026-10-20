import ReaderSidebarHost from '../ReaderSidebarHost'
import type { ReaderScreenProps } from '../ReaderScreen'

/**
 * 侧栏槽位：把学习记录 / 生词本 / 会话入口 / AI 工作包 / 词典工具映射到 `ReaderSidebarHost`。
 * 纯映射，不读存储、不发请求。
 */
export default function ReaderSidebarZone(props: ReaderScreenProps) {
  const {
    sideTab,
    onSideTabChange,
    studiedTodayIds,
    articleWords,
    articleNums,
    articleOrigins,
    articleVias,
    articleAllPrinted,
    articlePrintedAt,
    meaningOf,
    languageSentCount,
    library,
    restorePrevLibrary,
    dictTools,
    dictReady,
    tatoebaReady,
    exporter,
    lastTask,
    target,
    useExact,
    exact,
    batchCount,
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
    vocabView,
    setVocabView,
    vocabSort,
    setVocabSort,
    doc,
    showLanguage,
    setShowLanguage,
    setPlanOpen,
    setBrowseAll,
    articleTitle,
    articleKey,
    articleIdentity,
    setExportOpen,
    setStatsOpen,
    statsOpen,
    dailyGoal,
    setDailyGoal,
    focusLemma,
    setFocusLemma,
    confirmDel,
    setConfirmDel,
    sentence,
  } = props
  const { services, learning, derived, articleDerived, viewData, ai, ui, batchQueue, vocabEdits } = props
  const { studyApi, quizApi, quickApi, dictApi, listenCount, setListenCount, openListeningMode, openListening, openSpeedRead, openWriting } =
    services
  const { speak } = props.speaking
  const { mistakes, activity, practice, setMistakes } = learning
  const { readyRows } = viewData
  const { retryMistakeVocab, startSiege, retryMistakeListen, retryMistakeDict, startArticleQuiz, vocabMode } = services
  const { articleMastery } = articleDerived
  const { totals, dayStats, studyTodaySeconds, studyTotalSeconds, studyTotalCards, last7, dueForecastRows, byArticle, visibleBatch, confusableBatch, confusableTodo, lemmaCandidates, posCandidates } = derived
  const { aiPack } = ai
  const { aiTasksApi } = ai
  const { copyMissingAgain, copyLanguagePrompt } = aiTasksApi
  const { addSelectionToBatch, mark, jumpToSource } = props.selection
  const { addToBatch, setBatch } = batchQueue
  const { editWord: handleEdit, reviewWord: handleReview } = vocabEdits
  const { askDelete, askDeleteArticle, enrichExamplesFromTatoeba } = ui
  const { openLangFor } = props.workspace

  return (
    <ReaderSidebarHost
      sideTab={sideTab}
      onSideTabChange={onSideTabChange}
      learning={{
        mistakes,
        activity,
        practice,
        onClearMistakes: () => setMistakes([]),
        rebuild: {
          run: () => void learning.rebuild.run(),
          busy: learning.rebuild.busy,
          note: learning.rebuild.note,
          matched: learning.rebuild.matched,
        },
      }}
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
        articleOrigins,
        articleVias,
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
        onApplyPaste: props.ai.applyAnyPaste,
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
        articleIdentity,
        meaningOf,
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
        onDeleteArticle: askDeleteArticle,
        onEdit: handleEdit,
        onReview: handleReview,
      }}
    />
  )
}
