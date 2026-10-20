import { useEffect } from 'react'
import { useLocalStorageState, persistentBool, persistentEnum, persistentNumber, persistentString } from './useLocalStorageState'
import { dayKeyLocal, nextStudyDayStart } from '../../core/activity'
import { DEFAULT_TTS_VOICE } from '../../core/ttsVoices'
import type { VocabLevel } from '../../core/analyzer'
import { parseToolbarWidth, type ToolbarWidth } from '../../core/toolbarWidth'
import { parseToolbarRows, type ToolbarRowMode } from '../../core/toolbarRows'
import type { VocabSortBy } from '../../core/vocab'

/**
 * 阅读页这一堆「存在本机的偏好」：字号 / 主题 / 译文 / 音色 / 词汇标准 / 面板开关…
 *
 * 从 `ReaderApp` 抽出来，是因为它们**只是二十来个彼此无关的小开关**：
 * 留在装配层会把「页面怎么拼」淹掉，而且每个键的脏值兜底规则也没地方放。
 * 这里只负责「键名 + 默认值 + 解析」，不掺任何业务判断。
 *
 * 约定：键名带上 `reader:` 前缀，和 `useLocalStorageState` 的 `reader:local-state`
 * 事件一起用；新增偏好就加一行，别在页面里临时 `useState` 一个又会话里丢掉的值。
 */

/** 侧栏 Tab：总览 / 选词分析 / 生词本 / 统计 / 掌握度 */
export type SideTab = 'overview' | 'pick' | 'vocab' | 'stats' | 'mastery'
export const SIDE_TABS: readonly SideTab[] = ['overview', 'pick', 'vocab', 'stats', 'mastery']

/** 译文显示方式：只看原文 / 原文+译文 / 只看译文 */
export type TranslateView = 'off' | 'below' | 'only'
const TRANSLATE_VIEWS = ['off', 'below', 'only'] as const

/** AI 工作包范围：只处理本篇 / 整个词库 */
export type AiPackScope = 'article' | 'all'
const AI_PACK_SCOPES = ['article', 'all'] as const

export interface ReaderPrefs {
  fontSize: string
  setFontSize: (v: string) => void
  bold: boolean
  setBold: (v: boolean) => void
  serif: boolean
  setSerif: (v: boolean) => void
  /** 护眼主题（浅色纸感） */
  eye: boolean
  setEye: (v: boolean) => void
  /** 顶栏按钮区宽度：自适应（按视窗）/ 窄 / 宽 / 铺满 */
  toolbarWidth: ToolbarWidth
  setToolbarWidth: (v: ToolbarWidth) => void
  /** 顶栏按钮区占几行：4（默认）/ 3 / 2 */
  toolbarRows: ToolbarRowMode
  setToolbarRows: (v: ToolbarRowMode) => void
  sideTab: SideTab
  setSideTab: (v: SideTab) => void
  translateView: TranslateView
  setTranslateView: (v: TranslateView) => void
  autoSpeak: boolean
  setAutoSpeak: (v: boolean) => void
  ttsVoice: string
  setTtsVoice: (v: string) => void
  vocabLevel: VocabLevel
  setVocabLevel: (v: VocabLevel) => void
  vocabView: 'card' | 'table'
  setVocabView: (v: 'card' | 'table') => void
  vocabSort: VocabSortBy
  setVocabSort: (v: VocabSortBy) => void
  /** 每日目标（个不同单词，0 = 不设目标） */
  dailyGoal: number
  setDailyGoal: (v: number) => void
  showLanguage: boolean
  setShowLanguage: (v: boolean) => void
  /** 一次生成多少混淆项（0 = 全部） */
  confusableBatchSize: number
  setConfusableBatchSize: (v: number) => void
  aiPackScope: AiPackScope
  setAiPackScope: (v: AiPackScope) => void
  /** 自动标词直接进生词本（跳过「待选」） */
  autoVocabDirect: boolean
  setAutoVocabDirect: (v: boolean) => void
  /** 每天引入新词上限（0 = 不限） */
  newLimit: number
  setNewLimit: (v: number) => void
  /** 今天已引入多少个（跨天自动归零） */
  newToday: number
  setNewToday: (v: number | ((prev: number) => number)) => void
}

