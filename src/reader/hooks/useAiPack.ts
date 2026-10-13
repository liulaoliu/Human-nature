import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AI_TASK_LABEL,
  buildAiJobs,
  buildJobPack,
  buildWebPackPrompt,
  countAiJobs,
  isAiJobTask,
  missingJobIds,
  parseAiResultPack,
  parseJobPack,
  parseWebPackResults,
} from '../../core/aiPackage'
import type { AiJob, AiJobTask, AiJobsInput, AiResultEntry } from '../../core/aiPackage'
import { dayKeyLocal } from '../../core/activity'
import { useLocalStorageState } from './useLocalStorageState'

export interface UseAiPackParams {
  jobsInput: AiJobsInput
  applyTaskResult: (
    task: AiJobTask | null,
    raw: string,
    askedWords: string[],
    askedIds: string[],
  ) => { report: string[]; ok: boolean }
  download: (name: string, content: string, mime: string) => void
  flash: (message: string) => void
  onReport: (lines: string[]) => void
}

/**
 * AI 工作包：把「复制提示词 → AI → 粘回」变成批量流程。
 *
 * 两条路：
 *  - 本机 agent：导出 `ai-jobs-*.json` → 喂给 agent → 结果 JSON 导回；
 *  - 网页版（DeepSeek 等）：复制一条「工作包提示词」去网页贴 → 整段回复贴回 → 应用；
 *    网页端可能截断/漏答，所以按「待处理」分批复制、跟踪进度（完成/缺项），并支持刷新。
 */
/** 一批任务包含的任务类型（去重，用于「第 N 轮 · 查词/补齐」这种提示）。 */
function phaseLabelOf(jobs: AiJob[]): string {
  const seen: AiJobTask[] = []
  for (const j of jobs) if (!seen.includes(j.task)) seen.push(j.task)
  return seen.map((t) => AI_TASK_LABEL[t] ?? t).join('、')
}

