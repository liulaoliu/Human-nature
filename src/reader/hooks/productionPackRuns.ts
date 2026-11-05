import {
  buildProductionPackPrompt,
  parseProductionPack,
  parseTopicPack,
  validateProductionPack,
  validateTopicPack,
  buildTopicPackPrompt,
} from '../../core/productionPrompts'
import {
  buildProductionTargets,
  PRODUCTION_DUE_DAILY_CAP,
  PRODUCTION_MODE_LABEL,
  productionDocLemmas,
  type ProductionMode,
  type ProductionProgressLike,
  type ProductionPrompt,
  type ProductionSettings,
  type ProductionTarget,
  type ProductionTargetPool,
} from '../../core/production'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'

export function newProductionSessionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface TargetPackPlan {
  mode: Exclude<ProductionMode, 'yogurt'>
  topic: string
  prompt: string
  pool: ProductionTargetPool
  count: number
  per: number
  shortNotice: string
  notices: string[]
}

export type TargetPackPlanResult =
  | { ok: true; plan: TargetPackPlan }
  | { ok: false; message: string }

export interface BuildTargetPackPlanInput {
  settings: ProductionSettings
  doc: ReaderDoc | null
  library: VocabLibrary
  articleIdentity: string
  articleTitle: string
  progress: readonly ProductionProgressLike[]
  now: () => Date
}

/** 选目标块、算每题数量、拼出题提示词；纯计算，不碰 React 状态。 */
export function buildTargetPackPlan(input: BuildTargetPackPlanInput): TargetPackPlanResult {
  const { settings, doc, library, articleIdentity, articleTitle, progress, now } = input
  const mode = settings.mode === 'full' ? 'full' : 'skim'
  const topic = settings.topic.trim()
  if (!settings.types.length) return { ok: false, message: '至少选一种目标块类型' }

  const docLemmas = productionDocLemmas(doc?.sentences)
  const requested = settings.promptCount * settings.targetsPerPrompt
  const targetLimit = settings.scope === 'due' ? Math.min(requested, PRODUCTION_DUE_DAILY_CAP) : requested
  const notices: string[] = []
  const base = {
    items: library.items,
    articleIdentity,
    docLemmas,
    types: settings.types,
    limit: targetLimit,
    weakRatio: settings.weakRatio,
    theme: settings.topic.trim(),
    progress,
    nowIso: now().toISOString(),
  }
  let pool = buildProductionTargets({ ...base, scope: settings.scope })
  if (!pool.targets.length && settings.scope === 'article') {
    pool = buildProductionTargets({ ...base, scope: 'all' })
    if (pool.targets.length) notices.push('本篇没有可用目标块，已改用全库')
  }
  if (pool.note) notices.push(pool.note)
  if (!pool.targets.length) {
    return { ok: false, message: '没有可用目标块：先学点词 / 词组，或换成全库范围' }
  }

  const per = Math.min(settings.targetsPerPrompt, Math.max(1, pool.targets.length))
  const count = Math.max(1, Math.min(settings.promptCount, Math.floor(pool.targets.length / per) || 1))
  const shortNotice =
    pool.targets.length < targetLimit
      ? `可用目标块只有 ${pool.targets.length} 个，这次先出 ${count} 道 × ${per} 个`
      : ''
  const topicLabel = mode === 'full' ? `${PRODUCTION_MODE_LABEL.full}随机` : topic
  const prompt = buildProductionPackPrompt({
    mode,
    topic: topicLabel,
    angle: settings.angle,
    tone: settings.tone,
    level: settings.level,
    articleTitle,
    targets: pool.targets,
    promptCount: count,
    targetsPerPrompt: per,
  })
  return {
    ok: true,
    plan: { mode, topic: topicLabel, prompt, pool, count, per, shortNotice, notices },
  }
}

export interface TopicPackPlan {
  mode: Exclude<ProductionMode, 'yogurt'>
  topic: string
  prompt: string
  count: number
}

export function buildTopicPackPlan(
  settings: ProductionSettings,
  articleTitle: string,
): TopicPackPlan {
  const mode = settings.mode === 'full' ? 'full' : 'skim'
  const topic = settings.topic.trim()
  return {
    mode,
    topic: mode === 'full' ? `${PRODUCTION_MODE_LABEL.full}随机` : topic,
    prompt: buildTopicPackPrompt({
      topic,
      angle: settings.angle,
      tone: settings.tone,
      level: settings.level,
      articleTitle,
      promptCount: settings.promptCount,
      randomTopic: mode === 'full',
    }),
    count: settings.promptCount,
  }
}

