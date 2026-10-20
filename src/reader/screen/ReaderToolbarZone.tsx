import ReaderToolbarHost from '../ReaderToolbarHost'
import type { ReaderScreenProps } from '../ReaderScreen'

/**
 * 顶栏槽位：只把「文章管理 / 朗读 / 预生成 / 统计 / 显示设置」映射到 `ReaderToolbarHost`。
 * 纯映射，不读存储、不发请求。
 */
export default function ReaderToolbarZone(props: ReaderScreenProps) {
  const {
    readingView,
    fontSize,
    bold,
    serif,
    eye,
    setFontSize,
    setBold,
    setSerif,
    setEye,
    book,
    saved,
    doc,
    selectedId,
    vocabLevel,
    setVocabLevel,
    translateView,
    setTranslateView,
    autoSpeak,
    setAutoSpeak,
    ttsVoice,
    setTtsVoice,
    ttsAccents,
    ttsState,
    dailyGoal,
    studiedTodayIds,
    library,
    setComposing,
    setIntensiveOpen,
    setJournalOpen,
    setGoalOpen,
  } = props
  const { docApi, edition, setEdition, currentValue, editing, draft, savedId, copyCleanupPrompt, confirmDelSave } =
    props.workspace
  const { speak, startReadAll, stopReadAll, readingAll } = props.speaking
  const { vocabMode, toggleVocabMode, vocabSeconds, sessionPickedRef, openSpeedRead } = props.services
  const { savedGroups, dayStats, totals } = props.derived
  const { readDays } = props.learning
  const { aiTasksApi } = props.ai
  const { copyTranslateAll, copyAutoVocab } = aiTasksApi
  const { pregen, pregenerateAll, cancelPregenerate } = props.pregenApi

  return (
    <ReaderToolbarHost
      visible={readingView}
      docApi={docApi}
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
      confirmDelSave={confirmDelSave}
    />
  )
}