export function useAiPack({ jobsInput, applyTaskResult, download, flash, onReport }: UseAiPackParams) {
  const packRef = useRef<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 网页版每批任务数（0=全部一批）。 */
  const [webBatchSize, setWebBatchSize] = useState(6)
  /** 网页版进度：已复制过、已成功应用的任务 id（持久化，刷新不丢）。 */
  const [askedIds, setAskedIds] = useLocalStorageState<string[]>('reader:aiWebAsked', [])
  const [doneIds, setDoneIds] = useLocalStorageState<string[]>('reader:aiWebDone', [])
  /** 已应用过「自动标词」的文章 id（应用过就不再进默认待办）。 */
  const [autoVocabDone, setAutoVocabDone] = useLocalStorageState<string[]>('reader:autoVocabDone', [])
  /** agent 路径回执里缺的词（用于「复制未返回的」重试）。 */
  const [missingIds, setMissingIds] = useState<string[]>([])

  /** 「一键跑批」：服务端是否已配置 key / 是否在跑 / 进度 / 错误。 */
  const [localConfigured, setLocalConfigured] = useState<boolean | null>(null)
  const [localRunning, setLocalRunning] = useState(false)
  const [localDone, setLocalDone] = useState(0)
  const [localTotal, setLocalTotal] = useState(0)
  const [localRound, setLocalRound] = useState(0)
  const [localPhase, setLocalPhase] = useState('')
  const [localError, setLocalError] = useState('')

  /** 问一次服务端：key 配没配（接口只回布尔，不回 key）。 */
  useEffect(() => {
    let alive = true
    fetch('/api/ai/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setLocalConfigured(!!(d && d.configured)))
      .catch(() => alive && setLocalConfigured(false))
    return () => {
      alive = false
    }
  }, [])

  /** 有效输入：注入本篇的「自动标词已完成」标记。 */
  const jobsInputEff = useMemo<AiJobsInput>(
    () => ({ ...jobsInput, autoVocabDone: autoVocabDone.includes(jobsInput.articleId) }),
    [jobsInput, autoVocabDone],
  )

  /** 当前待办（顺序稳定，id 由内容决定、可复现）。 */
  const round = useMemo(() => buildAiJobs(jobsInputEff), [jobsInputEff])
  const jobCount = useMemo(() => countAiJobs(jobsInputEff), [jobsInputEff])

  const roundIdSet = useMemo(() => new Set(round.map((j) => j.id)), [round])
  const doneSet = useMemo(() => new Set(doneIds.filter((id) => roundIdSet.has(id))), [doneIds, roundIdSet])
  const askedSet = useMemo(() => new Set(askedIds.filter((id) => roundIdSet.has(id))), [askedIds, roundIdSet])

  const pending = useMemo(() => round.filter((j) => !doneSet.has(j.id)), [round, doneSet])
  const missing = useMemo(() => round.filter((j) => askedSet.has(j.id) && !doneSet.has(j.id)), [round, askedSet, doneSet])

  /** 按任务类型分组的全流程进度（完成/总数），顺序按首次出现。 */
  const webBreakdown = useMemo(() => {
    const order: AiJobTask[] = []
    const map = new Map<AiJobTask, { task: AiJobTask; label: string; done: number; total: number }>()
    for (const j of round) {
      let g = map.get(j.task)
      if (!g) {
        g = { task: j.task, label: AI_TASK_LABEL[j.task] ?? j.task, done: 0, total: 0 }
        map.set(j.task, g)
        order.push(j.task)
      }
      g.total++
      if (doneSet.has(j.id)) g.done++
    }
    return order.map((t) => map.get(t)!)
  }, [round, doneSet])

  /**
   * 工作待办检查：把「AI 任务进度」和「需要人工跟进的步骤」合成一张清单。
   * 关键是把「自动标词 → 待选 → 加入生词本 → 补查释义」这个断层显式列出来，
   * 免得跑完批处理以为完事、结果生词本还是空的。
   */
  const checklist = useMemo(() => {
    const items: { key: string; label: string; done: number; total: number; manual?: boolean }[] = []
    for (const g of webBreakdown) {
      items.push({ key: g.task, label: g.label, done: g.done, total: g.total })
    }
    if (jobsInput.batch.length) {
      items.push({ key: 'commitBatch', label: `待选入库（${jobsInput.batch.length} 词）`, done: 0, total: 1, manual: true })
    }
    return items
  }, [webBreakdown, jobsInput.batch])

  const checklistDone = useMemo(() => checklist.reduce((n, it) => n + it.done, 0), [checklist])
  const checklistTotal = useMemo(() => checklist.reduce((n, it) => n + it.total, 0), [checklist])

  /** 数据上真正还缺的待办里的词（用于提示「卡住的是哪些词」）。 */
  const todoWords = useMemo(() => {
    const words: string[] = []
    for (const j of round) {
      for (const w of j.askedWords) if (!words.includes(w)) words.push(w)
    }
    return words
  }, [round])

  /** 待办涉及的任务类型（用于提示是「查词/补齐」还是「用法示例」等）。 */
  const todoTasks = useMemo(
    () => [...new Set(round.map((j) => AI_TASK_LABEL[j.task] ?? j.task))],
    [round],
  )

  /**
   * 下一步该干嘛。判断「完成/还有几项」**以数据上真正还缺的 `round` 为准**，
   * 而不是「应用过」的 doneSet（pending）——否则某任务应用成功但没补全时，
   * 会被误判成「已完成」，还会把一键跑批禁用掉、连重跑都点不了。
   */
  const nextHint = useMemo(() => {
    if (jobsInput.batch.length) {
      return `待选有 ${jobsInput.batch.length} 个词还没进生词本：先点「加入生词本」，再跑一次批处理补齐音标/释义。`
    }
    if (localRunning) return `跑批中… 第 ${localRound} 轮 · ${localPhase || '处理中'}（${localDone}/${localTotal}）`
    if (round.length > 0) {
      const w = todoWords.length
        ? `（${todoWords.slice(0, 6).join('、')}${todoWords.length > 6 ? '…' : ''}）`
        : ''
      return `还有 ${round.length} 项待办【${todoTasks.join('、')}】${w}，可点「⚡ 一键跑批」。`
    }
    return '本篇待办已全部完成 🎉'
  }, [jobsInput.batch.length, localRunning, localRound, localPhase, localDone, localTotal, round.length, todoWords, todoTasks])

  /** 逐条应用结果；返回成功应用的 id（供网页版标记完成）。 */
  const applyResults = useCallback(
    (results: AiResultEntry[], jobs: AiJob[]) => {
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const lines: string[] = []
      const appliedIds: string[] = []
      let okCount = 0
      let failCount = 0
      for (const r of results) {
        const job = r.id ? byId.get(r.id) : undefined
        const task = job?.task ?? (isAiJobTask(r.task) ? r.task : null)
        if (!task) {
          lines.push(`跳过：找不到任务（id=${r.id || '无'}）`)
          failCount++
          continue
        }
        const res = applyTaskResult(task, r.raw, job?.askedWords ?? r.askedWords ?? [], job?.askedIds ?? r.askedIds ?? [])
        if (res.ok) {
          okCount++
          if (job) appliedIds.push(job.id)
        } else {
          failCount++
        }
        lines.push(`【${job?.label ?? task}】${res.report[0] ?? (res.ok ? '已应用' : '未解析')}`)
      }
      // 应用了「自动标词」→ 记下本篇已完成，之后不再进默认待办
      if (appliedIds.some((id) => jobs.find((j) => j.id === id)?.task === 'auto_vocab')) {
        setAutoVocabDone((prev) => (prev.includes(jobsInput.articleId) ? prev : [...prev, jobsInput.articleId]))
      }
      return { okCount, failCount, lines, appliedIds }
    },
    [applyTaskResult, jobsInput.articleId, setAutoVocabDone],
  )

  /** 给「一键跑批」串联多轮用：始终读到最新的输入 / 最新的应用逻辑（避免闭包读到旧值）。 */
  const jobsInputRef = useRef(jobsInputEff)
  useEffect(() => {
    jobsInputRef.current = jobsInputEff
  }, [jobsInputEff])
  const applyResultsRef = useRef(applyResults)
  useEffect(() => {
    applyResultsRef.current = applyResults
  }, [applyResults])

  // ---------- 本机 agent 路径 ----------

  const exportJobs = useCallback(() => {
    const jobs = buildAiJobs(jobsInputEff)
    if (!jobs.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    const pack = buildJobPack(jobs)
    const text = JSON.stringify(pack, null, 2)
    packRef.current = text
    try {
      localStorage.setItem('reader:aiJobPack', text)
    } catch {
      // 忽略
    }
    download(`ai-jobs-${dayKeyLocal(new Date())}.json`, text, 'application/json')
    flash(`已导出 ${jobs.length} 项待办（包内含结果格式说明）；整包交给 AI，把结果 JSON 导回`)
  }, [jobsInputEff, download, flash])

  const readResults = useCallback(
    async (file: File) => {
      const text = await file.text()
      const { results, error } = parseAiResultPack(text)
      if (error) {
        flash('导入失败：' + error)
        return
      }
      let poolText = packRef.current
      if (!poolText) {
        try {
          poolText = localStorage.getItem('reader:aiJobPack') ?? ''
        } catch {
          poolText = ''
        }
      }
      const jobs = poolText ? (parseJobPack(poolText)?.jobs ?? []) : []
      const target = jobs.length ? jobs : buildAiJobs(jobsInputEff)
      const { okCount, failCount, lines } = applyResults(results, target)
      const miss = missingJobIds(target, results)
      setMissingIds(miss)
      onReport([`导入完成：成功 ${okCount} / 失败 ${failCount}${miss.length ? `；缺 ${miss.length}` : ''}`, ...lines.slice(0, 40)])
      flash(`导入完成：成功 ${okCount}，失败 ${failCount}${miss.length ? `，缺 ${miss.length}` : ''}`)
    },
    [applyResults, jobsInputEff, flash, onReport],
  )

  const onFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (f) void readResults(f)
    },
    [readResults],
  )

  // ---------- 网页版路径 ----------

  /** 重置进度：清空 done/asked，让所有待办重新显示为未做（不删成果数据）。 */
  const resetWebProgress = useCallback(() => {
    setAskedIds([])
    setDoneIds([])
    setMissingIds([])
    // 连「自动标词已完成」也清掉（这样重置后是"完整重来"）
    setAutoVocabDone((prev) => prev.filter((id) => id !== jobsInput.articleId))
    flash('已重置进度（成果不删；所有待办重新显示为未做）')
  }, [jobsInput.articleId, setAskedIds, setDoneIds, setAutoVocabDone, flash])

  /** 只重置本篇「自动标词」的完成标记，让「一键跑批」能重新标词（不动其它进度与数据）。 */
  const rerunAutoVocab = useCallback(() => {
    setAutoVocabDone((prev) => prev.filter((id) => id !== jobsInput.articleId))
    // 同时清掉「自动标词」的历史完成标记（doneIds），否则它仍会被判成已完成而不进待办
    setDoneIds((prev) => prev.filter((id) => !id.startsWith('auto_vocab-')))
    flash('已重置本篇「自动标词」；再点一次「⚡ 一键跑批」即可重新标词')
  }, [jobsInput.articleId, setAutoVocabDone, setDoneIds, flash])

  /** 本篇是否已经「自动标过词」（标过就不再进默认待办）。 */
  const autoVocabDoneHere = useMemo(() => autoVocabDone.includes(jobsInput.articleId), [autoVocabDone, jobsInput.articleId])

  /** 复制「下一批待处理」的网页版提示词（自动跳过已完成的）。 */
  const copyWebPrompt = useCallback(async () => {
    if (!round.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    if (!pending.length) {
      flash('全部完成了 🎉')
      return
    }
    const size = webBatchSize > 0 ? webBatchSize : pending.length
    const batch = pending.slice(0, size)
    const batchCount = Math.max(1, Math.ceil(pending.length / size))
    const remaining = pending.length - batch.length
    const prompt = buildWebPackPrompt(batch, { batchIndex: 1, batchCount, remaining })
    try {
      await navigator.clipboard.writeText(prompt)
      setAskedIds((prev) => [...new Set([...prev, ...batch.map((j) => j.id)])])
      flash(
        `已复制 ${batch.length} 项${remaining > 0 ? `（还剩 ${remaining} 项）` : ''}；贴回复到框里点「应用网页版结果」`,
      )
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [round.length, pending, webBatchSize, setAskedIds, flash])

  /** 应用网页版整段回复（可能截断），更新进度并报告缺项。返回是否解析到结果。 */
  const applyWeb = useCallback(
    (text: string): boolean => {
      const results = parseWebPackResults(text)
      if (!results.length) {
        onReport(['没解析出结果：确认粘贴的是 AI 的整段回复（含 @@@ANSWER 行，或严格 JSON）'])
        flash('没解析出结果')
        return false
      }
      const { okCount, failCount, lines, appliedIds } = applyResults(results, round)
      const nextDone = new Set([...doneSet, ...appliedIds])
      setDoneIds([...nextDone])
      const stillMissing = round.filter((j) => askedSet.has(j.id) && !nextDone.has(j.id))
      const doneCount = round.filter((j) => nextDone.has(j.id)).length
      const left = round.length - doneCount
      onReport([
        `网页版：本批成功 ${okCount} / 失败 ${failCount}；总进度 ${doneCount}/${round.length}，还差 ${left}${
          stillMissing.length ? `（其中缺项 ${stillMissing.length}）` : ''
        }`,
        ...lines.slice(0, 40),
      ])
      flash(`本批成功 ${okCount}，失败 ${failCount}；还差 ${left} 项`)
      return true
    },
    [applyResults, round, doneSet, askedSet, setDoneIds, onReport, flash],
  )

  /** 只重发「问过但没成功」的项。 */
  const copyWebMissing = useCallback(async () => {
    if (!missing.length) {
      flash('没有缺项了')
      return
    }
    const prompt = buildWebPackPrompt(missing)
    try {
      await navigator.clipboard.writeText(prompt)
      flash(`已复制未返回的 ${missing.length} 项；再贴回点「应用网页版结果」`)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [missing, flash])

  const doneCount = round.length - pending.length

  // ---------- 一键跑批（服务端直连，自动串联多轮） ----------

  /** 把一个批次发给服务端跑，轮询进度；onDone(本批已完成数) 用于进度显示。 */
  const runBatchOnServer = useCallback(
    async (
      jobs: AiJob[],
      onDone: (done: number) => void,
    ): Promise<{ results: AiResultEntry[]; failed: { id: string; error: string }[] }> => {
      const res = await fetch('/api/ai/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobs: jobs.map((j) => ({ id: j.id, task: j.task, prompt: j.prompt })) }),
      })
      if (!res.ok) {
        const info = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(
          info.error === 'no-key'
            ? '服务端未配置 key：把 key 填进 config.local.json 的 ai.apiKey'
            : '启动失败：' + (info.message || res.status),
        )
      }
      const { runId } = (await res.json()) as { runId: string }
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500))
        let p: {
          state?: string
          done?: number
          results?: AiResultEntry[]
          failed?: { id: string; error: string }[]
          error?: string
        } | null = null
        try {
          p = await (await fetch('/api/ai/run?id=' + encodeURIComponent(runId))).json()
        } catch {
          continue
        }
        if (!p) continue
        onDone(p.done ?? 0)
        if (p.state === 'done') return { results: p.results ?? [], failed: p.failed ?? [] }
        if (p.state === 'error') throw new Error('跑批出错：' + (p.error || '未知错误'))
      }
    },
    [],
  )

  /** 等 React 把应用后的新数据渲染出来（输入对象换了新引用即视为已就绪）。 */
  const settle = useCallback(async (prev: AiJobsInput) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      if (jobsInputRef.current !== prev) return
    }
  }, [])

  /** 最多串联几轮，防止意外死循环。 */
  const MAX_CHAIN_ROUNDS = 5

  /**
   * 一键跑批：**自动串联多轮**直到没有新待办。
   * 典型：第 1 轮「自动标词」把词写进生词本 → 数据一变就冒出这些新词的「查词」待办 →
   * 自动继续第 2 轮补齐音标/释义。点一次全好。
   */
  const runLocal = useCallback(async () => {
    if (localRunning) return
    const first = pending.length ? pending : round
    if (!first.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    // 全库范围要谨慎：词库可能有上千词，一次全跑又慢又费 token，先让人确认
    if (jobsInput.scope === 'all' && first.length > 20) {
      const ok = window.confirm(
        `范围＝全库：本次将处理 ${first.length} 项待办（整个词库，可能上千词）。\n\n` +
          `这会比较慢、也比较费 token。确定继续吗？\n` +
          `（只想处理本篇的话，先取消，把「范围」切回「本篇」。）`,
      )
      if (!ok) return
    }
    setLocalError('')
    setLocalRunning(true)
    setLocalDone(0)
    setLocalTotal(0)

    const attempted = new Set<string>()
    let planned = 0

    try {
      for (let r = 0; r < MAX_CHAIN_ROUNDS; r++) {
        const input = jobsInputRef.current
        const all = buildAiJobs(input)
        const todo = all.filter((j) => !attempted.has(j.id))
        if (!todo.length) break
        for (const j of todo) attempted.add(j.id)
        planned += todo.length
        setLocalRound(r + 1)
        setLocalPhase(phaseLabelOf(todo))
        setLocalDone(0)
        setLocalTotal(todo.length)

        const { results, failed } = await runBatchOnServer(todo, (d) => setLocalDone(d))

        const { okCount, failCount, lines, appliedIds } = applyResultsRef.current(results, all)
        setDoneIds((prev) => [...new Set([...prev, ...appliedIds])])
        const report = [`一键跑批（第 ${r + 1} 轮）：成功 ${okCount} / 失败 ${failCount}`, ...lines.slice(0, 40)]
        if (failed.length) {
          const byId = new Map(all.map((j) => [j.id, j]))
          report.push(`⚠️ 有 ${failed.length} 项没跑成功（会一直显示为待办，可点「跳过」）：`)
          for (const f of failed.slice(0, 10)) {
            const j = byId.get(f.id)
            const who = j
              ? `${j.label}${j.askedWords.length ? '：' + j.askedWords.slice(0, 8).join('、') : ''}`
              : f.id
            report.push(`· ${who} —— ${f.error}`)
          }
        }
        onReport(report)
        // 本轮一条都没成，就别再等数据变化了
        if (!results.length) break
        // 等数据落地、下一轮待办浮现
        await settle(input)
      }
      flash(`一键跑批完成（共 ${planned} 项）`)
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      setLocalError(msg)
      flash(msg)
    } finally {
      setLocalRunning(false)
    }
  }, [localRunning, pending, round, runBatchOnServer, settle, setDoneIds, onReport, flash, jobsInput.scope])

  /** 把当前所有待办标记为「已处理/跳过」（不改数据；用于个别补不齐、反复失败的词）。 */
  const skipPending = useCallback(() => {
    if (!pending.length) return
    setDoneIds((prev) => [...new Set([...prev, ...pending.map((j) => j.id)])])
    flash(`已跳过 ${pending.length} 项（标记为已处理；不改数据，数据再变时可能重新出现）`)
  }, [pending, setDoneIds, flash])

  return {
    // agent 路径
    jobCount,
    exportJobs,
    fileRef,
    onFile,
    // 网页版
    webBatchSize,
    setWebBatchSize,
    copyWebPrompt,
    applyWeb,
    copyWebMissing,
    resetWebProgress,
    autoVocabDoneHere,
    rerunAutoVocab,
    webTotal: round.length,
    webDone: doneCount,
    webPending: pending.length,
    webMissing: missing.length,
    webBreakdown,
    /** 「还要做」的前几项标签（给 UI 提示用）。 */
    webPendingLabels: pending.slice(0, 6).map((j) => j.label),
    agentMissingCount: missingIds.length,
    // 一键跑批（服务端直连）
    localConfigured,
    localRunning,
    localDone,
    localTotal,
    localRound,
    localPhase,
    localError,
    runLocal,
    skipPending,
    // 待办检查 / 进度提醒
    checklist,
    checklistDone,
    checklistTotal,
    nextHint,
  }
}
