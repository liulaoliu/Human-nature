import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sortItems } from '../core/vocab'
import { type AnalysisTask } from '../core/analyzer'
import { type ArticleQuizKind } from '../core/quiz'
import { dayKeyLocal } from '../core/activity'
import { useSpeaking } from './hooks/useSpeaking'
import { useTtsEngines } from './hooks/useTtsEngines'
import { useToast } from './hooks/useToast'
import { buildTtsAccents } from '../core/ttsVoices'
import { useLearningData } from './hooks/useLearningData'
import { useHotkeys } from './useHotkeys'
import { useLibraryAutoFill } from './hooks/useLibraryAutoFill'
import { useVocabLibrary } from './hooks/useVocabLibrary'
import { useVocabEdits } from './hooks/useVocabEdits'
import { useArticleDerived } from './hooks/useArticleDerived'
import { useArticleWorkspace } from './hooks/useArticleWorkspace'
import { useReaderViewData } from './hooks/useReaderViewData'
import { useSessionServices } from './hooks/useSessionServices'
import ReaderScreen from './ReaderScreen'
import { useAiServices } from './hooks/useAiServices'
import type { ApplyOutcome } from './hooks/useApplyTaskResult'
import { useArticleUiActions } from './hooks/useArticleUiActions'
import { useDocVocabSets } from './hooks/useDocVocabSets'
import { useBatchQueue } from './hooks/useBatchQueue'
import { useReaderDerived } from './hooks/useReaderDerived'
import { usePregenerate } from './hooks/usePregenerate'
import { useArticleBootstrap } from './hooks/useArticleBootstrap'
import { useExport } from './hooks/useExport'
import { useSelection } from './hooks/useSelection'
import { useDictionary } from './hooks/useDictionary'
import { useDictTools } from './hooks/useDictTools'
import { dictionary } from '../adapters/dictionary'
import { useReaderPrefs } from './hooks/useReaderPrefs'
import { useModifierKeys } from './hooks/useModifierKeys'
import { useStorageQuotaToast } from './hooks/useStorageQuotaToast'
import { useArticleVocabView } from './hooks/useArticleVocabView'
import { useQueueAutoSpeak } from './hooks/useQueueAutoSpeak'
import { pickSentence, pickTarget } from '../core/pickTarget'
import { useIntensiveActions } from './hooks/useIntensiveActions'
import type { Paragraph, Sentence } from '../types/document'
import './reader.css'
interface Doc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

