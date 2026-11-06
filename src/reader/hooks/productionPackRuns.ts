import {
  buildProductionPackPrompt,
  parseProductionPack,
  parseTopicPack,
  validateProductionPack,
  validateTopicPack,
  buildTopicPackPrompt,
  buildYogurtPrompts,
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

/** 出题成功后交给会话层：题目、候选池、题组 id 与提示。 */
export interface ProductionStartPayload {
  prompts: ProductionPrompt[]
  pool: ProductionTargetPool
  sessionId: string
  mode: ProductionMode
  topic: string
  notice: string
}

/** 三种起跑方式共用的依赖；全部从 hook 参数传入，不新开读写口子。 */
export interface ProductionPackStartContext extends BuildTargetPackPlanInput {
  sessionId: string
  flash: (message: string) => void
  ensureAi: () => Promise<boolean>
  callAi: (task: string, prompt: string) => Promise<string>
  copy: (prompt: string) => Promise<boolean>
  onStart: (payload: ProductionStartPayload) => void
}

/** 起跑过程中要改的四个 React 状态，由 hook 提供 setter。 */
export interface ProductionPackStartState {
  setGenerating: (value: boolean) => void
  setPackError: (value: string) => void
  setPasteKind: (value: '' | 'pack') => void
  setPendingPacket: (value: PendingPacket | null) => void
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

/** 跑一次 AI 出题：自动重试提示、失败落回粘回框；成功才交给 onPrompts。 */
async function runPack(
  state: ProductionPackStartState,
  flash: (message: string) => void,
  run: () => Promise<PackRunResult>,
  onPrompts: (prompts: ProductionPrompt[]) => void,
): Promise<void> {
  state.setGenerating(true)
  try {
    const result = await run()
    if (result.retried) flash('AI 输出不合格，已自动重试一次')
    if (!result.prompts) {
      state.setPackError(result.error ?? 'AI 没有返回可用的题目')
      state.setPasteKind('pack')
      return
    }
    onPrompts(result.prompts)
  } catch (e) {
    state.setPackError(String((e as Error)?.message || e))
    state.setPasteKind('pack')
  } finally {
    state.setGenerating(false)
  }
}

/** 风味酸奶：本机拆句，不调 AI。 */
export async function runYogurtStart(ctx: ProductionPackStartContext): Promise<void> {
  const { settings, sessionId, flash, onStart } = ctx
  const yogurt = buildYogurtPrompts(
    settings.sourceText,
    settings.referenceText,
    settings.yogurtDirection,
    settings.yogurtSplit,
    settings.yogurtParagraph,
  )
  if (!yogurt) {
    flash('风味酸奶需要原文和参考译文；两边都要有内容')
    return
  }
  onStart({
    prompts: yogurt.prompts,
    pool: { targets: [], total: 0, weak: 0 },
    sessionId,
    mode: 'yogurt',
    topic: PRODUCTION_MODE_LABEL.yogurt,
    notice: yogurt.warning,
  })
}

/** 纯主题包（全脂随机主题 / 脱脂奶无词块）：AI 出题或复制提示词粘回。 */
export async function runTopicStart(
  ctx: ProductionPackStartContext,
  state: ProductionPackStartState,
): Promise<void> {
  const { settings, articleTitle, sessionId, flash, ensureAi, callAi, copy, onStart } = ctx
  if (settings.mode === 'skim' && !settings.topic.trim()) {
    flash('脱脂奶需要先写一个主题')
    return
  }
  const plan = buildTopicPackPlan(settings, articleTitle)
  state.setPendingPacket({
    kind: 'topic',
    prompt: plan.prompt,
    mode: plan.mode,
    topic: plan.topic,
    allowed: [],
    maxPrompts: plan.count,
    targetsPerPrompt: 0,
    pool: { targets: [], total: 0, weak: 0 },
  })
  if (!(await ensureAi())) {
    state.setPasteKind('pack')
    if (await copy(plan.prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
    return
  }
  await runPack(state, flash, () => runTopicPack(plan.prompt, plan.count, callAi), (prompts) => {
    state.setPendingPacket(null)
    state.setPasteKind('')
    onStart({
      prompts,
      pool: { targets: [], total: 0, weak: 0 },
      sessionId,
      mode: plan.mode,
      topic: plan.topic,
      notice: '',
    })
  })
}

/** 目标块包（全脂 / 脱脂奶带本机词块）：选池、硬校验、AI 出题或粘回。 */
export async function runTargetStart(
  ctx: ProductionPackStartContext,
  state: ProductionPackStartState,
): Promise<void> {
  const { settings, doc, library, articleIdentity, articleTitle, progress, now, sessionId, flash, ensureAi, callAi, copy, onStart } = ctx
  const planned = buildTargetPackPlan({
    settings,
    doc,
    library,
    articleIdentity,
    articleTitle,
    progress,
    now,
  })
  if (!planned.ok) {
    flash(planned.message)
    return
  }
  const plan = planned.plan
  for (const notice of plan.notices) flash(notice)
  if (plan.shortNotice) flash(plan.shortNotice)
  state.setPendingPacket({
    kind: 'target',
    prompt: plan.prompt,
    mode: plan.mode,
    topic: plan.topic,
    allowed: plan.pool.targets,
    maxPrompts: plan.count,
    targetsPerPrompt: plan.per,
    pool: plan.pool,
  })
  if (!(await ensureAi())) {
    state.setPasteKind('pack')
    if (await copy(plan.prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
    return
  }
  await runPack(
    state,
    flash,
    () =>
      runTargetPack({
        prompt: plan.prompt,
        pool: plan.pool,
        count: plan.count,
        per: plan.per,
        requireModel: settings.variant !== 'translate',
        callAi,
      }),
    (prompts) => {
      state.setPendingPacket(null)
      state.setPasteKind('')
      onStart({
        prompts,
        pool: plan.pool,
        sessionId,
        mode: plan.mode,
        topic: plan.topic,
        notice: plan.shortNotice,
      })
    },
  )
}
