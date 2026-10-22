import { useCallback, useMemo } from 'react'
import { inStudyDeck, isStudyable, type StudyDeck } from '../../core/entryKind'
import { hasReviewHistory, isDue, isFresh, type StudyMode } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { useLocalStorageState, persistentBool, persistentEnum, persistentNumber } from './useLocalStorageState'

/** 背单词范围。 */
export type StudyScope = 'all' | 'article' | 'unmastered' | 'lapses'

export interface UseStudyPoolOptions {
  library: VocabLibrary
  /** 当前文章标识（「本篇」范围按来源文件名 / 正文 lemma 匹配）。 */
  articleIdentity: string
  docLemmas: Set<string>
}

/**
 * 背单词的设置与候选池：范围 / 牌组 / 新学或复习 / 拼写 / 锤炼阈值，
 * 以及按这些设置过滤出的可背词、到期数、新词数。
 * 组队与评分不在这里（`useStudySession`）。
 */
export function useStudyPool({ library, articleIdentity, docLemmas }: UseStudyPoolOptions) {
  const [scope, setScope] = useLocalStorageState<StudyScope>(
    'reader:studyScope',
    'unmastered',
    persistentEnum(['all', 'article', 'unmastered', 'lapses'] as const, 'unmastered'),
  )
  const [spelling, setSpelling] = useLocalStorageState('reader:studySpelling', false, persistentBool)
  /** 单卡停留超过多少秒进入「强制锤炼」（0=关）。时间越长说明越难记。 */
  const [drillAfter, setDrillAfter] = useLocalStorageState('reader:studyDrillAfter', 60, persistentNumber)
  const [mode, setMode] = useLocalStorageState<StudyMode>(
    'reader:studyMode',
    'learn',
    persistentEnum(['learn', 'review'] as const, 'learn'),
  )
  /** 背单词 / 背搭配（词组·习语）。词组不再混在「背单词」里。 */
  const [deck, setDeck] = useLocalStorageState<StudyDeck>(
    'reader:studyDeck',
    'word',
    persistentEnum(['word', 'collocation'] as const, 'word'),
  )
  /**
   * 学习模式「每组 N 词」的组大小：组末要做拼写测试（本组学了多少就拼多少）。
   * 0 = 跟随范围——「本篇」= 本篇全部生词（Spec 2026-10-22：默认一篇一篇学）；
   * 其它范围 = 20。手动设了正数就用它（存本机）。
   */
  const [groupSize, setGroupSize] = useLocalStorageState('reader:studyGroupSize', 0, persistentNumber)

  /** 可背的：按当前牌组过滤；用法笔记（中文说明）不进卡片 */
  const studyable = useMemo(
    () => library.items.filter((it) => isStudyable(it) && inStudyDeck(it, deck)),
    [library.items, deck],
  )
  const poolFor = useCallback(
    (s: StudyScope, d: StudyDeck = deck) => {
      const base = d === deck ? studyable : library.items.filter((it) => inStudyDeck(it, d))
      if (s === 'all') return base
      if (s === 'lapses') return base.filter((it) => (it.reviewState.lapses ?? 0) > 0)
      if (s === 'unmastered') return base.filter((it) => it.status !== 'mastered')
      // 本篇：来源是本文，或词形出现在正文里（用预计算好的 lemma 集合，O(N)）
      return base.filter((it) => it.source?.fileName === articleIdentity || docLemmas.has(it.lemma))
    },
    [studyable, deck, articleIdentity, docLemmas],
  )
  const pool: VocabItem[] = useMemo(() => poolFor(scope), [poolFor, scope])
  const dueCount = useMemo(() => pool.filter((it) => hasReviewHistory(it) && isDue(it)).length, [pool])
  const newCount = useMemo(() => pool.filter(isFresh).length, [pool])

  /** 组大小生效值：手动设了就用；否则本篇 = 全部，其它范围 = 20。 */
  const effectiveGroupSize = useMemo(() => {
    if (groupSize > 0) return Math.floor(groupSize)
    return scope === 'article' ? Math.max(1, pool.length) : 20
  }, [groupSize, scope, pool.length])

  return {
    scope,
    setScope,
    spelling,
    setSpelling,
    drillAfter,
    setDrillAfter,
    mode,
    setMode,
    deck,
    setDeck,
    groupSize,
    setGroupSize,
    effectiveGroupSize,
    pool,
    poolFor,
    dueCount,
    newCount,
  }
}
