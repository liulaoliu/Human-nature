import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { buildAiJobs, jobPhaseLabel } from '../../core/aiPackage'
import type { AiJob, AiJobsInput, AiResultEntry } from '../../core/aiPackage'
import type { AiApplySummary } from '../../core/aiApplyResult'
import { CANCEL_MESSAGE, fetchAiStatus, runAiBatch } from '../../adapters/aiRun'
import { AI_BATCH_NAME } from '../labels'

export interface UseAiLocalBatchParams {
  /** 已注入「自动标词完成」标记的输入。 */
  jobsInput: AiJobsInput
  /** 当前待办（顺序稳定）。 */
  round: AiJob[]
  /** 还没完成的任务。 */
  pending: AiJob[]
  applyResults: (results: AiResultEntry[], jobs: AiJob[]) => AiApplySummary
  setDoneIds: Dispatch<SetStateAction<string[]>>
  onReport: (lines: string[]) => void
  flash: (message: string) => void
}

/** 最多串联几轮，防止意外死循环。 */
const MAX_CHAIN_ROUNDS = 5

/**
 * 一键跑批（服务端直连）：自动串联多轮直到没有新待办。
 *
 * 典型：第 1 轮「自动标词」把词写进生词本 → 数据一变就冒出这些新词的「查词」待办 →
 * 自动继续第 2 轮补齐音标/释义。点一次全好。
 *
 * 轮询策略（有界、可取消）在 `adapters/aiRun`；这里只负责编排与进度状态，
 * 数据落库仍走注入的 `applyResults` / `setDoneIds`。
 */
export function useAiLocalBatch({
  jobsInput,
  round,
  pending,
  applyResults,
  setDoneIds,
  onReport,
  flash,
}: UseAiLocalBatchParams) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [roundNo, setRoundNo] = useState(0)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  /** 当前跑批的取消句柄（卸载 / 点「取消」时打断轮询）。 */
  const abortRef = useRef<AbortController | null>(null)

  // 卸载时别把轮询留在后台空转（组件没了也没人消费结果）
  useEffect(() => () => abortRef.current?.abort(), [])

  /** 问一次服务端：key 配没配（接口只回布尔，不回 key）。 */
  useEffect(() => {
    let alive = true
    void fetchAiStatus().then((configured) => {
      if (alive) setConfigured(configured)
    })
    return () => {
      alive = false
    }
  }, [])

  /** 给串联多轮用：始终读到最新输入 / 最新应用逻辑（避免闭包读到旧值）。 */
  const inputRef = useRef(jobsInput)
  useEffect(() => {
    inputRef.current = jobsInput
  }, [jobsInput])
  const applyRef = useRef(applyResults)
  useEffect(() => {
    applyRef.current = applyResults
  }, [applyResults])

  /** 等 React 把应用后的新数据渲染出来（输入对象换了新引用即视为已就绪）。 */
  const settle = useCallback(async (prev: AiJobsInput) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      if (inputRef.current !== prev) return
    }
  }, [])

  const run = useCallback(async () => {
    if (running) return
    const first = pending.length ? pending : round
    if (!first.length) {
      flash('没有待办（生词本已齐，也没有缺译文/语言点/听力题）')
      return
    }
    // pending 为空 = 本轮都跑过了。以前这里直接拿 round 重跑：于是「点一次没变化，再点一次」
    // 会变成「反复调 AI、反复没结果」——尤其是模型没返回某个词时，那个词会一直留在待办里。
    // 重跑本身是合理需求（上次失败这次可能成功），但要让人知道自己在重跑，而不是以为在补。
    if (!pending.length) {
      const ok = window.confirm(
        `本轮 ${round.length} 项待办都已经处理过了，再点会原样重跑一遍（会重新调用 AI）。\n\n` +
          `如果数据没变化：多半是模型没返回这些词。可以先把不需要的词删掉，或者改走「网页版」粘贴。\n\n` +
          `确定重跑吗？`,
      )
      if (!ok) return
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
    setError('')
    setRunning(true)
    setDone(0)
    setTotal(0)

    const attempted = new Set<string>()
    let planned = 0
    /** 累计成功 / 失败项数：收尾提示要如实说，不能有失败也说「完成」。 */
    let okTotal = 0
    let failTotal = 0
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      for (let r = 0; r < MAX_CHAIN_ROUNDS; r++) {
        const input = inputRef.current
        const all = buildAiJobs(input)
        const todo = all.filter((j) => !attempted.has(j.id))
        if (!todo.length) break
        for (const j of todo) attempted.add(j.id)
        planned += todo.length
        setRoundNo(r + 1)
        setPhase(jobPhaseLabel(todo))
        setDone(0)
        setTotal(todo.length)

        const { results, failed, dropped } = await runAiBatch(todo, {
          signal: ctrl.signal,
          onProgress: (d) => setDone(d),
        })

        const { okCount, failCount, lines, appliedIds } = applyRef.current(results, all)
        okTotal += okCount
        failTotal += failCount
        setDoneIds((prev) => [...new Set([...prev, ...appliedIds])])
        const report = [`${AI_BATCH_NAME}（第 ${r + 1} 轮）：成功 ${okCount} / 失败 ${failCount}`, ...lines.slice(0, 40)]
        if (dropped) report.push(`⚠️ 丢弃了 ${dropped} 条结构不完整的 AI 结果（缺 raw / 不是对象）`)
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
        // 解析出了结果但一条都没应用成功（格式不对 / 找不到任务）：数据不会变，
        // `settle` 只能等满 3 秒超时 —— 白等，还让「跑批中」一直挂着。
        if (!appliedIds.length) break
        // 等数据落地、下一轮待办浮现
        await settle(input)
      }
      if (failTotal) flash(`${AI_BATCH_NAME}结束：成功 ${okTotal} 项、失败 ${failTotal} 项（失败的会留在待办里，可重试）`)
      else if (planned === 0) flash('没有待办')
      else flash(`${AI_BATCH_NAME}完成（${okTotal} 项）`)
    } catch (e) {
      if (ctrl.signal.aborted) {
        // 用户主动取消：不当错误展示
        flash(CANCEL_MESSAGE)
      } else {
        const msg = String((e as Error)?.message || e)
        setError(msg)
        flash(msg)
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setRunning(false)
    }
  }, [running, pending, round, settle, setDoneIds, onReport, flash, jobsInput.scope])

  /** 取消正在跑的一键跑批：先叫服务端停（别继续花额度），再打断本地轮询。 */
  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** 把当前所有待办标记为「已处理/跳过」（不改数据；用于个别补不齐、反复失败的词）。 */
  const skipPending = useCallback(() => {
    if (!pending.length) return
    setDoneIds((prev) => [...new Set([...prev, ...pending.map((j) => j.id)])])
    flash(`已跳过 ${pending.length} 项（标记为已处理；不改数据，数据再变时可能重新出现）`)
  }, [pending, setDoneIds, flash])

  return {
    configured,
    running,
    done,
    total,
    roundNo,
    phase,
    error,
    run,
    cancel,
    skipPending,
  }
}
