import { useMemo } from 'react'
import type { SavedArticle, VocabItem } from '../../types/document'
import {
  dueForecast,
  last7Days,
  pickDayStats,
  sessionTotals,
  studyTotals,
  wordsByArticle,
  type PickSession,
  type StudyDay,
} from '../../core/vocabStats'
import { countWritesOnDay, type WritingRecord } from '../../core/writing'
import { isWordEntry } from '../../core/entryKind'
import { lemmaOf, normalizeWord } from '../../core/vocab'
import type { BatchItem } from '../panels/SidePick'

/** `useReaderDerived` 的输入：都是一次渲染里已经拿到的值，hook 只做纯派生。 */
export interface ReaderDerivedInput {
  /** 词库条目（`library.items`） */
  items: VocabItem[]
  /** 选词模式会话（每次开关记一条） */
  sessions: PickSession[]
  /** 背单词按天累计 */
  studyDays: StudyDay[]
  /** 本轮还没落盘的背词秒数（显示时叠加，不写回） */
  studyUnflushed: number
  /** 逻辑「今天」（`core/activity.ts` 的 `dayKeyLocal`） */
  todayKey: string
  /** 仿写历史 */
  writingHistory: WritingRecord[]
  /** 已保存文章列表 */
  saved: SavedArticle[]
  /** 一次生成多少混淆项（0 = 全部） */
  confusableBatchSize: number
  /** 当前文章的「待选」清单 */
  batch: BatchItem[]
  /** 已在词库里的 lemma（待选去重用） */
  libraryLemmas: Set<string>
  /** 测试用固定「现在」；不传则按上次重算时的当前时间 */
  now?: Date
}

const hasIngEd = (s: string) => s.split(/\s+/).some((t) => /(ing|ed)$/i.test(t))

/**
 * 阅读页的「派生统计簇」：会话累计、背词统计、到期预测、按文章产出、
 * AI 候选、待选过滤。**全部是纯派生**，不读写任何存储，因此可以安全地
 * 用 `useMemo` 缓存；状态本身仍由各自的 hook 持有（单一写入方）。
 */
export function useReaderDerived(input: ReaderDerivedInput) {
  const {
    items,
    sessions,
    studyDays,
    studyUnflushed,
    todayKey,
    writingHistory,
    saved,
    confusableBatchSize,
    batch,
    libraryLemmas,
    now,
  } = input
  const nowMs = now?.getTime()
  // `now` 只取时间戳进依赖：调用方每次新建 Date 也不会白重算。
  const at = () => (nowMs === undefined ? new Date() : new Date(nowMs))

  const totals = useMemo(() => sessionTotals(sessions), [sessions])

  /** 背单词时长统计：累计 / 今日 / 评分次数；显示时加上本轮尚未落盘的部分。 */
  const studyStats = useMemo(() => studyTotals(studyDays, todayKey), [studyDays, todayKey])

  /** 今日计划用：今天背了几张、写了几条。 */
  const todayCards = useMemo(() => studyDays.find((d) => d.day === todayKey)?.cards ?? 0, [studyDays, todayKey])
  const todayWrites = useMemo(() => countWritesOnDay(writingHistory, todayKey), [writingHistory, todayKey])

  /** 按天统计：今天选了多少 + 连续打卡天数。 */
  const dayStats = useMemo(
    () => pickDayStats(sessions, at()),
    [sessions, nowMs],
  )

  /** 最近 7 天每天选了多少词（统计面板用）。 */
  const last7 = useMemo(
    () => last7Days(sessions, at()),
    [sessions, nowMs],
  )

  /** 未来 30 天每天的到期词数（到期日历热力图用）。 */
  const dueForecastRows = useMemo(
    () => dueForecast(items, at()),
    [items, nowMs],
  )

  /** 已保存文章按「书」分组（EPUB 导入的用书名）。 */
  const savedGroups = useMemo(() => {
    const map = new Map<string, SavedArticle[]>()
    for (const a of saved) {
      const b = a.book || '单篇'
      const arr = map.get(b)
      if (arr) arr.push(a)
      else map.set(b, [a])
    }
    return [...map.entries()]
  }, [saved])

  /** 按文章统计生词产出（Top 10）。 */
  const byArticle = useMemo(() => wordsByArticle(items), [items])

  /** 还缺 AI 混淆项、且有释义的词（生成干扰项用）。 */
  const confusableTodo = useMemo(
    () => items.filter((it) => isWordEntry(it) && it.meaning && !it.confusables?.length),
    [items],
  )
  /** 一次生成多少（可自选；0=全部）；应用后再点，处理下一批。 */
  const confusableBatch = useMemo(
    () => (confusableBatchSize > 0 ? confusableTodo.slice(0, confusableBatchSize) : confusableTodo),
    [confusableTodo, confusableBatchSize],
  )

  /** 疑似「非原型」的词（word 与 lemma 不一致）——供 AI 校正原形。 */
  const lemmaCandidates = useMemo(
    () => items.filter((it) => isWordEntry(it) && normalizeWord(it.word) !== it.lemma).slice(0, 100),
    [items],
  )

  /** 含 -ing / -ed 形式的词或短语——供 AI 辨析语法身份。 */
  const posCandidates = useMemo(
    () =>
      items
        .filter((it) => isWordEntry(it) && (hasIngEd(it.word) || normalizeWord(it.word) !== it.lemma))
        .slice(0, 60),
    [items],
  )

  /** 待选里「还没入库」的词（已入库的隐藏，避免和生词本重复）。 */
  const visibleBatch = useMemo(
    () => batch.filter((b) => !libraryLemmas.has(lemmaOf(b.word))),
    [batch, libraryLemmas],
  )

  const studyTotalSeconds = studyStats.totalSeconds
  const studyTotalCards = studyStats.totalCards
  const studyTodaySeconds = studyStats.todaySeconds
  const studyGrandSeconds = studyTotalSeconds + studyUnflushed

  return {
    totals,
    studyStats,
    studyTotalSeconds,
    studyTotalCards,
    studyTodaySeconds,
    studyGrandSeconds,
    todayCards,
    todayWrites,
    dayStats,
    last7,
    dueForecastRows,
    savedGroups,
    byArticle,
    confusableTodo,
    confusableBatch,
    lemmaCandidates,
    posCandidates,
    visibleBatch,
  }
}
