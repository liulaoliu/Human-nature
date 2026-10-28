import { useEffect, useState } from 'react'
import {
  parseDictSessionSnapshot,
  type DictItemData,
  type DictSessionSnapshot,
} from '../../core/sessionSnapshots'

const DICT_SESSION_KEY = 'reader:dictSession'

function loadDictSession(): DictSessionSnapshot | null {
  try {
    return parseDictSessionSnapshot(localStorage.getItem(DICT_SESSION_KEY))
  } catch {
    return null
  }
}

/**
 * 听写会话的「刷新可恢复」状态。
 *
 * 只负责恢复 / 落盘；题目怎么出、怎么判分仍在 useDictation。
 * 和 `useQuizSessionSnapshot` 同构，别在两个会话里各写一份 localStorage 逻辑。
 */
export function useDictationSnapshot({
  mode,
  setMode,
}: {
  mode: 'full' | 'cloze'
  setMode: (m: 'full' | 'cloze') => void
}) {
  const [restored] = useState<DictSessionSnapshot | null>(loadDictSession)
  const [queue, setQueue] = useState<DictItemData[] | null>(restored?.queue ?? null)
  const [index, setIndex] = useState(restored?.index ?? 0)
  const [input, setInput] = useState(restored?.input ?? '')
  const [checked, setChecked] = useState(restored?.checked ?? false)
  const [diff, setDiff] = useState<DictSessionSnapshot['diff']>(restored?.diff ?? null)
  const [blanks, setBlanks] = useState<string[]>(restored?.blanks ?? [])
  const [results, setResults] = useState<boolean[]>(restored?.results ?? [])
  const [wrongItems, setWrongItems] = useState<DictItemData[]>(restored?.wrongItems ?? [])
  /** 本轮出自全篇的哪一段（用于显示「第 X–Y / 全篇 M」）。 */
  const [roundInfo, setRoundInfo] = useState(restored?.round ?? { offset: 0, grand: 0 })

  // 队列是按恢复时的模式建的，挂载时对齐一次
  useEffect(() => {
    if (restored) setMode(restored.mode)
    // 只在挂载时对齐一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 刷新页面后能接着听写
  useEffect(() => {
    try {
      if (queue && queue.length) {
        const snap: DictSessionSnapshot = {
          v: 1,
          queue,
          index,
          mode,
          input,
          checked,
          diff,
          blanks,
          results,
          wrongItems,
          round: roundInfo,
        }
        localStorage.setItem(DICT_SESSION_KEY, JSON.stringify(snap))
      } else {
        localStorage.removeItem(DICT_SESSION_KEY)
      }
    } catch {
      // 隐私模式 / 配额满：忽略
    }
  }, [queue, index, mode, input, checked, diff, blanks, results, wrongItems, roundInfo])

  return {
    restored,
    queue,
    setQueue,
    index,
    setIndex,
    input,
    setInput,
    checked,
    setChecked,
    diff,
    setDiff,
    blanks,
    setBlanks,
    results,
    setResults,
    wrongItems,
    setWrongItems,
    roundInfo,
    setRoundInfo,
  }
}
