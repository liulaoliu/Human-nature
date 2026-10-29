import { vi } from 'vitest'
import { useStudySession } from './useStudySession'
import { createLibrary } from '../../core/vocab'
import { installFakeStorage } from '../testStorage'
import type { VocabLibrary } from '../../types/document'

/**
 * `useStudySession` 的测试夹具（**仅供测试**）。
 *
 * 会话有十几条外部依赖，每个测试文件都抄一遍 Harness 既啰嗦又容易漂：
 * 这里统一给「一条都不断言」的桩（flash / persist / 记账全是 vi.fn()），
 * 测试只在自己关心的那一个依赖上换成 spy。
 */

/** 最新一次渲染拿到的会话 API。 */
export let api: ReturnType<typeof useStudySession> | null = null
export const setApi = (next: ReturnType<typeof useStudySession> | null) => {
  api = next
}

export const flash = vi.fn()
export const noop = vi.fn()
export const docLemmas = new Set<string>()

export function Harness({
  library,
  speak = noop,
  onPersist = noop,
}: {
  library: VocabLibrary
  speak?: (text: string) => void
  onPersist?: (lib: VocabLibrary) => void
}) {
  setApi(
    useStudySession({
      library,
      articleIdentity: 'A',
      docLemmas,
      closeQuiz: noop,
      flash,
      persist: onPersist,
      markStudied: noop,
      recordActivity: noop,
      addStudyTime: noop,
      speak,
      newLimit: 0,
      newToday: 0,
      onBumpNewToday: noop,
    }),
  )
  return null
}

export const lib = (items: VocabLibrary['items']): VocabLibrary => ({ ...createLibrary(), items })

/** 每个测试前装假 localStorage，测试后还原（并清掉 fake timers）。 */
export function fakeStorageHarness() {
  let restore: () => void = () => {}
  return {
    setup: () => {
      restore = installFakeStorage()
      setApi(null)
      flash.mockClear()
    },
    teardown: () => {
      restore()
      vi.useRealTimers()
    },
  }
}