export default function ReaderApp() {
  const [articleKey, setArticleKey] = useState<string | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 鼠标精确选中的片段（划选 / 双击选词），可能为空 */
  const [exact, setExact] = useState('')
  /** 是否用精确片段：有精确选区时为真，默认用整句 */
  const [useExact, setUseExact] = useState(false)
  /** 精确选区：哪个句子 + 哪些词（可离散，支持下划线多选） */
  const [selSid, setSelSid] = useState<string | null>(null)
  const [selIndices, setSelIndices] = useState<number[]>([])
  /** 词库的可变引用：跑批里多条任务挨个应用时用它串起来，避免相互覆盖（见 useApplyTaskResult）。 */
  const [pasted, setPasted] = useState('')
  /** 上次「复制提示词」请求的词（用于校验 AI 返回是否齐全） */
  const askedWordsRef = useRef<string[]>([])
  /** 上次「全文翻译」请求的句子 id（用于校验是否逐句返回） */
  const askedIdsRef = useRef<string[]>([])
  /** 应用结果后的回执（成功 / 缺失 / 无效） */
  const [pasteReport, setPasteReport] = useState<string[]>([])
  /** 上次回执里缺失的词（用于「一键复制未返回的」重试）；类型跟着 hook 走，别再抄一份联合 */
  const [pasteMissing, setPasteMissing] = useState<ApplyOutcome['missing']>(null)
  const [lastTask, setLastTask] = useState<
    | AnalysisTask
    | 'confusable'
    | 'example'
    | 'phrase'
    | 'lemma'
    | 'pos'
    | 'grammar_mark'
    | 'listening'
    | 'language'
    | 'imitation'
    | 'feedback'
    | null
  >(null)
  const { toast, flash } = useToast()

  // 本机存储写失败（配额满 / 隐私模式）：提示一次，别让用户以为已经保存
  useStorageQuotaToast(flash)

  /** 逻辑「今天」的日期键（04:00 结算），多处统计共用一份。 */
  const todayKey = dayKeyLocal(new Date())

  // 启动加载：已保存文章列表 + 内置文章目录（IO 收口在 useArticleBootstrap）
  const { book, bookError, saved, setSaved, savedLoaded, articles } = useArticleBootstrap(flash)

  // 词库：读回 / 迁移清洗 / 唯一写入口 / 上一版恢复 —— 全在 hooks/useVocabLibrary
  const { library, libraryRef, libraryLoaded, persist, restorePrev: restorePrevLibrary } = useVocabLibrary({ flash })
  const [articleTitle, setArticleTitle] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  /** 「删除保存」文章的两步确认 */
  const [confirmDelSave, setConfirmDelSave] = useState(false)
  /** 是否按住 Ctrl / ⌘ / Alt（决定「整句 / 按词吸附 / 选词组」）：见 hooks/useModifierKeys */
  const { ctrlHeld, altHeld } = useModifierKeys()
  /** 阅读字号 / 字重、主题、译文、音色、词汇标准、面板持久开关… —— 18 个本机偏好全在 hooks/useReaderPrefs */
  const prefs = useReaderPrefs()
  const {
    fontSize, bold, serif, eye, toolbarWidth, toolbarRows, sideTab, translateView, autoSpeak, ttsVoice,
    vocabLevel, vocabView, vocabSort, dailyGoal, showLanguage, confusableBatchSize,
    aiPackScope, autoVocabDirect, newLimit, newToday,
    setFontSize, setBold, setSerif, setEye, setToolbarWidth, setToolbarRows, setSideTab, setTranslateView, setAutoSpeak,
    setTtsVoice, setVocabLevel, setVocabView, setVocabSort, setDailyGoal, setShowLanguage,
    setConfusableBatchSize, setAiPackScope, setAutoVocabDirect, setNewLimit, setNewToday,
  } = prefs
  /** 每日统计面板是否展开 */
  const [statsOpen, setStatsOpen] = useState(false)
  /** 「全部生词」独立视图（侧栏只显示本篇） */
  const [browseAll, setBrowseAll] = useState(false)
  /** 选中句子后自动 TTS 朗读：见 useReaderPrefs.autoSpeak */
  // 引擎探测：发现本机离线引擎（SAPI / Piper）后，并入音色下拉
  const ttsEngines = useTtsEngines()
  const ttsAccents = useMemo(() => buildTtsAccents(ttsEngines), [ttsEngines])
  /** a/d 临时提示的句子（有生词，底色与"选中句"略不同） */
  const [peekSid, setPeekSid] = useState<string | null>(null)
  /** 生词本里被高亮/滚到的词条（点正文生词时用） */
  const [focusLemma, setFocusLemma] = useState<string | null>(null)
  /** 待确认删除的词条 id（两步防误触） */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  /** 朗读（TTS）：单句 / 整篇 / 选中句自动读。speak 身份稳定，后面的回调可直接用，不用 ref 绕顺序。 */
  const speaking = useSpeaking({
    doc,
    selectedId,
    voice: ttsVoice,
    onFallback: (reason) => {
      if (reason === 'server') {
        flash('服务端语音连不上，已改用浏览器语音；可在音色里选「离线 · 本地语音」（需安装 Piper）')
      } else if (reason === 'local') {
        flash('本地离线语音失败，已改用浏览器语音；请检查 Piper 是否可用')
      } else {
        flash('浏览器拦了自动播放，已改用浏览器语音（点一下页面再试）')
      }
    },
  })
  const {
    speak,
    speakRange,
    stopReadAll,
    warmTexts,
    warmTimings,
    ttsState,
    nowPlaying,
  } = speaking

  // 整篇朗读预生成（查缓存 / 增量合成 / 取消）收口在 usePregenerate
  const pregenApi = usePregenerate({
    sentences: doc?.sentences ?? null,
    voice: ttsVoice,
  })

  /**
   * 每天「学过的不同单词 id」历史（每日目标进度 + 学习日志）由 useLearningData 统一管理。
   * 每日目标 / 是否显示语言点 / 混淆项批量 / 工作包范围 / 直入生词本 / 新词上限：见 useReaderPrefs。
   */
  /** 选词模式：最近选中的词 + 气泡位置 */
  const [lastPicked, setLastPicked] = useState<{ word: string; sid: string } | null>(null)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null)
  /** 当前文章的稳定标识：内置用 book key；手动/已保存用 savedId。生词据此归属到文章。 */
  const articleIdentity = articleKey ?? savedId ?? articleTitle
  // 「待选」清单：状态 + 按文章持久化 + 去重（IO 收口在 useBatchQueue）
  const batchQueue = useBatchQueue({ articleIdentity, sentences: doc?.sentences ?? null })
  const {
    batch,
    setBatch,
    batchMapRef,
    addToBatch,
    mergeBatch,
    batchItemsFromWords,
    batchSentenceIds,
  } = batchQueue

  // 学习记录（练习/错题/活动/背词日/会话/复述/略读/读完/目标）：声明与落盘全在 useLearningData
  const learning = useLearningData({ articleIdentity, articleTitle, articleKey, todayKey, flash })
  const {
    studyDays,
    studiedDays,
    activity,
    practice,
    mistakes,
    kindStats,
    recordAnswer,
    retells,
    sessions,
    setSessions,
    skimmedArticles,
    // 写入动作也在这里（原来在本文件 wrap 一遍 setter）
    markStudied,
    studyFlush,
    studiedTodayIds,
    recordActivity,
    recordPractice,
    mergeKindStats,
    addMistake,
    dropMistake,
    data: learningData,
    setters: learningSetters,
  } = learning

  /** 本篇生词 / 编号 / 语言点句数 / 打印情况：口径都在 hooks/useArticleVocabView */
  const {
    articleWords,
    articleWordItems,
    knownLemmas,
    articleOrigins,
    articleVias,
    articleMeaningSources,
    languageSentCount,
    wordsInSentence,
    articleNums,
    articleFirst,
    meaningOf,
    articlePrintedAt,
    articleAllPrinted,
  } = useArticleVocabView({
    library,
    articleIdentity,
    sentences: doc?.sentences ?? null,
  })

  /** 正文里哪些词算生词（本篇条目；不拿整库去标新文章）—— 见 hooks/useDocVocabSets */
  const { docLemmas, libraryLemmas, vocabSidSet } = useDocVocabSets({
    sentences: doc?.sentences ?? null,
    articleItems: articleWordItems,
    batchSentenceIds,
  })
  const applyingDom = useRef(false)
  const articleRef = useRef<HTMLElement | null>(null)
  const sideRef = useRef<HTMLElement | null>(null)
  const confirmTimerRef = useRef<number | null>(null)
  /** 右键按下中（右键期间跳过 selectionchange 处理，保住 Ctrl 多选的精确选区） */
  const rightDownRef = useRef(false)

  // 键盘 W / 数字 1 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词时不触发）
  const toggleVocabRef = useRef<() => void>(() => { })
  const navVocabRef = useRef<(dir: 1 | -1) => void>(() => { })

  // 护眼主题：eye 已由 useLocalStorageState 存成 'green'/'dark'，这里只负责应用到 DOM
  useEffect(() => {
    document.documentElement.dataset.theme = eye ? 'green' : 'dark'
  }, [eye])

  /**
   * 词库自动补全的**唯一写入口**（语言点收藏 + 离线例句 + 词典词形归并）。
   * 纯计划与幂等保证在 core/libraryAutoFill.ts；接线与「不写第二个 effect」的约定在同名 hook 里。
   */
  const dictReady = useDictionary()
  const { lookupTatoeba, tatoebaReady } = useLibraryAutoFill({
    sentences: doc?.sentences ?? null,
    saved,
    articleIdentity,
    libraryRef,
    libraryLoaded,
    persist,
    dict: dictReady ? dictionary() : null,
  })

  /** 记录今天新引入了一个词（用于每日配额；跨天由 useReaderPrefs 的 serialize 归零）。 */
  const bumpNewToday = useCallback(() => setNewToday((prev) => prev + 1), [setNewToday])

  /** 逐句速读。 */
  const [speedReadOpen, setSpeedReadOpen] = useState(false)
  /** 今日计划。
   */
  const [planOpen, setPlanOpen] = useState(false)
  /** 精读工作流面板。 */
  const [intensiveOpen, setIntensiveOpen] = useState(false)
  /** 学习日志面板 + 选中的日期。 */
  const [journalOpen, setJournalOpen] = useState(false)
  const [journalDay, setJournalDay] = useState(() => dayKeyLocal(new Date()))
  /** 打印 / 导出面板。 */
  const [exportOpen, setExportOpen] = useState(false)
  /** 目标备忘面板 + 今日读文目标 + 自由备忘（状态在 useLearningData）。 */
  const [goalOpen, setGoalOpen] = useState(false)
  /** 生词本排序方式：见 useReaderPrefs.vocabSort */
  /** 词库增删动作（自动标词直入 / 速读加词 / 词组入库 / 移出）；写入仍只走 persist。 */
  const vocabEdits = useVocabEdits({
    libraryRef,
    persist,
    article: { identity: articleIdentity, title: articleTitle, key: articleKey },
    flash,
  })
  const { commitBatchItems } = vocabEdits

  /** 会话服务层（背词 / 考试 / 听力 / 快刷 / 听写 / 仿写 + 选词计时 + 错题重练）。 */
  const services = useSessionServices({
    library,
    articleIdentity,
    docLemmas,
    doc,
    selectedId,
    speak,
    flash,
    persist,
    markStudied,
    recordActivity, recordPractice, recordAnswer,
    addMistake,
    dropMistake,
    studyFlush,
    newLimit,
    newToday,
    bumpNewToday,
    mergeKindStats,
    setLastTask,
    askedWordsRef,
    askedIdsRef,
    setSessions,
    mistakes,
    setIntensiveOpen,
    setSpeedReadOpen,
    warmTexts,
    warmTimings,
    mergeBatch,
    batchItemsFromWords,
  })
  const {
    studyQueue,
    studyUnflushed,
    startStudy,
    quizSetupOpen,
    quizQueue,
    quizIndex,
    quizArticleKinds,
    startQuizDrill,
    startQuizArticleDrill,
    listenQuiz,
    setListenQuiz,
    listenOpen,
    setListenOpen,
    listenCount,
    openSpeedRead,
    quickQueue,
    writingOpen,
    writingModel,
    writingTask,
    setWritingTask,
    writingText,
    setWritingFeedback,
    writingHistory,
    setWritingHistory,
    openWriting,
    vocabMode,
    toggleVocabMode,
    sessionPickedRef,
    dictApi,
  } = services

  const { queue: dictQueue, index: dictIndex } = dictApi

  // 派生统计簇（会话累计 / 背词 / 到期预测 / 按文章产出 / AI 候选 / 待选过滤）：
  // 纯派生无副作用，状态仍由各自 hook 持有 —— 逻辑与记忆化都在 useReaderDerived。
  const derived = useReaderDerived({
    items: library.items,
    sessions,
    studyDays,
    studyUnflushed,
    todayKey,
    writingHistory,
    saved,
    confusableBatchSize,
    batch,
    libraryLemmas,
  })
  const {
    studyGrandSeconds,
    confusableTodo,
    confusableBatch,
    lemmaCandidates,
    posCandidates,
    visibleBatch,
  } = derived


  // 键盘 W / 数字 1 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词/听写/考试/快刷时不触发）
  useHotkeys(
    (e) => {
      // 全屏练习/速读/语言点编辑打开时，别抢键盘（它们各有自己的按键）
      if (studyQueue || quizQueue || quickQueue || dictQueue) return
      if (speedReadOpen || listenOpen || langOpen) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      // 只认主键盘区的数字 1（小键盘 1 不抢）；W 照旧
      if (k === 'w' || e.code === 'Digit1') toggleVocabRef.current()
      else if (k === 'a') navVocabRef.current(-1)
      else if (k === 'd') navVocabRef.current(1)
    },
    true,
    10,
  )

  // 考试听力题 / 听写逐句：一换就出声（两条接线在 hooks/useQueueAutoSpeak）
  useQueueAutoSpeak({ quizQueue, quizIndex, dictQueue, dictIndex, speak })

  /** 点句子：切换选中；再点同一句 = 停止朗读。 */
  toggleVocabRef.current = toggleVocabMode

  const resetSelection = useCallback(() => {
    setSelectedId(null)
    setExact('')
    setUseExact(false)
    setBatch([])
    setPeekSid(null)
    setLastPicked(null)
    setConfirmDelSave(false)
    setSelSid(null)
    setSelIndices([])
  }, [])

  /** 文章工作区（文档动作 + 新建/导入 + 语言点编辑）；状态在 hooks/useArticleWorkspace。 */
  const workspace = useArticleWorkspace({
    articles,
    batchMapRef,
    setBatch,
    resetSelection,
    flash,
    book,
    articleKey,
    setArticleKey,
    articleTitle,
    setArticleTitle,
    savedId,
    setSavedId,
    confirmDelSave,
    setConfirmDelSave,
    doc,
    setDoc,
    saved,
    setSaved,
    savedLoaded,
  })
  const {
    editing,
    setComposing,
    langOpen,
    setPendingSave,
  } = workspace

  /** 选区所在的句子（默认操作对象）与真正拿去用的文本：规则在 core/pickTarget */
  const sentence = useMemo(() => pickSentence(doc?.sentences, selectedId, exact), [doc, selectedId, exact])
  const target = useMemo(() => pickTarget(exact, useExact, sentence), [exact, useExact, sentence])

  /** 选区/划词（逻辑在 hooks/useSelection）。 */
  const selection = useSelection({
    selectedId,
    setSelectedId,
    exact,
    setExact,
    setUseExact,
    selSid,
    setSelSid,
    selIndices,
    setSelIndices,
    ctrlHeld,
    altHeld,
    peekSid,
    setPeekSid,
    lastPicked,
    setLastPicked,
    setBubblePos,
    batch,
    addToBatch,
    sentence,
    vocabMode,
    editing,
    doc,
    library,
    persist,
    articleIdentity,
    articleTitle,
    articleKey,
    setFocusLemma,
    articleRef,
    sideRef,
    applyingDom,
    rightDownRef,
    sessionPickedRef,
    navVocabRef,
    stopReadAll,
    fontSize,
    bold,
    serif,
    flash,
  })
  const {
    selectSentence,
    focusEntry,
    onMouseUp,
    onMouseDown,
    onContextMenu,
  } = selection

  /** 正文小动作：Alt 复制 / 两步删除 / 逐词高亮 / 点句朗读 / 生词定位 / 听写播放 / 离线例句。 */
  const ui = useArticleUiActions({
    flash,
    confirmDel,
    setConfirmDel,
    confirmTimerRef,
    library,
    libraryRef,
    persist,
    speak,
    speakRange,
    speakNowPlaying: nowPlaying,
    doc,
    selectedId,
    selectSentence,
    autoSpeak,
    setSideTab,
    focusEntry,
    articleWords,
    articleIdentity,
    lookupTatoeba,
  })
  const { enrichExamplesFromTatoeba } = ui

  /** 导出 / 打印 / 备份；逻辑在 hooks/useExport。 */
  const exporter = useExport({
    articles,
    library,
    saved,
    learning: learningData,
    setters: learningSetters,
    writingHistory,
    visibleBatch,
    persist,
    flash,
    setSaved,
    setWritingHistory,
  })
  const { download } = exporter

  /** 本篇派生：掌握度 / 精读工作流 / 复述 / 产出看板（逻辑在 hooks/useArticleDerived）。 */
  const articleDerived = useArticleDerived({
    articleIdentity,
    articleWords,
    doc,
    practice,
    mistakes,
    writingHistory,
    retells,
    kindStats,
    activity,
    skimmedArticles,
  })

  /** 就绪清单 / 学习日志 / 打印索引 / 测验数（逻辑在 hooks/useReaderViewData）。 */
  const viewData = useReaderViewData({
    doc,
    libraryItems: library.items,
    batchCount: batch.length,
    confusableTodoCount: confusableTodo.length,
    lemmaCandidatesCount: lemmaCandidates.length,
    writingHistoryCount: writingHistory.length,
    listenQuiz,
    quizArticleKinds: quizArticleKinds as ArticleQuizKind[],
    studiedDays,
    saved,
    activity,
    practice,
    journalDay,
  })
  const { articleQuizCount } = viewData

  /** AI 服务：复制提示词 / 应用结果 / 工作包 / 粘回路由；逻辑在 hooks/useAiServices。 */
  const ai = useAiServices({
    exact,
    useExact,
    sentence,
    visibleBatch,
    library,
    libraryRef,
    persist,
    articleIdentity,
    articleTitle,
    articleKey,
    doc,
    vocabLevel,
    confusableBatch,
    confusableTodo,
    lemmaCandidates,
    posCandidates,
    articleWords,
    flash,
    setLastTask,
    setBatch,
    askedWordsRef,
    askedIdsRef,
    pasteMissing,
    mergeBatch,
    batchItemsFromWords,
    autoVocabDirect,
    commitBatchItems,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
    setDoc,
    setPendingSave,
    setListenQuiz,
    setWritingTask,
    setWritingFeedback,
    setWritingHistory,
    download,
    aiPackScope,
    confusableBatchSize,
    listenQuiz,
    listenCount,
    pasted,
    clearPasted: () => setPasted(''),
    lastTask,
    onReport: setPasteReport,
    onMissing: setPasteMissing,
  })

  const { runAiLocal } = ai

  /** 离线词典（ECDICT）：就绪状态 + 三个"纯本地"动作。 */
  const dictTools = useDictTools({
    library,
    libraryRef,
    persist,
    doc,
    level: vocabLevel,
    mergeBatch,
    batchItemsFromWords,
    flash,
    enrichExamples: enrichExamplesFromTatoeba,
  })

  const allList = sortItems(library.items, vocabSort)
  /** 精读工作流的两个入口动作（阶段→工具、拷打→题型两张表都在同名 hook） */
  const { openIntensiveStage, startIntensiveDrill } = useIntensiveActions({
    setIntensiveOpen,
    openSpeedRead,
    startStudy,
    openWriting,
    runAiLocal,
    startQuizDrill,
    startQuizArticleDrill,
  })

  /** 考试 / 快刷 / 听写 / 听力 进行时（含设置面板）：隐藏正文，别把原文当阅读看。 */
  const examActive = quizSetupOpen || !!quizQueue || !!quickQueue || !!dictQueue || listenOpen || speedReadOpen
  /** 是否处于「阅读」视图：否则（背单词/考试/听写/听力/仿写/全部生词）隐藏精读工具栏 */
  const readingView = !studyQueue && !examActive && !writingOpen && !browseAll

  return (
    <ReaderScreen
      fontSize={fontSize}
      bold={bold}
      serif={serif}
      examActive={examActive}
      sideTab={sideTab}
      onSideTabChange={setSideTab}
      sideRef={sideRef}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      toast={toast}
      setFontSize={setFontSize}
      setBold={setBold}
      setSerif={setSerif}
      eye={eye}
      setEye={setEye}
      toolbarWidth={toolbarWidth}
      setToolbarWidth={setToolbarWidth}
      toolbarRows={toolbarRows}
      setToolbarRows={setToolbarRows}
      readingView={readingView}
      saved={saved}
      book={book}
      library={library}
      restorePrevLibrary={restorePrevLibrary}
      articleIdentity={articleIdentity}
      articleTitle={articleTitle}
      articleKey={articleKey}
      doc={doc}
      bookError={bookError}
      selectedId={selectedId}
      exact={exact}
      useExact={useExact}
      lastTask={lastTask}
      target={target}
      sentence={sentence}
      batchCount={batch.length}
      articleWords={articleWords}
      articleNums={articleNums}
      articleOrigins={articleOrigins}
      articleVias={articleVias}
      articleMeaningSources={articleMeaningSources}
      articleFirst={articleFirst}
      articleAllPrinted={articleAllPrinted}
      articlePrintedAt={articlePrintedAt}
      languageSentCount={languageSentCount}
      knownLemmas={knownLemmas}
      libraryLemmas={libraryLemmas}
      vocabSidSet={vocabSidSet}
      wordsInSentence={wordsInSentence}
      meaningOf={meaningOf}
      allList={allList}
      studiedTodayIds={studiedTodayIds}
      pasted={pasted}
      setPasted={setPasted}
      pasteReport={pasteReport}
      setPasteReport={setPasteReport}
      pasteMissing={pasteMissing}
      setPasteMissing={setPasteMissing}
      aiPackScope={aiPackScope}
      setAiPackScope={setAiPackScope}
      autoVocabDirect={autoVocabDirect}
      setAutoVocabDirect={setAutoVocabDirect}
      confusableBatchSize={confusableBatchSize}
      setConfusableBatchSize={setConfusableBatchSize}
      translateView={translateView}
      setTranslateView={setTranslateView}
      autoSpeak={autoSpeak}
      setAutoSpeak={setAutoSpeak}
      vocabLevel={vocabLevel}
      setVocabLevel={setVocabLevel}
      ttsVoice={ttsVoice}
      setTtsVoice={setTtsVoice}
      ttsAccents={ttsAccents}
      ttsState={ttsState}
      newLimit={newLimit}
      setNewLimit={setNewLimit}
      newToday={newToday}
      studyGrandSeconds={studyGrandSeconds}
      articleQuizCount={articleQuizCount}
      dailyGoal={dailyGoal}
      setDailyGoal={setDailyGoal}
      showLanguage={showLanguage}
      setShowLanguage={setShowLanguage}
      vocabView={vocabView}
      setVocabView={setVocabView}
      vocabSort={vocabSort}
      setVocabSort={setVocabSort}
      statsOpen={statsOpen}
      setStatsOpen={setStatsOpen}
      focusLemma={focusLemma}
      setFocusLemma={setFocusLemma}
      confirmDel={confirmDel}
      setConfirmDel={setConfirmDel}
      todayKey={todayKey}
      setComposing={setComposing}
      setPlanOpen={setPlanOpen}
      setBrowseAll={setBrowseAll}
      setExportOpen={setExportOpen}
      setJournalOpen={setJournalOpen}
      setIntensiveOpen={setIntensiveOpen}
      setGoalOpen={setGoalOpen}
      setSpeedReadOpen={setSpeedReadOpen}
      setListenOpen={setListenOpen}
      speedReadOpen={speedReadOpen}
      planOpen={planOpen}
      intensiveOpen={intensiveOpen}
      journalOpen={journalOpen}
      journalDay={journalDay}
      setJournalDay={setJournalDay}
      exportOpen={exportOpen}
      goalOpen={goalOpen}
      browseAll={browseAll}
      flash={flash}
      peekSid={peekSid}
      selSid={selSid}
      selIndices={selIndices}
      lastPicked={lastPicked}
      bubblePos={bubblePos}
      articleRef={articleRef}
      startIntensiveDrill={startIntensiveDrill}
      openIntensiveStage={openIntensiveStage}
      dictTools={dictTools}
      dictReady={dictReady}
      tatoebaReady={tatoebaReady}
      exporter={exporter}
      workspace={workspace}
      services={services}
      ai={ai}
      ui={ui}
      derived={derived}
      articleDerived={articleDerived}
      viewData={viewData}
      learning={learning}
      selection={selection}
      batchQueue={batchQueue}
      vocabEdits={vocabEdits}
      speaking={speaking}
      pregenApi={pregenApi}
    />
  )
}
