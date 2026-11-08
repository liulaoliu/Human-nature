/**
 * 拷打结算页「用学过的内容造句」的**本机草稿**（读写层）。
 *
 * 结算页每一题都是一个 `useGoldenImitation`，作答只活在组件 state 里；以前刷新一下
 * 就回到第 1 题、写好的句子全没了。这里按「这一批题」存一份作答 + 当前停在第几题，
 * 刷新 / 关页再回来能原样接着写（题面照旧由 `core/drillSentence` 从考卷结果重算）。
 *
 * 纯校验 / 裁剪规则在 `core/drillSentenceDraft`（不碰存储），本文件只管读写与缓存；
 * 放 `reader/` 而不是 `core/`，是因为核心层不许依赖 `reader/storage`（架构门禁 R1）。
 * 和会话快照一样，读回来的东西属于外部输入：逐项校验，坏条目丢掉，整份坏掉就当没有。
 */
import {
  DRILL_SENTENCE_DRAFT_KEY,
  normalizeDrillSentenceDraftMap,
  trimDrillSentenceDrafts,
  type DrillSentenceDraft,
  type DrillSentenceDraftMap,
} from '../core/drillSentenceDraft'
import { readJson, readRaw, removeRaw, writeRaw } from './storage'

export {
  DRILL_DRAFT_CAP,
  DRILL_SENTENCE_DRAFT_KEY,
  normalizeDrillSentenceDraft,
  normalizeDrillSentenceDraftMap,
  type DrillSentenceAnswerDraft,
  type DrillSentenceDraft,
  type DrillSentenceDraftMap,
} from '../core/drillSentenceDraft'

/**
 * 缓存**整份 map**，并且用「原始字符串」当指纹：
 * 同一份数据反复读时不重复 JSON.parse（结算页每打一个字都要问一次有没有草稿），
 * 而只要 localStorage 里的字符串变了（别的标签页写了、备份导入了、被清掉了），
 * 指纹对不上就重新解析 —— 缓存不会把过期内容一直喂给调用方。
 */
let cachedRaw: string | null = null
let cachedMap: DrillSentenceDraftMap = {}
let cacheValid = false

function draftsNow(): DrillSentenceDraftMap {
  const raw = readRaw(DRILL_SENTENCE_DRAFT_KEY)
  if (cacheValid && raw === cachedRaw) return cachedMap
  cachedRaw = raw
  cachedMap = normalizeDrillSentenceDraftMap(readJson<unknown>(DRILL_SENTENCE_DRAFT_KEY, null))
  cacheValid = true
  return cachedMap
}

/** 写入 / 删除后调用：下次读一定重新读盘。 */
function invalidate(): void {
  cacheValid = false
}

export function readDrillSentenceDrafts(): DrillSentenceDraftMap {
  return draftsNow()
}

/** 读某一批题的作答；没有或坏掉都返回 null（调用方当作全新一轮）。 */
export function loadDrillSentenceDraft(batchId: string): DrillSentenceDraft | null {
  if (!batchId) return null
  return draftsNow()[batchId] ?? null
}

/** 存某一批题：整份 map 里只留最近 `DRILL_DRAFT_CAP` 轮，旧的按时间倒序裁掉。 */
export function saveDrillSentenceDraft(draft: DrillSentenceDraft): void {
  const map = { ...draftsNow(), [draft.batchId]: draft }
  writeRaw(DRILL_SENTENCE_DRAFT_KEY, JSON.stringify(trimDrillSentenceDrafts(map)))
  invalidate()
}

/** 用户主动清空 / 换进度时删掉这一轮。 */
export function removeDrillSentenceDraft(batchId: string): void {
  const map = { ...draftsNow() }
  if (!(batchId in map)) return
  delete map[batchId]
  if (!Object.keys(map).length) removeRaw(DRILL_SENTENCE_DRAFT_KEY)
  else writeRaw(DRILL_SENTENCE_DRAFT_KEY, JSON.stringify(map))
  invalidate()
}

/** 有没有存过这一轮的草稿（界面用来提示「这里接着上次」）。 */
export function hasDrillSentenceDraft(batchId: string): boolean {
  return loadDrillSentenceDraft(batchId) !== null
}
