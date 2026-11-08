/**
 * 拷打结算页「用学过的内容造句」的**本机草稿**。
 *
 * 结算页每一题都是一个 `useGoldenImitation`，作答只活在组件 state 里；以前刷新一下
 * 就回到第 1 题、写好的句子全没了。这里按「这道题」存一份作答 + 当前停在第几题，
 * 刷新 / 关页再回来能原样接着写（题面照旧由 `core/drillSentence` 从考卷结果重算）。
 *
 * 和会话快照一样，读回来的东西属于外部输入：逐项校验，坏条目丢掉，整份坏掉就当没有。
 */
import { readJson, removeRaw, writeRaw } from '../reader/storage'

export const DRILL_SENTENCE_DRAFT_KEY = 'reader:drillSentenceDraft'
/** 只留最近的几轮：一轮拷打几十个词也够用，别让 localStorage 无限涨。 */
export const DRILL_DRAFT_CAP = 8

export interface DrillSentenceAnswerDraft {
  answer: string
  /** 第几稿：改写过就是 2。 */
  round: number
  at: string
}

export interface DrillSentenceDraft {
  /** `drillSentenceId`：同一批题（顺序无关）算同一个键。 */
  batchId: string
  activeIndex: number
  /** 按题目 id（= 单个点的 `drillSentenceId`）存作答。 */
  answers: Record<string, DrillSentenceAnswerDraft>
  at: string
}

export type DrillSentenceDraftMap = Record<string, DrillSentenceDraft>

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function parseAnswers(v: unknown): Record<string, DrillSentenceAnswerDraft> {
  const out: Record<string, DrillSentenceAnswerDraft> = {}
  if (!isObject(v)) return out
  for (const [key, raw] of Object.entries(v)) {
    if (!key || !isObject(raw) || typeof raw.answer !== 'string' || !raw.answer.trim()) continue
    out[key] = {
      answer: raw.answer,
      round: typeof raw.round === 'number' && raw.round > 1 ? 2 : 1,
      at: typeof raw.at === 'string' ? raw.at : '',
    }
  }
  return out
}

export function normalizeDrillSentenceDraft(raw: unknown): DrillSentenceDraft | null {
  if (!isObject(raw)) return null
  if (typeof raw.batchId !== 'string' || !raw.batchId) return null
  const activeIndex =
    typeof raw.activeIndex === 'number' && Number.isFinite(raw.activeIndex)
      ? Math.max(0, Math.floor(raw.activeIndex))
      : 0
  return {
    batchId: raw.batchId,
    activeIndex,
    answers: parseAnswers(raw.answers),
    at: typeof raw.at === 'string' ? raw.at : '',
  }
}

export function normalizeDrillSentenceDraftMap(raw: unknown): DrillSentenceDraftMap {
  const out: DrillSentenceDraftMap = {}
  if (!isObject(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    const draft = normalizeDrillSentenceDraft(value)
    if (draft) out[key] = draft
  }
  return out
}

export function readDrillSentenceDrafts(): DrillSentenceDraftMap {
  // 每次都真读盘：外部（测试、另一个标签页、备份导入）可能直接改 localStorage，
  // 缓存只服务「同一批题在同一轮里读很多次」，读写都发生在本模块内。
  readDrillSentenceDraftCache.clear()
  return normalizeDrillSentenceDraftMap(readJson<unknown>(DRILL_SENTENCE_DRAFT_KEY, null))
}

/** 读某一批题的作答；没有或坏掉都返回 null（调用方当作全新一轮）。 */
export function loadDrillSentenceDraft(batchId: string): DrillSentenceDraft | null {
  if (!batchId) return null
  const cached = readDrillSentenceDraftCache.get(batchId)
  if (cached !== undefined) return cached
  const draft = readDrillSentenceDrafts()[batchId] ?? null
  readDrillSentenceDraftCache.set(batchId, draft)
  return draft
}

/**
 * 同一份会话里重复读很频繁（每写一个字都要知道自己是不是有草稿），
 * 用这个缓存省掉反复 JSON.parse；写入 / 删除时同步刷新。
 */
const readDrillSentenceDraftCache = new Map<string, DrillSentenceDraft | null>()

/** 存某一批题：整份 map 里只留最近 `DRILL_DRAFT_CAP` 轮，旧轮先删再按时间倒序裁。 */
export function saveDrillSentenceDraft(draft: DrillSentenceDraft): void {
  const map = readDrillSentenceDrafts()
  map[draft.batchId] = draft
  const order = Object.keys(map).sort((a, b) => map[b]!.at.localeCompare(map[a]!.at))
  for (const key of order.slice(DRILL_DRAFT_CAP)) delete map[key]
  writeRaw(DRILL_SENTENCE_DRAFT_KEY, JSON.stringify(map))
  readDrillSentenceDraftCache.clear()
  readDrillSentenceDraftCache.set(draft.batchId, draft)
}

/** 整批做完 / 用户主动清空时删掉这一轮。 */
export function removeDrillSentenceDraft(batchId: string): void {
  const map = readDrillSentenceDrafts()
  if (!(batchId in map)) return
  delete map[batchId]
  if (!Object.keys(map).length) removeRaw(DRILL_SENTENCE_DRAFT_KEY)
  else writeRaw(DRILL_SENTENCE_DRAFT_KEY, JSON.stringify(map))
  readDrillSentenceDraftCache.clear()
}

/** 有没有存过这一轮的草稿（界面用来提示「这里接着上次」）。 */
export function hasDrillSentenceDraft(batchId: string): boolean {
  return loadDrillSentenceDraft(batchId) !== null
}
