import type { ArticleBook } from '../core/matchArticle'
import type { SavedArticle } from '../types/document'
import type { useReaderDoc } from './hooks/useReaderDoc'
import ReaderToolbar, { type ReaderToolbarProps } from './panels/ReaderToolbar'

export interface ReaderToolbarHostProps {
  /** 阅读视图才显示（背词/考试/仿写/全库浏览时收起）。 */
  visible?: boolean
  /** 文章加载 / 保存 / 编辑 / 删除 / 选择（`useReaderDoc` 整包）。 */
  docApi: ReturnType<typeof useReaderDoc>
  /** 版本筛选（「全部 / 2016 / 2021」）；同时喂给文章列表过滤。 */
  edition: string
  onEditionChange: (value: string) => void
  book: ArticleBook | null
  saved: SavedArticle[]
  savedGroups: [string, SavedArticle[]][]
  /** 文章标识 → 第一次读完的日期键。 */
  readDays: Record<string, string>
  currentValue: string
  /** 当前正文（读选中句用） */
  doc: { sentences: { id: string; text: string }[] } | null
  selectedId: string | null
  speak: (text: string) => void
  editing: boolean
  savedId: string | null
  onNewArticle: () => void

  vocab: {
    mode: boolean
    onToggle: () => void
    level: ReaderToolbarProps['vocabLevel']
    onLevelChange: ReaderToolbarProps['onVocabLevelChange']
    translateView: ReaderToolbarProps['translateView']
    onTranslateViewChange: ReaderToolbarProps['onTranslateViewChange']
    autoSpeak: boolean
    onAutoSpeakChange: ReaderToolbarProps['onAutoSpeakChange']
    onTranslateAll: () => void
    onAutoVocab: () => void
  }

  reading: {
    all: boolean
    onToggleAll: () => void
    onSpeedRead: () => void
    onOpenIntensive: () => void
    onOpenJournal: () => void
    onOpenGoals: () => void
  }

  tts: {
    state: ReaderToolbarProps['ttsState']
    voice: string
    onVoiceChange: ReaderToolbarProps['onTtsVoiceChange']
    accents: ReaderToolbarProps['ttsAccents']
  }

  pregen: {
    running: boolean
    done: number
    total: number
    allCached: boolean
    onStart: () => void
    onCancel: () => void
  }

  edit: {
    draft: string
    onCleanup: () => void
  }

  stats: {
    vocabSeconds: number
    sessionPicked: number
    todayPicked: number
    streak: number
    totalPicked: number
    totalSeconds: number
    studiedCount: number
    dailyGoal: number
    libraryCount: number
  }

  display: {
    fontSize: string
    onFontSizeChange: ReaderToolbarProps['onFontSizeChange']
    bold: boolean
    onBoldChange: ReaderToolbarProps['onBoldChange']
    serif: boolean
    onSerifChange: ReaderToolbarProps['onSerifChange']
    eye: boolean
    onEyeChange: ReaderToolbarProps['onEyeChange']
    toolbarWidth: ReaderToolbarProps['toolbarWidth']
    onToolbarWidthChange: ReaderToolbarProps['onToolbarWidthChange']
    toolbarRows: ReaderToolbarProps['toolbarRows']
    onToolbarRowsChange: ReaderToolbarProps['onToolbarRowsChange']
  }

  confirmDelSave: boolean
}

/**
 * 顶栏宿主：把文章管理 hook、朗读/预生成、统计与显示设置映射成 `ReaderToolbar`。
 * `ReaderApp` 只负责"要不要显示"和传这几组状态，不再逐字段铺接线。
 */
export default function ReaderToolbarHost({
  visible = true,
  docApi,
  edition,
  onEditionChange,
  book,
  saved,
  savedGroups,
  readDays,
  currentValue,
  doc,
  selectedId,
  speak,
  editing,
  savedId,
  onNewArticle,
  vocab,
  reading,
  tts,
  pregen,
  edit,
  stats,
  display,
  confirmDelSave,
}: ReaderToolbarHostProps) {
  if (!visible) return null

  /** 读选中句：正文里按 id 找原句，避免用可能被截断的选区。 */
  const speakSelected = () => {
    const s = doc?.sentences.find((x) => x.id === selectedId)
    if (s) speak(s.text)
  }

  return (
    <ReaderToolbar
      book={book}
      editions={docApi.editions}
      edition={edition}
      onEditionChange={onEditionChange}
      bookKeysCount={docApi.bookKeys.length}
      saved={saved}
      savedGroups={savedGroups}
      shownKeys={docApi.shownKeys}
      readDays={readDays}
      currentValue={currentValue}
      onPickArticle={docApi.onPick}
      hasDoc={!!doc}
      editing={editing}
      savedId={savedId}
      onSave={docApi.saveCurrent}
      onNewArticle={onNewArticle}
      vocabMode={vocab.mode}
      onToggleVocab={vocab.onToggle}
      onTranslateAll={vocab.onTranslateAll}
      vocabLevel={vocab.level}
      onVocabLevelChange={vocab.onLevelChange}
      onAutoVocab={vocab.onAutoVocab}
      translateView={vocab.translateView}
      onTranslateViewChange={vocab.onTranslateViewChange}
      autoSpeak={vocab.autoSpeak}
      onAutoSpeakChange={vocab.onAutoSpeakChange}
      selectedId={selectedId}
      onSpeakSelected={speakSelected}
      readingAll={reading.all}
      onToggleReadAll={reading.onToggleAll}
      onSpeedRead={reading.onSpeedRead}
      onOpenIntensive={reading.onOpenIntensive}
      onOpenJournal={reading.onOpenJournal}
      onOpenGoals={reading.onOpenGoals}
      ttsState={tts.state}
      ttsVoice={tts.voice}
      onTtsVoiceChange={tts.onVoiceChange}
      ttsAccents={tts.accents}
      pregenRunning={pregen.running}
      pregenDone={pregen.done}
      pregenTotal={pregen.total}
      onPregenerate={pregen.onStart}
      onCancelPregenerate={pregen.onCancel}
      pregenAllCached={pregen.allCached}
      onEnterEdit={docApi.enterEdit}
      draft={edit.draft}
      onCleanupEdit={edit.onCleanup}
      onApplyEdit={docApi.applyEdit}
      onCancelEdit={docApi.cancelEdit}
      onDeleteSave={docApi.askDeleteSave}
      vocabSeconds={stats.vocabSeconds}
      sessionPicked={stats.sessionPicked}
      todayPicked={stats.todayPicked}
      streak={stats.streak}
      totalPicked={stats.totalPicked}
      totalSeconds={stats.totalSeconds}
      studiedCount={stats.studiedCount}
      dailyGoal={stats.dailyGoal}
      libraryCount={stats.libraryCount}
      fontSize={display.fontSize}
      onFontSizeChange={display.onFontSizeChange}
      bold={display.bold}
      onBoldChange={display.onBoldChange}
      serif={display.serif}
      onSerifChange={display.onSerifChange}
      eye={display.eye}
      onEyeChange={display.onEyeChange}
      toolbarWidth={display.toolbarWidth}
      onToolbarWidthChange={display.onToolbarWidthChange}
      toolbarRows={display.toolbarRows}
      onToolbarRowsChange={display.onToolbarRowsChange}
      confirmDelSave={confirmDelSave}
    />
  )
}
