import { useCallback, useEffect, useState } from 'react'
import type { ProductionPrompt } from '../../core/production'
import type { WritingFeedback } from '../../core/writing'

export const PRODUCTION_FOLLOW_UP_CAP = 8

export interface ProductionFollowUpItem {
  q: string
  a: string
}

export interface UseProductionFollowUpParams {
  current: ProductionPrompt | null
  answer: string
  feedback: WritingFeedback | null
  ensureAi: () => Promise<boolean>
  callAi: (task: string, prompt: string) => Promise<string>
  flash: (message: string) => void
}

/**
 * 批改后的「追问 D老师」：把题面 / 作答 / 批改 / 上一两轮问答拼进提示词，
 * 让老师针对具体问题继续解释。不是完整聊天产品，但比一次性批改多一层追问。
 */
export function useProductionFollowUp({
  current,
  answer,
  feedback,
  ensureAi,
  callAi,
  flash,
}: UseProductionFollowUpParams) {
  const [items, setItems] = useState<ProductionFollowUpItem[]>([])
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setItems([])
    setError('')
  }, [current?.id])

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || !current || !feedback) return
      if (!(await ensureAi())) {
        flash('没有配置 AI：先配 key，或复制批改提示词粘回结果')
        return
      }
      setAsking(true)
      setError('')
      try {
        const prior = items
          .slice(-PRODUCTION_FOLLOW_UP_CAP)
          .map((it) => `学生问：${it.q}\n你答：${it.a}`)
          .join('\n\n')
        const issues = feedback.issues
          .slice(0, 6)
          .map((x) => `- ${x.original} → ${x.suggestion}${x.reason ? `（${x.reason}）` : ''}`)
          .join('\n')
        const prompt = [
          '你是英语写作老师，学生刚做完一题产出训练，现在追问。请用中文回答，直接给可执行改法，不要输出 JSON。',
          '',
          `题目：${current.zh}`,
          `目标：${current.goal}`,
          `学生作答：${answer}`,
          `批改总评：${feedback.summary}`,
          issues ? `主要问题：\n${issues}` : '',
          prior ? `之前的追问：\n${prior}` : '',
          '',
          `学生这次问：${q}`,
        ]
          .filter(Boolean)
          .join('\n')
        const out = await callAi('feedback', prompt)
        const a = out.trim()
        if (!a) throw new Error('AI 没有返回回答')
        setItems((prev) => [...prev, { q, a }].slice(-PRODUCTION_FOLLOW_UP_CAP))
      } catch (e) {
        setError(String((e as Error)?.message || e))
      } finally {
        setAsking(false)
      }
    },
    [current, answer, feedback, ensureAi, callAi, flash, items],
  )

  return { items, asking, error, ask }
}
