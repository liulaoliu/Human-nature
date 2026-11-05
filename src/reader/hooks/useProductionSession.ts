import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  buildProductionFeedbackPrompt,
  buildProductionPackPrompt,
  buildProductionTargets,
  checkProductionTargets,
  makeProductionTask,
  parseProductionFeedback,
  parseProductionPack,
  productionDocLemmas,
  type ProductionPrompt,
  type ProductionTarget,
  type ProductionTargetHit,
  type ProductionTask,
  type ProductionTargetPool,
} from '../../core/production'
import { addWritingRecord, writingRecordKey, type WritingFeedback, type WritingRecord } from '../../core/writing'
import type { VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'
import { useProductionSettings } from './useProductionSettings'

export type ProductionStage = 'setup' | 'playing' | 'done'

interface PacketPending {
  prompt: string
  allowed: ProductionTarget[]
  maxPrompts: number
  pool: ProductionTargetPool
}

interface FeedbackPending {
  prompt: string
  answer: string
  task: ProductionTask
  hits: ProductionTargetHit[]
  round: number
}

export interface UseProductionSessionParams {
  doc: ReaderDoc | null
  library: VocabLibrary
  articleIdentity: string
  articleTitle: string
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  recordActivity: (cat: ActivityCat, n?: number) => void
  flash: (message: string) => void
  /** 测试注入：AI 直连 / 是否配置了 key / 固定时间。 */
  runAi?: typeof runAiBatch
  aiStatus?: () => Promise<boolean>
  now?: () => Date
}

/**
 * 奶牛工棚的一组产出训练：
 *
 * 选词块 → AI 出中文情境 → 先写英文 → AI 批改 + 本地目标块硬校验
 * → 必须重写一版 → 下一题。每次提交复用 `writingHistory`（source='production'）落盘，
 * 所以历史、备份、导出、导入都不用另造一套。
 */
export function useProductionSession({
  doc,
  library,
  articleIdentity,
  articleTitle,
  writingHistory,
  setWritingHistory,
  recordActivity,
  flash,
  runAi = runAiBatch,
  aiStatus = fetchAiStatus,
  now = () => new Date(),
}: UseProductionSessionParams) {
  const { settings, update: updateSettings } = useProductionSettings()
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<ProductionStage>('setup')
  const [prompts, setPrompts] = useState<ProductionPrompt[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [previousFeedback, setPreviousFeedback] = useState<WritingFeedback | null>(null)
  const [hits, setHits] = useState<ProductionTargetHit[]>([])
  const [round, setRound] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState('')
  const [pasteKind, setPasteKind] = useState<'pack' | 'feedback' | ''>('')
  const [pendingPacket, setPendingPacket] = useState<PacketPending | null>(null)
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackPending | null>(null)
  const [poolInfo, setPoolInfo] = useState<ProductionTargetPool | null>(null)
  const [sessionTopic, setSessionTopic] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const current = prompts[index] ?? null
  const history = useMemo(
    () =>
      writingHistory
        .filter((r) => r.source === 'production' && (!articleIdentity || r.articleId === articleIdentity))
        .slice(0, 8),
    [writingHistory, articleIdentity],
  )

  const ensureAi = useCallback(async () => {
    if (configured !== null) return configured
    const ready = await aiStatus()
    setConfigured(ready)
    return ready
  }, [configured, aiStatus])

  const callAi = useCallback(
    async (task: string, prompt: string): Promise<string> => {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const out = await runAi(
          [{ id: `production-${Date.now().toString(36)}`, task, prompt }],
          { signal: controller.signal },
        )
        const raw = out.results[0]?.raw
        if (!raw) throw new Error(out.failed[0]?.error || 'AI 没有返回结果')
        return raw
      } finally {
        abortRef.current = null
      }
    },
    [runAi],
  )

  const copy = useCallback(async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      return true
    } catch {
      setError('复制失败：浏览器需要 localhost 或 https')
      return false
    }
  }, [])

  const resetAnswer = useCallback(() => {
    setAnswer('')
    setFeedback(null)
    setPreviousFeedback(null)
    setHits([])
    setRound(1)
    setPasteKind('')
    setPendingFeedback(null)
    setError('')
  }, [])

  const applyPrompts = useCallback(
    (next: ProductionPrompt[], pool: ProductionTargetPool) => {
      setPrompts(next)
      setPoolInfo(pool)
      setIndex(0)
      resetAnswer()
      setStage('playing')
      setPasteKind('')
      setPendingPacket(null)
      setError('')
    },
    [resetAnswer],
  )

  const start = useCallback(async () => {
    const topic = settings.topic.trim()
    if (!topic) {
      flash('先写一个主题，再让 D老师出题')
      return
    }
    if (!settings.types.length) {
      flash('至少选一种目标块类型')
      return
    }
    const docLemmas = productionDocLemmas(doc?.sentences)
    let pool = buildProductionTargets({
      items: library.items,
      scope: settings.scope,
      articleIdentity,
      docLemmas,
      types: settings.types,
      limit: settings.promptCount * settings.targetsPerPrompt,
      weakRatio: settings.weakRatio,
    })
    if (!pool.targets.length && settings.scope === 'article') {
      pool = buildProductionTargets({
        items: library.items,
        scope: 'all',
        articleIdentity,
        docLemmas,
        types: settings.types,
        limit: settings.promptCount * settings.targetsPerPrompt,
        weakRatio: settings.weakRatio,
      })
      if (pool.targets.length) flash('本篇没有可用目标块，已改用全库')
    }
    if (!pool.targets.length) {
      flash('没有可用目标块：先学点词 / 词组，或换成全库范围')
      return
    }

    const per = Math.min(settings.targetsPerPrompt, Math.max(1, pool.targets.length))
    const count = Math.max(1, Math.min(settings.promptCount, Math.floor(pool.targets.length / per) || 1))
    if (pool.targets.length < settings.promptCount * settings.targetsPerPrompt) {
      flash(`可用目标块只有 ${pool.targets.length} 个，这次先出 ${count} 道 × ${per} 个`)
    }

    setSessionTopic(topic)
    const prompt = buildProductionPackPrompt({
      topic,
      angle: settings.angle,
      tone: settings.tone,
      articleTitle,
      targets: pool.targets,
      promptCount: count,
      targetsPerPrompt: per,
    })
    setPendingPacket({ prompt, allowed: pool.targets, maxPrompts: count, pool })
    setError('')

    if (!(await ensureAi())) {
      setPasteKind('pack')
      if (await copy(prompt)) flash('已复制出题提示词；把 AI 返回的 JSON 粘到下面')
      return
    }

    setGenerating(true)
    try {
      const raw = await callAi('production_pack', prompt)
      const parsed = parseProductionPack(raw, pool.targets, count)
      if (!parsed) {
        setError('AI 没有返回可用的题目。需要 JSON：{"prompts":[{"zh","goal","targetIds"}]}')
        return
      }
      applyPrompts(parsed, pool)
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setPasteKind('pack')
    } finally {
      setGenerating(false)
    }
  }, [settings, doc, library.items, articleIdentity, articleTitle, flash, ensureAi, copy, callAi, applyPrompts])

  const applyPacketPaste = useCallback(
    (raw: string) => {
      if (!pendingPacket) return
      const parsed = parseProductionPack(raw, pendingPacket.allowed, pendingPacket.maxPrompts)
      if (!parsed) {
        setError('没解析出题目：检查 JSON 里的 prompts / zh / targetIds，且 targetIds 必须来自候选清单')
        return
      }
      applyPrompts(parsed, pendingPacket.pool)
    },
    [pendingPacket, applyPrompts],
  )

  const applyFeedback = useCallback(
    (parsed: NonNullable<ReturnType<typeof parseProductionFeedback>>, pending: FeedbackPending) => {
      const rec: WritingRecord = {
        at: now().toISOString(),
        articleId: articleIdentity || 'manual',
        ...(articleTitle ? { articleTitle } : {}),
        model: pending.task.model,
        text: pending.answer,
        feedback: parsed.feedback,
        // `WritingRecord.task` 的静态形状是 ImitationTask；production 的 hits 作为
        // 附加快照随 JSON 落盘，历史页用 `isProductionTask` 运行时守卫读取。
        task: { ...pending.task, hits: pending.hits, round: pending.round } as typeof pending.task,
        source: 'production',
      }
      const key = writingRecordKey(rec)
      setWritingHistory((h) =>
        h.some((r) => writingRecordKey(r) === key) ? h : addWritingRecord(h, rec),
      )
      recordActivity('write', 1)
      setFeedback(parsed.feedback)
      setPreviousFeedback(parsed.feedback)
      setHits(pending.hits)
      setRound(pending.round)
      setPasteKind('')
      setPendingFeedback(null)
      setError('')
    },
    [articleIdentity, articleTitle, now, setWritingHistory, recordActivity],
  )

  const grade = useCallback(async () => {
    if (!current) {
      flash('这一题还没有题面')
      return
    }
    const text = answer.trim()
    if (!text) {
      flash('先写一句英文再批改')
      return
    }
    const task = makeProductionTask(current, sessionTopic)
    const nextHits = checkProductionTargets(text, current.targets)
    const prompt = buildProductionFeedbackPrompt(
      task,
      text,
      round > 1 && previousFeedback?.issues.length ? previousFeedback.issues : undefined,
    )
    const pending: FeedbackPending = { prompt, answer: text, task, hits: nextHits, round }
    setPendingFeedback(pending)
    setError('')

    if (!(await ensureAi())) {
      setPasteKind('feedback')
      if (await copy(prompt)) flash('已复制批改提示词；把 AI 返回的 JSON 粘到下面')
      return
    }

    setGrading(true)
    try {
      const raw = await callAi('feedback', prompt)
      const parsed = parseProductionFeedback(raw, text)
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON（version / scores / issues / polished / summary）')
        return
      }
      applyFeedback(parsed, pending)
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setPasteKind('feedback')
    } finally {
      setGrading(false)
    }
  }, [current, answer, sessionTopic, round, previousFeedback, ensureAi, copy, callAi, flash, applyFeedback])

  const applyFeedbackPaste = useCallback(
    (raw: string) => {
      if (!pendingFeedback) return
      const parsed = parseProductionFeedback(raw, pendingFeedback.answer)
      if (!parsed) {
        setError('没解析出批改结果：需要 v2 JSON（version / scores / issues / polished / summary）')
        return
      }
      applyFeedback(parsed, pendingFeedback)
    },
    [pendingFeedback, applyFeedback],
  )

  const applyPaste = useCallback(
    (raw: string) => {
      if (pasteKind === 'pack') applyPacketPaste(raw)
      else if (pasteKind === 'feedback') applyFeedbackPaste(raw)
    },
    [pasteKind, applyPacketPaste, applyFeedbackPaste],
  )

  const copyPromptAgain = useCallback(async () => {
    const prompt = pasteKind === 'pack' ? pendingPacket?.prompt : pendingFeedback?.prompt
    if (!prompt) return
    await copy(prompt)
  }, [pasteKind, pendingPacket, pendingFeedback, copy])

  const rewrite = useCallback(() => {
    if (!feedback || round >= 2) return
    setPreviousFeedback(feedback)
    setFeedback(null)
    setHits([])
    setRound(2)
    setPasteKind('')
    setError('')
  }, [feedback, round])

  const next = useCallback(() => {
    if (!feedback) {
      flash('先重写一版并批改，再进下一题')
      return
    }
    if (round < 2) {
      flash('先按批改意见重写一版，再进下一题')
      return
    }
    if (index + 1 >= prompts.length) {
      setStage('done')
      return
    }
    setIndex((i) => i + 1)
    resetAnswer()
  }, [feedback, round, index, prompts.length, flash, resetAnswer])

  const restart = useCallback(() => {
    setStage('setup')
    setPrompts([])
    setPoolInfo(null)
    setIndex(0)
    resetAnswer()
  }, [resetAnswer])

  const openProduction = useCallback(() => {
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setGenerating(false)
    setGrading(false)
    setPasteKind('')
    setPendingFeedback(null)
    setOpen(false)
    setError('')
  }, [])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setGenerating(false)
    setGrading(false)
  }, [])

  return {
    open,
    articleTitle,
    openProduction,
    close,
    stage,
    settings,
    updateSettings,
    start,
    restart,
    current,
    prompts,
    index,
    answer,
    setAnswer,
    feedback,
    previousFeedback,
    hits,
    round,
    rewrite,
    grade,
    next,
    generating,
    grading,
    error,
    pasteKind,
    applyPaste,
    copyPromptAgain,
    pendingPrompt: pasteKind === 'pack' ? pendingPacket?.prompt : pendingFeedback?.prompt,
    poolInfo,
    history,
    cancelRun,
  }
}
