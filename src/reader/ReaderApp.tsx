import { useCallback, useEffect, useMemo, useRef } from 'react'
import { sortItems } from '../core/vocab'
import { type ArticleQuizKind } from '../core/quiz'
import { dayKeyLocal } from '../core/activity'
import { useSpeaking } from './hooks/useSpeaking'
import { buildArticleIndex } from '../core/articleIndex'
import { useReaderArticleRouting, useReaderPanelRouting } from './hooks/useReaderRouting'
import { useReaderFlowRouting } from './hooks/useReaderFlowRouting'
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
import ReaderScreenFromModel, { type ReaderAppModel } from './ReaderScreenFromModel'
import { useAiServices } from './hooks/useAiServices'
import { useArticleDocState, usePasteState, useReaderHighlightState } from './hooks/useReaderLocalState'
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
    askedWordsRef, askedIdsRef,
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
    fontSize, bold, serif, eye, autoSpeak, ttsVoice, vocabLevel, vocabSort,
    confusableBatchSize, aiPackScope, autoVocabDirect, newLimit, newToday,
    setSideTab, setNewToday,
  } = prefs
  /**
   * 文章标识 ↔ URL slug 的映射表。
   *
   * 地址栏里放的是由标题算出来的可读 slug（`005-leaders-post-truth-politics`），
   * 不是 `b:005 Leaders` 这种内部标识 —— 后者编码进 URL 就是一堆 `%3A` / `%20`。
   */
  const articleIndex = useMemo(() => buildArticleIndex(book, saved), [book, saved])
  /** 当前文章在路由里的内部标识：'b:<内置 key>' / 's:<已保存 id>' / 空串（没打开文章）。 */
  const currentRef = savedId ? `s:${savedId}` : articleKey ? `b:${articleKey}` : ''
  /** 当前文章在 URL 里的样子（空串 = 索引里还没有它，先别动地址栏）。 */
  const currentSlug = currentRef ? articleIndex.slugOf(currentRef) : ''
  // 面板的开关走 URL（返回键能关面板）；调用方仍然写 setXxxOpen(true/false)
  const { route, panels } = useReaderPanelRouting(currentSlug)
  /** 选中句子后自动 TTS 朗读：见 useReaderPrefs.autoSpeak */
  // 引擎探测：发现本机离线引擎（SAPI / Piper）后，并入音色下拉
  const ttsEngines = useTtsEngines()
  const ttsAccents = useMemo(() => buildTtsAccents(ttsEngines), [ttsEngines])
  const highlight = useReaderHighlightState()
  const {
    peekSid, setPeekSid,
    confirmDel, setConfirmDel,
    lastPicked, setLastPicked,
    setBubblePos,
  } = highlight
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
  /**
   * 当前文章的稳定标识：内置用 book key；手动/已保存用 savedId。生词据此归属到文章。
   *
   * 最后那个兜底必须有：手动粘贴、还没保存的文章三者全空，`articleIdentity` 会变成空串，
   * 于是**所有未保存文章的「本篇词表 / 精读工作流 / 待选清单」共用同一个键**，
   * 切文章时看起来就像「数据串了 / 精读面板不认词」。
   */
  const articleIdentity = articleKey || savedId || articleTitle || '手动粘贴'
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


  // 键盘 W / 数字 1 切换「选词模式」、A/D 在有生词的句子间跳（在输入框里打字时不触发；背单词/听写/考试/快刷时不触发）
  useHotkeys(
    (e) => {
      // 全屏练习/速读/语言点编辑打开时，别抢键盘（它们各有自己的按键）
      if (services.studyQueue || services.quizQueue || services.quickQueue || dictQueue) return
      if (panels.speedReadOpen || services.listenOpen || services.backOpen || langOpen) return
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

  /** 导出 / 打印 / 备份；逻辑在 hooks/useExport。 */
  const exporter = useExport({
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

  // ---- 路由：/a/<slug> 决定「读哪一篇」；URL ↔ 文章的同步逻辑在 useReaderArticleRouting ----
  // 目录和已保存列表到齐才敢按 URL 找文章（否则 slug 反查不到，会误判"这篇没了"）。
  // 目录加载失败（bookError）也算就绪：已保存文章仍能按 slug 打开，内置文章会明确显示"不在了"，
  // 而不是永远停在 loading。
  const articleIndexReady = savedLoaded && (!!book || bookError)
  const { routePick, articleRouting } = useReaderArticleRouting({
    routeSlug: route.slug,
    routePanel: route.panel,
    currentRef,
    slugOf: articleIndex.slugOf,
    refOf: articleIndex.refOf,
    indexReady: articleIndexReady,
    hasDoc: !!doc,
    onPick: (ref) => workspace.docApi.onPick(ref),
    onClear: () => {
      setDoc(null)
      setArticleKey(null)
      setSavedId(null)
      try {
        localStorage.removeItem('reader:last')
      } catch {
        // 隐私模式忽略
      }
    },
  })

  /** 文章选择器改成「只导航」，真正加载由 useArticleRoute 的第 ② 条负责。 */
  const routedWorkspace = useMemo(
    () => ({ ...workspace, docApi: { ...workspace.docApi, onPick: routePick } }),
    [workspace, routePick],
  )

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

  // 8709 条词库每次渲染都排序会白烧几十毫秒，而且新数组会让下游 memo 全部失效。
  const allList = useMemo(() => sortItems(library.items, vocabSort), [library.items, vocabSort])
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
  const examActive =
    services.quizSetupOpen ||
    !!services.quizQueue ||
    !!services.quizWarmup ||
    !!services.quickQueue ||
    !!dictQueue ||
    services.listenOpen ||
    services.backOpen ||
    panels.speedReadOpen
  /** 是否处于「阅读」视图：否则（背单词/考试/听写/听力/仿写/回译/全部生词）隐藏精读工具栏 */
  const readingView =
    !services.studyQueue && !examActive && !services.writingOpen && !panels.browseAll

  // 整页会话/工具页也进 URL：打开 push、返回关闭、页面内退出 replace。
  useReaderFlowRouting(route, currentSlug, { services, workspace, sentence, ready: libraryLoaded })

  const model: ReaderAppModel = {
    prefs,
    docState,
    paste,
    highlight,
    services,
    panels,
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
    allList,
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
