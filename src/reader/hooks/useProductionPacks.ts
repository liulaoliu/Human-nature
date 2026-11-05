import { useCallback, useState } from 'react'
import { buildYogurtPrompts, buildYogurtPromptsFromPairs, type YogurtPair } from '../../core/productionPrompts'
import {
  PRODUCTION_MODE_LABEL,
  type ProductionMode,
  type ProductionProgressLike,
  type ProductionPrompt,
  type ProductionSettings,
  type ProductionTargetPool,
} from '../../core/production'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import {
  buildTargetPackPlan,
  buildTopicPackPlan,
  newProductionSessionId,
  parsePacketPaste,
  runTargetPack,
  runTopicPack,
  type PendingPacket,
} from './productionPackRuns'

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
 * 具体选池、解析、重试在 `productionPackRuns`；这里只保留状态接线。
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
  const [pendingPacket, setPendingPacket] = useState<PendingPacket | null>(null)

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
    const sessionId = newProductionSessionId()
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

    const useChunks = mode === 'full' ? settings.fullUseChunks : settings.skimUseChunks
    const topic = settings.topic.trim()
    if (mode === 'skim' && !topic) {
      flash('脱脂奶需要先写一个主题')
      return
    }

    if (!useChunks) {
      const plan = buildTopicPackPlan(settings, articleTitle)
      setPendingPacket({
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
        setPasteKind('pack')
        if (await copy(plan.prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
        return
      }
      setGenerating(true)
      try {
        const run = await runTopicPack(plan.prompt, plan.count, callAi)
        if (run.retried) flash('AI 输出不合格，已自动重试一次')
        if (!run.prompts) {
          setPackError(run.error ?? 'AI 没有返回可用的题目')
          setPasteKind('pack')
          return
        }
        setPendingPacket(null)
        setPasteKind('')
        onStart({
          prompts: run.prompts,
          pool: { targets: [], total: 0, weak: 0 },
          sessionId,
          mode: plan.mode,
          topic: plan.topic,
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
    setPendingPacket({
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
      setPasteKind('pack')
      if (await copy(plan.prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
      return
    }

    setGenerating(true)
    try {
      const run = await runTargetPack({
        prompt: plan.prompt,
        pool: plan.pool,
        count: plan.count,
        per: plan.per,
        requireModel: settings.variant !== 'translate',
        callAi,
      })
      if (run.retried) flash('AI 输出不合格，已自动重试一次')
      if (!run.prompts) {
        setPackError(run.error ?? 'AI 没有返回可用的题目')
        setPasteKind('pack')
        return
      }
      setPendingPacket(null)
      setPasteKind('')
      onStart({
        prompts: run.prompts,
        pool: plan.pool,
        sessionId,
        mode: plan.mode,
        topic: plan.topic,
        notice: plan.shortNotice,
      })
    } catch (e) {
      setPackError(String((e as Error)?.message || e))
      setPasteKind('pack')
    } finally {
      setGenerating(false)
    }
  }, [settings, doc, library, articleIdentity, articleTitle, progress, now, flash, ensureAi, copy, callAi, clearDraft, onStart])

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
      clearDraft()
      onStart({
        prompts: yogurt.prompts,
        pool: { targets: [], total: 0, weak: 0 },
        sessionId: newProductionSessionId(),
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
      const parsed = parsePacketPaste(pendingPacket, raw, settings.variant !== 'translate')
      if (!parsed.ok) {
        setPackError(parsed.error)
        return
      }
      setPasteKind('')
      setPendingPacket(null)
      setPackError('')
      onStart({
        prompts: parsed.prompts,
        pool: pendingPacket.pool,
        sessionId: newProductionSessionId(),
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
