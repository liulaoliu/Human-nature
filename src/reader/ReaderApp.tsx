import { useCallback, useEffect, useMemo, useRef } from 'react'
import { type ArticleQuizKind } from '../core/quiz'
import { dayKeyLocal } from '../core/activity'

import { useReaderArticleIdentity, useReaderPanelRouting } from './hooks/useReaderRouting'
import { useArticleIdentity } from './hooks/useArticleIdentity'
import { useReaderArticleNavigation } from './hooks/useReaderArticleNavigation'
import { useReaderFlowRouting } from './hooks/useReaderFlowRouting'
import { useBrowseFilters } from './hooks/useBrowseFilters'

import { useToast } from './hooks/useToast'

import { useLearningData } from './hooks/useLearningData'
import { useReaderHotkeys } from './hooks/useReaderHotkeys'
import { useLibraryAutoFill } from './hooks/useLibraryAutoFill'
import { useVocabLibrary } from './hooks/useVocabLibrary'
import { useVocabEdits } from './hooks/useVocabEdits'
import { useArticleDerived } from './hooks/useArticleDerived'
import { useArticleWorkspace } from './hooks/useArticleWorkspace'
import { useReaderViewData } from './hooks/useReaderViewData'
import { useSessionServices } from './hooks/useSessionServices'
import ReaderScreenFromModel, { type ReaderAppModel } from './ReaderScreenFromModel'
import { useAiServices } from './hooks/useAiServices'
import { useArticleDocState, usePasteState, useReaderHighlightState } from './hooks/useReaderLocalState'
import { useArticleUiActions } from './hooks/useArticleUiActions'
import { useDocVocabSets } from './hooks/useDocVocabSets'
import { useBatchQueue } from './hooks/useBatchQueue'
import { useReaderDerived } from './hooks/useReaderDerived'
import { useReaderSpeech } from './hooks/useReaderSpeech'
import { useArticleBootstrap } from './hooks/useArticleBootstrap'
import { createExport } from './hooks/exportApi'
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
import { readerViewFlags } from '../core/readerView'
import { useIntensiveActions } from './hooks/useIntensiveActions'
import { useGoldenDrill } from './hooks/useGoldenDrill'
import { useGoldenFeature } from './hooks/useGoldenFeature'

