import { useCallback, useState } from 'react'
import { buildYogurtPromptsFromPairs, type YogurtPair } from '../../core/productionPrompts'
import {
  PRODUCTION_MODE_LABEL,
  type ProductionMode,
  type ProductionProgressLike,
  type ProductionSettings,
} from '../../core/production'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import {
  newProductionSessionId,
  parsePacketPaste,
  runTargetStart,
  runTopicStart,
  runYogurtStart,
  type PendingPacket,
  type ProductionStartPayload,
} from './productionPackRuns'

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
  /** 清草稿：只清指定吃法那一组，别的吃法暂停着的那组不动。 */
  clearDraft: (mode: ProductionMode) => void
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
    // 只清这一种吃法自己的草稿：风味酸奶暂停着去开全脂，那边那组要留着
    clearDraft(mode)
    const ctx = {
      settings,
      doc,
      library,
      articleIdentity,
      articleTitle,
      progress,
      now,
      sessionId,
      flash,
      ensureAi,
      callAi,
      copy,
      onStart,
    }
    const state = { setGenerating, setPackError, setPasteKind, setPendingPacket }
    if (mode === 'yogurt') return runYogurtStart(ctx)
    const useChunks = mode === 'full' ? settings.fullUseChunks : settings.skimUseChunks
    return useChunks ? runTargetStart(ctx, state) : runTopicStart(ctx, state)
  }, [settings, doc, library, articleIdentity, articleTitle, progress, now, flash, ensureAi, callAi, copy, clearDraft, onStart])

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
      clearDraft('yogurt')
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
    (raw: string): boolean => {
      if (!pendingPacket) return false
      const parsed = parsePacketPaste(pendingPacket, raw, settings.variant !== 'translate')
      if (!parsed.ok) {
        setPackError(parsed.error)
        return false
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
      return true
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
