import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LearningDayActivity, LearningOut } from './sqliteLearning.ts'
import { openStore } from './sqliteStore.ts'
import type { Store } from './sqliteStore.ts'

// 服务端持久层老测试共用的数据形状与访问器（两个 .test.ts 共用）。
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

// ── 被 store 当作 JSON 透传的数据形状 ──────────────────────────────
// `Store` 上这些读口都标成 unknown（服务端只负责存取，不做校验）。本文件断言的就是
// payload 里的真实字段，所以在这里把形状写出来，让断言用 `items` / `source.articleId`
// 这样的字段名，而不是把整条结果当 any。

export interface VocabItem {
  id: string
  word: string
  lemma: string
  kind?: string
  langPointId?: string
  phonetic?: string
  partOfSpeech?: string
  meaning?: string
  definition?: string
  usage?: string[]
  phrases?: string[]
  idioms?: string[]
  grammarMarks?: string[]
  examples?: Array<{ text: string; translation?: string; origin?: string; articleId?: string; sentenceId?: string }>
  contexts?: Array<{
    articleId?: string
    fileName?: string | null
    sentenceId?: string
    sentenceText?: string
    meaning?: string
    at?: string
  }>
  source?: {
    articleId?: string | null
    fileName?: string | null
    sentenceId?: string
    sentenceText?: string
  }
  status?: string
  note?: string
  tags?: string[]
  confusables?: Array<{ word: string; meaning: string }>
  reviewState?: {
    ease: number
    due: string | null
    interval: number
    repetitions: number
    lapses: number
  }
  createdAt?: string
  updatedAt?: string
}

/** 词库 payload：用例只关心条目列表，schemaVersion 只在部分用例里出现。 */
export interface VocabData {
  schemaVersion?: number
  items: VocabItem[]
}

/** 文章 payload：本文件只读 id / title / createdAt / updatedAt，其余字段构造后原样交给 store。 */
export interface ArticleData {
  id: string
  title: string
  sourceKey?: string | null
  book?: string
  text?: string
  paragraphs?: unknown[]
  sentences?: unknown[]
  createdAt?: string
  updatedAt?: string
}

export interface VocabSnapshotRecord {
  at: string
  count: number
  library: VocabData
}

/** `exportAll()` 的导出包形状（见 server/sqliteStore.ts 的 exportAll）。 */
export interface ExportDump {
  format: string
  version: number
  exportedAt: string
  vocab: VocabData | null
  vocabSnapshots: VocabSnapshotRecord[]
  articles: ArticleData[]
  learning: LearningOut
}

// ── 类型边界 ──────────────────────────────────────────────────────

/**
 * `mustOpen()` 在拿不到 `node:sqlite` 时返回 null（前端会回退 IndexedDB）；
 * 这些用例要的是真实文件库，null 就是环境坏了，直接抛错比每处写 `?.` 更清楚。
 */
export function mustOpen(dbPath: string): LegacyStore {
  const store = openStore(dbPath)
  if (!store) throw new Error(`openStore 返回 null：${dbPath}`)
  return store as unknown as LegacyStore
}

/**
 * 测试里的 store 视图：只把「读出来是 unknown」的那几个口收窄成上面写的数据形状，
 * 其余方法（写口本身收 unknown、快照元信息等）原样沿用 `Store`。
 */
export type LegacyStore = Omit<
  Store,
  | 'db'
  | 'loadVocab'
  | 'loadSnapshot'
  | 'migrateVocab'
  | 'listArticles'
  | 'getArticle'
  | 'exportAll'
  | 'migrateLearning'
  | 'rebuildLearningDerived'
> & {
  db: LegacyDb
  loadVocab(): VocabData | null
  loadSnapshot(at: string): VocabData | null
  migrateVocab(lib: unknown): { migrated: boolean; value: VocabData }
  listArticles(): ArticleData[]
  getArticle(id: string): ArticleData | null
  exportAll(): ExportDump
  migrateLearning(data: unknown): { migrated: boolean; value: LearningOut }
  rebuildLearningDerived(): LearningDayActivity[]
}

/**
 * 裸连接 / 语句：用例里的每条查询都在断言行必须存在（查不到就该失败），
 * 所以这里把 `get()` 的 `| undefined` 收窄成「一行」；真的查不到时后续断言会立刻报错。
 */
export type SqlRow = Record<string, unknown>
export type SqlParam = string | number | null

export interface LegacyStatement {
  get(...params: SqlParam[]): SqlRow
  all(...params: SqlParam[]): SqlRow[]
  run(...params: SqlParam[]): unknown
}

export interface LegacyDb {
  prepare(sql: string): LegacyStatement
  exec(sql: string): void
  close(): void
}

/** 直接开一个库（用例要执行 PRAGMA、造老库），类型收窄到本文件用到的几个方法。 */
export function openDb(dbPath: string, opts: { readOnly?: boolean } = {}): LegacyDb {
  return new DatabaseSync(dbPath, opts)
}

/** 词库内容（空库返回 null，用例 102 专门断这个）；需要读条目时用这个而不是 `!`。 */
export function vocab(store: LegacyStore): VocabData {
  const data = store.loadVocab()
  if (!data) throw new Error('词库为空')
  return data
}

/** 取一篇文章；用例断言的是「刚存进去的那篇」，null 说明 store 读口坏了。 */
export function mustArticle(store: LegacyStore, id: string): ArticleData {
  const article = store.getArticle(id)
  if (!article) throw new Error(`文章不存在：${id}`)
  return article
}

/** 取数组第 index 项；越界直接抛错，等价于断言「这里应该有值」。 */
export function at<T>(items: readonly T[], index: number): T {
  const value = items[index]
  if (value === undefined) throw new Error(`数组第 ${index} 项不存在`)
  return value
}

export function firstItem<T>(items: readonly T[]): T {
  return at(items, 0)
}

export const lib = (n: number): VocabData => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` })),
})

export function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), 'xueba-sqlite-')), 'xueba.db')
}


