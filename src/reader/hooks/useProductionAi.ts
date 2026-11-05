import { useCallback, useRef, useState } from 'react'
import { fetchAiStatus, runAiBatch } from '../../adapters/aiRun'

export interface UseProductionAiParams {
  /** 测试注入；默认走本机 `/api/ai/run`。 */
  runAi?: typeof runAiBatch
  aiStatus?: () => Promise<boolean>
  onCopyError?: (message: string) => void
}

/**
 * 奶牛工棚的 AI 小接线：是否配置、单条跑批、复制提示词、取消。
 *
 * 只做浏览器 IO；题目 / 批改的状态机仍在 `useProductionSession`。
 * 这样主 hook 不用把 AbortController 和 clipboard 的细节摊在业务里。
 */
export function useProductionAi({
  runAi = runAiBatch,
  aiStatus = fetchAiStatus,
  onCopyError,
}: UseProductionAiParams = {}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  const copy = useCallback(
    async (prompt: string) => {
      try {
        await navigator.clipboard.writeText(prompt)
        return true
      } catch {
        onCopyError?.('复制失败：浏览器需要 localhost 或 https')
        return false
      }
    },
    [onCopyError],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { ensureAi, callAi, copy, cancel }
}
