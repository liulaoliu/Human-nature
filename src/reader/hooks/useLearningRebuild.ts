import { useCallback, useRef, useState } from 'react'
import { learningRepo } from '../../adapters/learningRepo'
import type { LearningData } from '../../core/learning'
import { compareDerived, describeLearningCheck, type LearningCheckResult } from '../../core/learningCheck'
import type { LearningRepoPort } from '../../core/ports'
import { readLearningFromLocalStorage } from '../learningState'

export interface LearningRebuildApi {
  /** 调服务端重建派生聚合，并把结果和本地记录对一遍（只读，不覆盖本地） */
  run: () => Promise<void>
  busy: boolean
  /** 上一次核对结果（没跑过为 null） */
  result: LearningCheckResult | null
  /** 上一次核对的一句话结论（没跑过为 null）；文案在 core，面板只管显示 */
  note: string | null
  /** 上一次核对是否一致（没跑过按 false，面板用灰/警示色区分） */
  matched: boolean
}

/**
 * 「重建并核对」学习记录。
 *
 * - 重建只在服务端做（答题事件 → 活动 / 题型统计），这里**不写本地**：
 *   对不上时只报差异，不替用户决定谁对（本地可能有还没同步的改动）。
 * - 服务不可用时给可见提示，不静默失败。
 */
export function useLearningRebuild({
  flash,
  repo = learningRepo,
  readLocal = readLearningFromLocalStorage,
}: {
  flash: (msg: string) => void
  repo?: LearningRepoPort
  /** 测试注入：默认读 localStorage 缓存 */
  readLocal?: () => LearningData
}): LearningRebuildApi {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LearningCheckResult | null>(null)
  // 连点两次时第二次直接忽略（ref 比 state 快一拍）
  const busyRef = useRef(false)

  const run = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const rebuilt = await repo.rebuildDerived?.()
      if (!rebuilt) {
        flash('重建失败：本地存储服务不可用（静态部署或服务没起）；学习记录未改动')
        return
      }
      const next = compareDerived(readLocal(), rebuilt)
      setResult(next)
      flash(`学习记录${describeLearningCheck(next)}`)
    } catch (e) {
      console.warn('[学习记录] 重建派生失败', e)
      flash('重建失败：存储服务返回异常；学习记录未改动')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [flash, repo, readLocal])

  return {
    run,
    busy,
    result,
    note: result ? describeLearningCheck(result) : null,
    matched: result?.matched ?? false,
  }
}
