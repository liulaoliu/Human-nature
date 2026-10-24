/**
 * 本机「学习活动」的一行写入口（跟读模块用）。
 *
 * 跟读页不是精读页的 React 树，改不到 `useLearningData` 的 state，但又必须把「说」
 * 记进同一份学习统计（否则统计页里跟读永远 0）。做法和精读页一致：
 * 写同一个 localStorage 键 `reader:activity`，再派发 `reader:local-state` 事件让
 * 精读页那边知道该重读。
 *
 * 从 `state/session.ts` 抽出来的原因：这是**跨模块的约定**（键名、事件名、口径），
 * 藏在 store 文件的最后容易被当成内部工具函数改坏。
 */
import { addActivity, dayKeyLocal, normalizeActivity, type DayActivity } from '../core/activity'
import { LEARNING_KEYS } from '../core/learning'

/** 与精读页 `useLocalStorageState(LEARNING_KEYS.activity)` 是同一条键，别名只给本模块读起来短一点 */
export const ACTIVITY_KEY = LEARNING_KEYS.activity
export const LOCAL_STATE_EVENT = 'reader:local-state'

/** 读出本机已有的活动记录：坏数据当空库（**不能因为一条脏数据就把今天这笔记丢**） */
function readExisting(storage: Storage): DayActivity[] {
  try {
    return normalizeActivity(JSON.parse(storage.getItem(ACTIVITY_KEY) ?? '[]'))
  } catch {
    return []
  }
}

/** 记一笔「说」（跟读录了一条）。没有 localStorage（测试 / 隐私模式）就跳过。 */
export function recordLocalActivity(cat: 'speak', n = 1, storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  try {
    storage.setItem(ACTIVITY_KEY, JSON.stringify(addActivity(readExisting(storage), dayKeyLocal(new Date()), cat, n)))
    globalThis.dispatchEvent(new CustomEvent(LOCAL_STATE_EVENT, { detail: { key: ACTIVITY_KEY } }))
  } catch {
    // 隐私模式 / 存储满了都不影响录音本身
  }
}