export default function ReaderApp() {
  const docState = useArticleDocState()
  const {
    articleKey, setArticleKey,
    doc, setDoc,
    selectedId, setSelectedId,
    exact, setExact,
    useExact, setUseExact,
    selSid, setSelSid,
    selIndices, setSelIndices,
    articleTitle, setArticleTitle,
    savedId, setSavedId,
    confirmDelSave, setConfirmDelSave,
  } = docState
  const paste = usePasteState()
  const {
    pasted, setPasted,
    askedWordsRef, askedIdsRef, askedArticleKeyRef,
    setPasteReport,
    pasteMissing, setPasteMissing,
    lastTask, setLastTask,
  } = paste
  const { toast, flash } = useToast()

  // 本机存储写失败（配额满 / 隐私模式）：提示一次，别让用户以为已经保存
  useStorageQuotaToast(flash)

  /** 逻辑「今天」的日期键（04:00 结算），多处统计共用一份。 */
  const todayKey = dayKeyLocal(new Date())

  // 启动加载：已保存文章列表 + 内置文章目录（IO 收口在 useArticleBootstrap）
  const { book, bookError, saved, setSaved, savedLoaded, articles } = useArticleBootstrap(flash)

  // 词库：读回 / 迁移清洗 / 唯一写入口 —— 全在 hooks/useVocabLibrary
  const { library, libraryRef, libraryLoaded, persist, persistNow } = useVocabLibrary({ flash })
  /** 是否按住 Ctrl / ⌘ / Alt（决定「整句 / 按词吸附 / 选词组」）：见 hooks/useModifierKeys */
  const { ctrlHeld, altHeld } = useModifierKeys()
  /** 阅读字号 / 字重、主题、译文、音色、词汇标准、面板持久开关… —— 18 个本机偏好全在 hooks/useReaderPrefs */
  const prefs = useReaderPrefs()
  // 整包也直接交给 ReaderScreen（各 zone 自己取）；这里只解出本文件要用的几个
  const {
    fontSize, bold, serif, eye, autoSpeak, ttsVoice, vocabLevel,
    confusableBatchSize, aiPackScope, autoVocabDirect, newLimit, newToday,
    setSideTab, setNewToday,
  } = prefs
  /** 文章标识 ↔ URL slug 的映射表；内部标识 / slug 只在这一个 hook 里拼。 */
  const { articleIndex, currentRef, currentSlug } = useReaderArticleIdentity(book, saved, articleKey, savedId)
  // 面板的开关走 URL（返回键能关面板）；调用方仍然写 setXxxOpen(true/false)
  const { route, panels } = useReaderPanelRouting(currentSlug)
  /** 生词浏览页的筛选也走 URL query：刷新 / 分享回到同一组筛选（只 replace，不堆历史）。 */
  const browseFilters = useBrowseFilters(route.panel === 'browse-article' ? 'article' : 'all')
  /** 选中句子后自动 TTS 朗读：见 useReaderPrefs.autoSpeak；引擎 / 音色 / 预生成都在 useReaderSpeech。 */
  const { ttsAccents, speaking, pregenApi } = useReaderSpeech({ doc, selectedId, ttsVoice, flash })
  const highlight = useReaderHighlightState()
  const {
    peekSid, setPeekSid,
    confirmDel, setConfirmDel,
    lastPicked, setLastPicked,
    setBubblePos,
  } = highlight
  const {
    speak,
    speakRange,
    stopReadAll,
    warmTexts,
    warmTimings,
    ttsState,
    nowPlaying,
  } = speaking

  /**
   * 每天「学过的不同单词 id」历史（每日目标进度 + 学习日志）由 useLearningData 统一管理。
   * 每日目标 / 是否显示语言点 / 混淆项批量 / 工作包范围 / 直入生词本 / 新词上限：见 useReaderPrefs。
   */
  /**
   * 当前文章的稳定标识：内置用 book key；手动/已保存用 savedId。生词据此归属到文章。
   *
   * 最后那个兜底必须有：手动粘贴、还没保存的文章三者全空，`articleIdentity` 会变成空串，
   * 于是**所有未保存文章的「本篇词表 / 精读工作流 / 待选清单」共用同一个键**，
   * 切文章时看起来就像「数据串了 / 精读面板不认词」。
   *
   * 但**不能一删保存就掉回标题**：同一篇正文换了身份，语言点会被收两遍（见 useArticleIdentity）。
   */
  const { identity: articleIdentity, reuseId: saveReuseId } = useArticleIdentity({
    articleKey,
    savedId,
    articleTitle,
    sentences: doc?.sentences ?? null,
  })
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
    backTranslations,
    saveBackTranslation,
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
    goldenDrills,
    recordGolden,
    addMistake,
    dropMistake,
    data: learningData,
    setters: learningSetters,
  } = learning

  /** 本篇生词 / 编号 / 语言点句数 / 打印情况：口径都在 hooks/useArticleVocabView（整包也给 ReaderScreen） */
  const articleVocab = useArticleVocabView({
    library,
    articleIdentity,
    sentences: doc?.sentences ?? null,
  })
  const { articleWords, articleWordItems } = articleVocab

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
    articleTitle,
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
    setIntensiveOpen: panels.setIntensiveOpen,
    setSpeedReadOpen: panels.setSpeedReadOpen,
    warmTexts,
    warmTimings,
    mergeBatch,
    batchItemsFromWords,
    backTranslations,
    saveBackTranslation,
  })
  const { queue: dictQueue, index: dictIndex } = services.dictApi

  // 派生统计簇（会话累计 / 背词 / 到期预测 / 按文章产出 / AI 候选 / 待选过滤）：
  // 纯派生无副作用，状态仍由各自 hook 持有 —— 逻辑与记忆化都在 useReaderDerived。
  const derived = useReaderDerived({
    items: library.items,
    sessions,
    studyDays,
    studyUnflushed: services.studyUnflushed,
    todayKey,
    writingHistory: services.writingHistory,
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


  // 考试听力题 / 听写逐句：一换就出声（两条接线在 hooks/useQueueAutoSpeak）
  useQueueAutoSpeak({ quizQueue: services.quizQueue, quizIndex: services.quizIndex, dictQueue, dictIndex, speak })

  /** 点句子：切换选中；再点同一句 = 停止朗读。 */
  toggleVocabRef.current = services.toggleVocabMode

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
    // 九个 setter 全是 useState 的（useArticleDocState / useReaderHighlightState / useBatchQueue），
    // 引用恒定；列进依赖只会让这个回调在每次渲染时换身份。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    reuseId: saveReuseId,
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
    langOpen,
    setPendingSave,
  } = workspace

  // 键盘 W / 数字 1 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词/听写/考试/快刷时不触发）
  useReaderHotkeys({
    services,
    panels,
    dictQueue,
    langOpen,
    listenOpen: services.listenOpen,
    backOpen: services.backOpen,
    toggleVocabRef,
    navVocabRef,
  })

  /** D老师小课堂：一篇文章的金句课（内容在 doc.golden，进度在学习记录） */
  const golden = useGoldenDrill({
    doc,
    articleId: articleKey || articleTitle || articleIdentity,
    articleTitle,
    articleKey,
    records: goldenDrills,
    recordGolden,
    recordActivity,
    recordPractice,
    recordAnswer,
    speak,
    flash,
    setDoc,
    setPendingSave,
  })

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
    vocabMode: services.vocabMode,
    editing,
    doc,
    library,
    persist,
    articleIdentity,
    articleTitle,
    articleKey,
    setFocusLemma: highlight.setFocusLemma,
    articleRef,
    sideRef,
    applyingDom,
    rightDownRef,
    sessionPickedRef: services.sessionPickedRef,
    navVocabRef,
    stopReadAll,
    fontSize,
    bold,
    serif,
    flash,
  })
  const { selectSentence, focusEntry } = selection

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

  /** 导出 / 打印 / 备份；逻辑在 hooks/exportApi。 */
  const exporter = createExport({
    articles,
    library,
    saved,
    learning: learningData,
    setters: learningSetters,
    writingHistory: services.writingHistory,
    visibleBatch,
    persist,
    persistNow,
    flash,
    setSaved,
    setWritingHistory: services.setWritingHistory,
  })
  const { download } = exporter

  /** 本篇派生：掌握度 / 精读工作流 / 复述 / 产出看板（逻辑在 hooks/useArticleDerived）。 */
  const articleDerived = useArticleDerived({
    articleIdentity,
    // 只传普通单词：精读工作流的「标词/词块/达标拷打」与掌握度都是词汇口径，
    // 语言点条目（词组/习语/用法笔记）另有「句子理解 / 语法」两个阶段在看。
    articleWordItems,
    doc,
    practice,
    mistakes,
    writingHistory: services.writingHistory,
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
    writingHistoryCount: services.writingHistory.length,
    listenQuiz: services.listenQuiz,
    quizArticleKinds: services.quizArticleKinds as ArticleQuizKind[],
    studiedDays,
    saved,
    activity,
    practice,
    journalDay: panels.journalDay,
  })
  const { articleQuizCount } = viewData

  // ---- 路由：/a/<slug> 决定「读哪一篇」；目录和已保存列表到齐才敢按 URL 找文章 ----
  const articleIndexReady = savedLoaded && (!!book || bookError)
  const { articleRouting, routedWorkspace } = useReaderArticleNavigation({
    route,
    currentRef,
    articleIndex,
    articleIndexReady,
    hasDoc: !!doc,
    workspace,
    setDoc,
    setArticleKey,
    setSavedId,
  })

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
    askedArticleKeyRef,
    pasteMissing,
    mergeBatch,
    batchItemsFromWords,
    autoVocabDirect,
    commitBatchItems,
    writingModel: services.writingModel,
    writingText: services.writingText,
    writingTask: services.writingTask,
    recordActivity,
    setDoc,
    setPendingSave,
    setListenQuiz: services.setListenQuiz,
    setWritingTask: services.setWritingTask,
    setWritingFeedback: services.setWritingFeedback,
    setWritingHistory: services.setWritingHistory,
    download,
    aiPackScope,
    confusableBatchSize,
    listenQuiz: services.listenQuiz,
    listenCount: services.listenCount,
    pasted,
    clearPasted: () => setPasted(''),
    lastTask,
    onReport: setPasteReport,
    onMissing: setPasteMissing,
  })

  const { runAiLocal } = ai

  /** 金句课功能装配：drill + 金句本 + 去仿写 / 导出，细节在 hooks/useGoldenFeature。 */
  const goldenFeature = useGoldenFeature({
    golden,
    doc,
    articleTitle,
    articleKey,
    articleIdentity,
    savedId,
    saved,
    records: goldenDrills,
    writingHistory: services.writingHistory,
    setWritingHistory: services.setWritingHistory,
    answerEvents: learningData.answerEvents,
    writingErrorProgress: learningData.writingErrorProgress,
    setWritingErrorProgress: learningSetters.setWritingErrorProgress,
    recordAnswer,
    recordActivity,
    download,
    flash,
    onGenerate: () => void ai.aiTasksApi.copyGoldenPrompt(),
    startWriting: services.writingApi.start,
  })

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

  /** 精读工作流的两个入口动作（阶段→工具、拷打→题型两张表都在同名 hook） */
  const { openIntensiveStage, startIntensiveDrill } = useIntensiveActions({
    setIntensiveOpen: panels.setIntensiveOpen,
    openSpeedRead: services.openSpeedRead,
    startStudy: services.startStudy,
    openWriting: services.openWriting,
    runAiLocal,
    startQuizDrill: services.startQuizDrill,
    startQuizArticleDrill: services.startQuizArticleDrill,
  })

  /**
   * 考试 / 快刷 / 听写 / 听力 进行时（含设置面板与「先学一遍再考」的预习卡）：
   * 隐藏正文，别把原文当阅读看。
   */
  const { examActive, readingView } = readerViewFlags({
    studyOpen: !!services.studyQueue,
    quizSetupOpen: services.quizSetupOpen,
    quizQueue: !!services.quizQueue,
    quizWarmup: !!services.quizWarmup,
    quickQueue: !!services.quickQueue,
    dictQueue: !!dictQueue,
    listenOpen: services.listenOpen,
    backOpen: services.backOpen,
    goldenOpen: golden.open,
    speedReadOpen: panels.speedReadOpen,
    writingOpen: services.writingOpen,
    browseAll: panels.browseAll,
    browseArticle: panels.browseArticle,
  })

  // 整页会话/工具页也进 URL：打开 push、返回关闭、页面内退出 replace。
  useReaderFlowRouting(route, currentSlug, {
    services,
    workspace,
    sentence,
    // 金句课需要正文；深链接刷新时等正文/索引就绪再开，文章不存在则让路由回落。
    ready: libraryLoaded && (route.panel !== 'golden' || !!doc || !route.slug || articleRouting.indexReady),
    golden: { active: golden.open, open: golden.openGolden, close: golden.close },
  })

  const model: ReaderAppModel = {
    prefs,
    docState,
    paste,
    highlight,
    services,
    golden,
    goldenActions: goldenFeature.actions,
    panels,
    browseFilters,
    articleRouting,
    saved,
    book,
    bookError,
    library,
    articleIdentity,
    target,
    sentence,
    batchCount: batch.length,
    articleVocab,
    libraryLemmas,
    vocabSidSet,
    studiedTodayIds,
    ttsAccents,
    ttsState,
    studyGrandSeconds,
    articleQuizCount,
    todayKey,
    flash,
    toast,
    examActive,
    readingView,
    sideRef,
    articleRef,
    startIntensiveDrill,
    openIntensiveStage,
    dictTools,
    dictReady,
    tatoebaReady,
    exporter,
    workspace: routedWorkspace,
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
  }
  return <ReaderScreenFromModel app={model} />
}
