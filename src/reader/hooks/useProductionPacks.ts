import { useCallback, useState } from 'react'
import {
  buildProductionPackPrompt,
  buildTopicPackPrompt,
  buildYogurtPrompts,
  buildYogurtPromptsFromPairs,
  parseProductionPack,
  parseTopicPack,
  validateProductionPack,
  validateTopicPack,
  type YogurtPair,
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

interface PacketPending {
  kind: 'topic' | 'target'
  prompt: string
  mode: ProductionMode
  topic: string
  allowed: ProductionTarget[]
  maxPrompts: number
  targetsPerPrompt: number
  pool: ProductionTargetPool
}

export interface ProductionStartPayload {
  prompts: ProductionPrompt[]
  pool: ProductionTargetPool
  sessionId: string
  mode: ProductionMode
  topic: string
  notice: string
}

export interface UseProductionPacksParams {
  settings: ProductionSettings
  doc: ReaderDoc | null
  library: VocabLibrary
  articleIdentity: string
  articleTitle: string
  progress: readonly ProductionProgressLike[]
  now: () => Date
  flash: (message: string) => void
  ensureAi: () => Promise<boolean>
  callAi: (task: string, prompt: string) => Promise<string>
  copy: (prompt: string) => Promise<boolean>
  clearDraft: () => void
  onStart: (payload: ProductionStartPayload) => void
}

/**
 * 出题包：选目标块 / 拼提示词 / 调 AI / 校验重试 / 粘贴回填。
 * 只产出「一组 prompts + pool」交给会话状态机，不碰作答与批改。
 */
export function useProductionPacks({
  settings,
  doc,
  library,
  articleIdentity,
  articleTitle,
  progress,
  now,
  flash,
  ensureAi,
  callAi,
  copy,
  clearDraft,
  onStart,
}: UseProductionPacksParams) {
  const [generating, setGenerating] = useState(false)
  const [packError, setPackError] = useState('')
  const [pasteKind, setPasteKind] = useState<'' | 'pack'>('')
  const [pendingPacket, setPendingPacket] = useState<PacketPending | null>(null)

  const reset = useCallback(() => {
    setGenerating(false)
    setPackError('')
    setPasteKind('')
    setPendingPacket(null)
  }, [])

  const start = useCallback(async () => {
    setPackError('')
    setPasteKind('')
    setPendingPacket(null)
    const mode = settings.mode
    const sessionId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    clearDraft()
    if (mode === 'yogurt') {
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
        mode,
        topic: PRODUCTION_MODE_LABEL.yogurt,
        notice: yogurt.warning,
      })
      return
    }

    const topic = settings.topic.trim()
    if (mode === 'skim' && !topic) {
      flash('脱脂奶需要先写一个主题')
      return
    }
    const useChunks = mode === 'full' ? settings.fullUseChunks : settings.skimUseChunks

    if (!useChunks) {
      const count = settings.promptCount
      const prompt = buildTopicPackPrompt({
        topic,
        angle: settings.angle,
        tone: settings.tone,
        level: settings.level,
        articleTitle,
        promptCount: count,
        randomTopic: mode === 'full',
      })
      const topicLabel = mode === 'full' ? `${PRODUCTION_MODE_LABEL.full}随机` : topic
      setPendingPacket({
        kind: 'topic',
        prompt,
        mode,
        topic: topicLabel,
        allowed: [],
        maxPrompts: count,
        targetsPerPrompt: 0,
        pool: { targets: [], total: 0, weak: 0 },
      })
      setPackError('')
      if (!(await ensureAi())) {
        setPasteKind('pack')
        if (await copy(prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
        return
      }
      setGenerating(true)
      try {
        let parsed = parseTopicPack(await callAi('production_topic', prompt), count)
        let quality = parsed ? validateTopicPack(parsed, count) : { ok: false, reason: '没有解析出 prompts' }
        if (!parsed || !quality.ok) {
          flash(`AI 输出不合格（${quality.reason}），已自动重试一次`)
          parsed = parseTopicPack(
            await callAi(
              'production_topic',
              `${prompt}\n\n上次输出不合格：${quality.reason}。请重新输出完整 JSON。`,
            ),
            count,
          )
          quality = parsed ? validateTopicPack(parsed, count) : { ok: false, reason: '没有解析出 prompts' }
        }
        if (!parsed) {
          setPackError(`AI 没有返回可用的题目：${quality.reason}`)
          setPasteKind('pack')
          return
        }
        if (!quality.ok) {
          setPackError(`AI 题目不合格：${quality.reason}。可以重试，或复制提示词粘回。`)
          setPasteKind('pack')
          return
        }
        setPendingPacket(null)
        setPasteKind('')
        onStart({
          prompts: parsed,
          pool: { targets: [], total: 0, weak: 0 },
          sessionId,
          mode,
          topic: topicLabel,
          notice: '',
        })
      } catch (e) {
        setPackError(String((e as Error)?.message || e))
        setPasteKind('pack')
      } finally {
        setGenerating(false)
      }
      return
    }

    if (!settings.types.length) {
      flash('至少选一种目标块类型')
      return
    }
    const docLemmas = productionDocLemmas(doc?.sentences)
    const requested = settings.promptCount * settings.targetsPerPrompt
    const targetLimit =
      settings.scope === 'due' ? Math.min(requested, PRODUCTION_DUE_DAILY_CAP) : requested
    let pool = buildProductionTargets({
      items: library.items,
      scope: settings.scope,
      articleIdentity,
      docLemmas,
      types: settings.types,
      limit: targetLimit,
      weakRatio: settings.weakRatio,
      theme: settings.topic.trim(),
      progress,
      nowIso: now().toISOString(),
    })
    if (!pool.targets.length && settings.scope === 'article') {
      pool = buildProductionTargets({
        items: library.items,
        scope: 'all',
        articleIdentity,
        docLemmas,
        types: settings.types,
        limit: targetLimit,
        weakRatio: settings.weakRatio,
        theme: settings.topic.trim(),
        progress,
        nowIso: now().toISOString(),
      })
      if (pool.targets.length) flash('本篇没有可用目标块，已改用全库')
    }
    if (pool.note) flash(pool.note)
    if (!pool.targets.length) {
      flash('没有可用目标块：先学点词 / 词组，或换成全库范围')
      return
    }

    const per = Math.min(settings.targetsPerPrompt, Math.max(1, pool.targets.length))
    const count = Math.max(1, Math.min(settings.promptCount, Math.floor(pool.targets.length / per) || 1))
    const shortNotice =
      pool.targets.length < targetLimit
        ? `可用目标块只有 ${pool.targets.length} 个，这次先出 ${count} 道 × ${per} 个`
        : ''
    if (shortNotice) flash(shortNotice)

    const nextTopic = mode === 'full' ? `${PRODUCTION_MODE_LABEL.full}随机` : topic
    const prompt = buildProductionPackPrompt({
      mode,
      topic: nextTopic,
      angle: settings.angle,
      tone: settings.tone,
      level: settings.level,
      articleTitle,
      targets: pool.targets,
      promptCount: count,
      targetsPerPrompt: per,
    })
    setPendingPacket({
      kind: 'target',
      prompt,
      mode,
      topic: nextTopic,
      allowed: pool.targets,
      maxPrompts: count,
      targetsPerPrompt: per,
      pool,
    })
    setPackError('')

    if (!(await ensureAi())) {
      setPasteKind('pack')
      if (await copy(prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
      return
    }

    setGenerating(true)
    try {
      let parsed = parseProductionPack(await callAi('production_pack', prompt), pool.targets, count)
      const requireModel = settings.variant !== 'translate'
      let quality = parsed
        ? validateProductionPack(parsed, count, per, requireModel)
        : { ok: false, reason: '没有解析出 prompts' }
      if (!parsed || !quality.ok) {
        flash(`AI 输出不合格（${quality.reason}），已自动重试一次`)
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
      if (!parsed) {
        setPackError(`AI 没有返回可用的题目：${quality.reason}`)
        setPasteKind('pack')
        return
      }
      if (!quality.ok) {
        setPackError(`AI 题目不合格：${quality.reason}。可以重试，或复制提示词粘回。`)
        setPasteKind('pack')
        return
      }
      setPendingPacket(null)
      setPasteKind('')
      onStart({ prompts: parsed, pool, sessionId, mode, topic: nextTopic, notice: shortNotice })
    } catch (e) {
      setPackError(String((e as Error)?.message || e))
      setPasteKind('pack')
    } finally {
      setGenerating(false)
    }
  }, [
    settings,
    doc,
    library.items,
    articleIdentity,
    articleTitle,
    progress,
    now,
    flash,
    ensureAi,
    copy,
    callAi,
    clearDraft,
    onStart,
  ])

  const startYogurtPairs = useCallback(
    (pairs: readonly YogurtPair[], warning = '') => {
      setPackError('')
      setPasteKind('')
      setPendingPacket(null)
      const yogurt = buildYogurtPromptsFromPairs(
        pairs,
        settings.yogurtDirection,
        warning,
        settings.yogurtParagraph,
      )
      if (!yogurt) {
        flash('至少保留一对有内容的原文 / 参考译文')
        return
      }
      const sessionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      clearDraft()
      onStart({
        prompts: yogurt.prompts,
        pool: { targets: [], total: 0, weak: 0 },
        sessionId,
        mode: 'yogurt',
        topic: PRODUCTION_MODE_LABEL.yogurt,
        notice: warning,
      })
    },
    [settings.yogurtDirection, settings.yogurtParagraph, flash, clearDraft, onStart],
  )

  const applyPacketPaste = useCallback(
    (raw: string) => {
      if (!pendingPacket) return
      const parsed =
        pendingPacket.kind === 'topic'
          ? parseTopicPack(raw, pendingPacket.maxPrompts)
          : parseProductionPack(raw, pendingPacket.allowed, pendingPacket.maxPrompts)
      if (!parsed) {
        setPackError(
          pendingPacket.kind === 'topic'
            ? '没解析出题目：检查 JSON 里的 prompts / zh / goal'
            : '没解析出题目：检查 JSON 里的 prompts / zh / targetIds，且 targetIds 必须来自候选清单',
        )
        return
      }
      const quality =
        pendingPacket.kind === 'topic'
          ? validateTopicPack(parsed, pendingPacket.maxPrompts)
          : validateProductionPack(
              parsed,
              pendingPacket.maxPrompts,
              pendingPacket.targetsPerPrompt,
              settings.variant !== 'translate',
            )
      if (!quality.ok) {
        setPackError(`题目不合格：${quality.reason}`)
        return
      }
      setPasteKind('')
      setPendingPacket(null)
      setPackError('')
      // 粘贴结果沿用当前会话的 mode / topic 由外层决定；这里只带 pool。
      onStart({
        prompts: parsed,
        pool: pendingPacket.pool,
        sessionId:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `prod-${Date.now().toString(36)}`,
        mode: pendingPacket.mode,
        topic: pendingPacket.topic,
        notice: '',
      })
    },
    [pendingPacket, onStart, settings.variant],
  )

  const copyPromptAgain = useCallback(async () => {
    if (pendingPacket) await copy(pendingPacket.prompt)
  }, [pendingPacket, copy])

  return {
    start,
    startYogurtPairs,
    generating,
    packError,
    setPackError,
    packPasteKind: pasteKind,
    pendingPrompt: pendingPacket?.prompt ?? '',
    applyPacketPaste,
    copyPromptAgain,
    reset,
  }
}
