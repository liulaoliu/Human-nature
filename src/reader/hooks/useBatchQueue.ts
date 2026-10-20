import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lemmaOf } from '../../core/vocab'
import { wordSpans } from '../../core/wordSelect'
import type { Sentence, VocabVia } from '../../types/document'
import type { BatchItem } from '../panels/SidePick'
import { readRaw, writeRaw } from '../storage'
import { isVocabVia } from '../../core/vocabVia'

const BATCH_MAP_KEY = 'reader:batch'

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function toBatchItem(v: unknown): BatchItem | null {
  if (!isRecord(v)) return null
  const word = typeof v.word === 'string' ? v.word.trim() : ''
  if (!word) return null
  return {
    word,
    sentence: typeof v.sentence === 'string' ? v.sentence : '',
    sentenceId: typeof v.sentenceId === 'string' ? v.sentenceId : null,
    via: isVocabVia(v.via) ? v.via : undefined,
  }
}

/**
 * 运行时校验 `reader:batch`（localStorage 是外部输入，旧版本/手改都可能有坏数据）。
 * 返回好数据 + 丢弃条数，调用方负责提示。
 */
export function parseBatchMap(raw: string | null): { map: Record<string, BatchItem[]>; dropped: number } {
  if (!raw) return { map: {}, dropped: 0 }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { map: {}, dropped: 1 }
  }
  if (!isRecord(data)) return { map: {}, dropped: 1 }

  const map: Record<string, BatchItem[]> = {}
  let dropped = 0
  for (const [key, list] of Object.entries(data)) {
    if (!Array.isArray(list)) {
      dropped++
      continue
    }
    const items: BatchItem[] = []
    for (const rawItem of list) {
      const item = toBatchItem(rawItem)
      if (item) items.push(item)
      else dropped++
    }
    if (items.length) map[key] = items
  }
  return { map, dropped }
}

export interface UseBatchQueueParams {
  /** 当前文章标识：待选清单按文章分组持久化。 */
  articleIdentity: string
  /** 当前文章句子：把词映射成待选项时回填来源句。 */
  sentences: Sentence[] | null
}

/**
 * 「待选」清单：状态 + 按文章持久化 + 去重（按 lemma）。
 *
 * 之前这段散在 `ReaderApp` 里（`reader:batch` 直接摸 localStorage）；
 * 现在统一走 `storage.ts`，坏数据先过 `parseBatchMap`，写失败能看见。
 * 注意：打开文章时从 `batchMapRef` 恢复待选由 `useReaderDoc` 负责，本 hook 只负责写。
 */
export function useBatchQueue({ articleIdentity, sentences }: UseBatchQueueParams) {
  const initial = useRef<{ map: Record<string, BatchItem[]>; dropped: number } | null>(null)
  if (!initial.current) {
    initial.current = parseBatchMap(readRaw(BATCH_MAP_KEY))
    if (initial.current.dropped > 0) {
      console.warn(`[待选] 丢弃 ${initial.current.dropped} 条损坏记录`)
    }
  }
  const batchMapRef = useRef<Record<string, BatchItem[]>>(initial.current.map)
  const [batch, setBatch] = useState<BatchItem[]>([])

  // 按文章持久化。写失败（配额满/隐私模式）别静默。
  useEffect(() => {
    batchMapRef.current[articleIdentity] = batch
    if (!writeRaw(BATCH_MAP_KEY, JSON.stringify(batchMapRef.current))) {
      console.warn('[待选] 本地保存失败（配额满或隐私模式）')
    }
  }, [batch, articleIdentity])

  /** 选词模式：把词加入 / 移出待选清单（同词按 lemma 去重）。 */
  const addToBatch = useCallback((words: string[], sentence: string, sentenceId: string | null) => {
    setBatch((prev) => {
      const next = [...prev]
      for (const w of words) {
        const key = lemmaOf(w)
        const i = next.findIndex((x) => lemmaOf(x.word) === key)
        if (i >= 0) next.splice(i, 1)
        else next.push({ word: w, sentence, sentenceId, via: 'manual' })
      }
      return next
    })
  }, [])

  /** 批量并入选区/待选（按 lemma 去重）。用于自动标词导入。 */
  const mergeBatch = useCallback((items: BatchItem[]) => {
    setBatch((prev) => {
      const next = [...prev]
      for (const it of items) {
        const key = lemmaOf(it.word)
        const i = next.findIndex((x) => lemmaOf(x.word) === key)
        if (i < 0) next.push(it)
        else if (!next[i].via && it.via) next[i] = { ...next[i], via: it.via }
      }
      return next
    })
  }, [])

  /** 把一串词映射成待选项，并尽量在正文里找到它所在的句子（回填来源）。 */
  const batchItemsFromWords = useCallback(
    (words: string[], via: VocabVia = 'auto'): BatchItem[] =>
      words.map((w) => {
        const key = lemmaOf(w)
        const s = (sentences ?? []).find((x) =>
          wordSpans(x.text).some(
            (t) => t.text.toLowerCase() === w.toLowerCase() || lemmaOf(t.text) === key,
          ),
        )
        return { word: w, sentence: s?.text ?? '', sentenceId: s?.id ?? null, via }
      }),
    [sentences],
  )

  /** 正文里哪些句子有待选词（给字数统计/高亮用）。 */
  const batchSentenceIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of batch) if (b.sentenceId) set.add(b.sentenceId)
    return set
  }, [batch])

  return { batch, setBatch, batchMapRef, addToBatch, mergeBatch, batchItemsFromWords, batchSentenceIds }
}