export function useReaderPrefs(): ReaderPrefs {
  const [fontSize, setFontSize] = useLocalStorageState('reader:size', 'md', persistentString)
  const [bold, setBold] = useLocalStorageState('reader:bold', false, persistentBool)
  const [serif, setSerif] = useLocalStorageState('reader:serif', false, persistentBool)
  const [eye, setEye] = useLocalStorageState('reader:theme', false, {
    parse: (raw) => raw === 'green',
    serialize: (v) => (v ? 'green' : 'dark'),
  })
  /**
   * 顶栏宽度档位：默认「自适应」（约 72% 视窗，800–1800）。
   * 宽度本身由 `core/toolbarWidth` 算，这里只记住用户选的那一档；
   * 脏值（旧版本、手改）回到自适应，不会因为存了个怪值把顶栏撑坏。
   */
  const [toolbarWidth, setToolbarWidth] = useLocalStorageState<ToolbarWidth>('reader:toolbarWidth', 'auto', {
    parse: parseToolbarWidth,
    serialize: (v) => v,
  })
  /**
   * 顶栏行数：默认 4 行（文章 / 视图 / 动作 / 统计各一行）。
   * 分行规则在 `core/toolbarRows`，这里只记住档位。
   */
  const [toolbarRows, setToolbarRows] = useLocalStorageState<ToolbarRowMode>('reader:toolbarRows', 4, {
    parse: parseToolbarRows,
    serialize: (v) => String(v),
  })
  const [sideTab, setSideTab] = useLocalStorageState<SideTab>('reader:sideTab', 'overview', persistentEnum(SIDE_TABS, 'overview'))
  const [translateView, setTranslateView] = useLocalStorageState<TranslateView>(
    'reader:translateView',
    'off',
    persistentEnum(TRANSLATE_VIEWS, 'off'),
  )
  const [autoSpeak, setAutoSpeak] = useLocalStorageState('reader:autoSpeak', false, persistentBool)
  const [ttsVoice, setTtsVoice] = useLocalStorageState('reader:ttsVoice', DEFAULT_TTS_VOICE, persistentString)
  const [vocabLevel, setVocabLevel] = useLocalStorageState<VocabLevel>(
    'reader:vocabLevel',
    'cet6',
    persistentEnum(['cet4', 'cet6', 'kaoyan', 'ielts', 'ielts65'] as const, 'cet6'),
  )
  const [vocabView, setVocabView] = useLocalStorageState<'card' | 'table'>(
    'reader:vocabView',
    'card',
    persistentEnum(['card', 'table'] as const, 'card'),
  )
  const [vocabSort, setVocabSort] = useLocalStorageState<VocabSortBy>(
    'reader:vocabSort',
    'updatedAt',
    persistentEnum(['word', 'createdAt', 'updatedAt', 'due'] as const, 'updatedAt'),
  )
  const [dailyGoal, setDailyGoal] = useLocalStorageState('reader:dailyGoal', 20, persistentNumber)
  const [showLanguage, setShowLanguage] = useLocalStorageState('reader:showLanguage', false, persistentBool)
  const [confusableBatchSize, setConfusableBatchSize] = useLocalStorageState('reader:confusableBatch', 60, persistentNumber)
  const [aiPackScope, setAiPackScope] = useLocalStorageState<AiPackScope>(
    'reader:aiPackScope',
    'article',
    persistentEnum(AI_PACK_SCOPES, 'article'),
  )
  const [autoVocabDirect, setAutoVocabDirect] = useLocalStorageState('reader:autoVocabDirect', true, persistentBool)
  const [newLimit, setNewLimit] = useLocalStorageState('reader:newLimit', 20, persistentNumber)
  /**
   * 今天已引入多少：落盘时带上日期，跨天读回来自动归零。
   * 日期口径跟学习统计一致（本地 04:00 结算），页面一直开着也会在结算点归零。
   */
  const [newToday, setNewToday] = useLocalStorageState('reader:newToday', 0, {
    parse: (raw) => {
      try {
        const obj = JSON.parse(raw) as { day?: string; count?: number } | null
        return obj && obj.day === dayKeyLocal() && typeof obj.count === 'number' ? obj.count : 0
      } catch {
        return 0
      }
    },
    serialize: (count) => JSON.stringify({ day: dayKeyLocal(), count }),
  })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      const now = new Date()
      timer = setTimeout(() => {
        setNewToday(0)
        arm()
      }, Math.max(0, nextStudyDayStart(now).getTime() - now.getTime()))
    }
    arm()
    return () => clearTimeout(timer)
  }, [setNewToday])

  return {
    fontSize,
    setFontSize,
    bold,
    setBold,
    serif,
    setSerif,
    eye,
    setEye,
    toolbarWidth,
    setToolbarWidth,
    toolbarRows,
    setToolbarRows,
    sideTab,
    setSideTab,
    translateView,
    setTranslateView,
    autoSpeak,
    setAutoSpeak,
    ttsVoice,
    setTtsVoice,
    vocabLevel,
    setVocabLevel,
    vocabView,
    setVocabView,
    vocabSort,
    setVocabSort,
    dailyGoal,
    setDailyGoal,
    showLanguage,
    setShowLanguage,
    confusableBatchSize,
    setConfusableBatchSize,
    aiPackScope,
    setAiPackScope,
    autoVocabDirect,
    setAutoVocabDirect,
    newLimit,
    setNewLimit,
    newToday,
    setNewToday,
  }
}
