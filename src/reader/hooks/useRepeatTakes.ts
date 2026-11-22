import { useCallback, useEffect, useState } from 'react'
import type { Sentence } from '../../types/document'
import { isRepeatTakeFor, repeatTakeId, type RepeatTake } from '../../core/repeatTake'
import { createRepeatTakeRepo, type RepeatTakeRepo } from '../../adapters/repeatTakeRepo'

export interface UseRepeatTakesOptions {
  articleKey: string
  sentence: Sentence | undefined
  /** 复读没开时不做任何 IO（面板常驻，但大多数时候是关着的）。 */
  enabled?: boolean
  /** 测试注入；生产用 IndexedDB。 */
  repo?: RepeatTakeRepo
}

/**
 * 当前句的录音：切句时按 `articleKey + sentenceId` 取，文本戳对不上就当作没有。
 *
 * 只留最新一条，所以 `save` 直接覆盖；孤儿（改正文后 id 被复用）在读取时顺手删掉，
 * 不用等整篇清理。
 */
export function useRepeatTakes({ articleKey, sentence, enabled = true, repo }: UseRepeatTakesOptions) {
  const [store] = useState(() => repo ?? createRepeatTakeRepo())
  const [take, setTake] = useState<RepeatTake | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    if (!enabled || !sentence) {
      setTake(null)
      setLoading(false)
      return
    }
    setLoading(true)
    void store
      .get(repeatTakeId(articleKey, sentence.id))
      .then((found) => {
        if (!alive) return
        if (found && isRepeatTakeFor(found, sentence)) {
          setTake(found)
          return
        }
        setTake(null)
        // 文本戳不匹配：句子 id 被复用/正文改过，旧录音不能再放
        if (found) void store.remove(found.id)
      })
      .catch(() => {
        if (alive) setTake(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // 只认 id + 文本：sentence 对象每次渲染可能换身份，拿来当依赖会反复读库
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleKey, enabled, sentence?.id, sentence?.text, store])

  const save = useCallback(
    async (next: RepeatTake) => {
      await store.put(next)
      setTake(next)
    },
    [store],
  )

  return { take, loading, save }
}
