/**
 * 拷打结算页「用学过的内容造句」草稿的**纯规则**：形状、校验、裁剪上限。
 *
 * 读写 localStorage 的部分在 `reader/drillSentenceDraft`（core 层不许依赖存储）。
 * 读回来的东西属于外部输入：逐项校验，坏条目丢掉，整份坏掉就当没有。
 */

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

/** 只留最近 `cap` 轮（按 `at` 倒序）；写入口径与读回口径共用这一份。 */
export function trimDrillSentenceDrafts(
  map: DrillSentenceDraftMap,
  cap = DRILL_DRAFT_CAP,
): DrillSentenceDraftMap {
  return Object.fromEntries(
    Object.entries(map)
      .sort(([, a], [, b]) => b.at.localeCompare(a.at))
      .slice(0, cap),
  )
}