export interface PackRunResult {
  prompts?: ProductionPrompt[]
  error?: string
  retried: boolean
}

/** 跑纯主题包：解析 → 校验 → 一次重试；只返回结果，不改 React 状态。 */
export async function runTopicPack(
  prompt: string,
  count: number,
  callAi: (task: string, prompt: string) => Promise<string>,
): Promise<PackRunResult> {
  let retried = false
  let parsed = parseTopicPack(await callAi('production_topic', prompt), count)
  let quality = parsed ? validateTopicPack(parsed, count) : { ok: false, reason: '没有解析出 prompts' }
  if (!parsed || !quality.ok) {
    retried = true
    parsed = parseTopicPack(
      await callAi(
        'production_topic',
        `${prompt}\n\n上次输出不合格：${quality.reason}。请重新输出完整 JSON。`,
      ),
      count,
    )
    quality = parsed ? validateTopicPack(parsed, count) : { ok: false, reason: '没有解析出 prompts' }
  }
  if (!parsed) return { error: `AI 没有返回可用的题目：${quality.reason}`, retried }
  if (!quality.ok) return { error: `AI 题目不合格：${quality.reason}。可以重试，或复制提示词粘回。`, retried }
  return { prompts: parsed, retried }
}

export interface RunTargetPackInput {
  prompt: string
  pool: ProductionTargetPool
  count: number
  per: number
  requireModel: boolean
  callAi: (task: string, prompt: string) => Promise<string>
}

/** 跑目标块包：解析 → 校验（数量 / 目标不重复 / model）→ 一次重试。 */
export async function runTargetPack(input: RunTargetPackInput): Promise<PackRunResult> {
  const { prompt, pool, count, per, requireModel, callAi } = input
  let retried = false
  let parsed = parseProductionPack(await callAi('production_pack', prompt), pool.targets, count)
  let quality = parsed
    ? validateProductionPack(parsed, count, per, requireModel)
    : { ok: false, reason: '没有解析出 prompts' }
  if (!parsed || !quality.ok) {
    retried = true
    parsed = parseProductionPack(
      await callAi(
        'production_pack',
        `${prompt}\n\n上次输出不合格：${quality.reason}。请重新输出完整 JSON。`,
      ),
      pool.targets,
      count,
    )
    quality = parsed
      ? validateProductionPack(parsed, count, per, requireModel)
      : { ok: false, reason: '没有解析出 prompts' }
  }
  if (!parsed) return { error: `AI 没有返回可用的题目：${quality.reason}`, retried }
  if (!quality.ok) return { error: `AI 题目不合格：${quality.reason}。可以重试，或复制提示词粘回。`, retried }
  return { prompts: parsed, retried }
}

export interface PendingPacket {
  kind: 'topic' | 'target'
  prompt: string
  mode: ProductionMode
  topic: string
  allowed: ProductionTarget[]
  maxPrompts: number
  targetsPerPrompt: number
  pool: ProductionTargetPool
}

export type PacketPasteResult =
  | { ok: true; prompts: ProductionPrompt[] }
  | { ok: false; error: string }

/** 粘贴题目包也走同一套校验；返回结果，由 hook 决定是否进会话。 */
export function parsePacketPaste(
  pending: PendingPacket,
  raw: string,
  requireModel: boolean,
): PacketPasteResult {
  const parsed =
    pending.kind === 'topic'
      ? parseTopicPack(raw, pending.maxPrompts)
      : parseProductionPack(raw, pending.allowed, pending.maxPrompts)
  if (!parsed) {
    return {
      ok: false,
      error:
        pending.kind === 'topic'
          ? '没解析出题目：检查 JSON 里的 prompts / zh / goal'
          : '没解析出题目：检查 JSON 里的 prompts / zh / targetIds，且 targetIds 必须来自候选清单',
    }
  }
  const quality =
    pending.kind === 'topic'
      ? validateTopicPack(parsed, pending.maxPrompts)
      : validateProductionPack(parsed, pending.maxPrompts, pending.targetsPerPrompt, requireModel)
  return quality.ok ? { ok: true, prompts: parsed } : { ok: false, error: `题目不合格：${quality.reason}` }
}
