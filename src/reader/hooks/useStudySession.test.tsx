// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { useStudySession } from './useStudySession'
import { createLibrary } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'
import type { VocabLibrary } from '../../types/document'

/**
 * 背单词会话的导航接线：Q/E 切上一张/下一张卡，且「背搭配」只组词组/习语。
 * 评分/排队算法本身在 core/vocab（已单测），这里只测 hook 的接线。
 */
let api: ReturnType<typeof useStudySession> | null = null

const flash = vi.fn()
const noop = vi.fn()
const docLemmas = new Set<string>()

function Harness({
  library,
  speak = noop,
}: {
  library: VocabLibrary
  speak?: (text: string) => void
}) {
  api = useStudySession({
    library,
    articleIdentity: 'A',
    docLemmas,
    closeQuiz: noop,
    flash,
    persist: noop,
    markStudied: noop,
    recordActivity: noop,
    addStudyTime: noop,
    speak,
    newLimit: 0,
    newToday: 0,
    onBumpNewToday: noop,
  })
  return null
}

const lib = (items: VocabLibrary['items']): VocabLibrary => ({ ...createLibrary(), items })

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  api = null
  flash.mockClear()
})

afterEach(() => {
  restoreStorage()
})

describe('useStudySession：单词之间切换', () => {
  it('E 下一个、Q 上一个；到边界不越界', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'one', lemma: 'one' }),
          vocabItem({ id: 'w2', word: 'two', lemma: 'two' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.index).toBe(1)

    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.index).toBe(2) // 最后一张再往后 = 本轮完成页

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(1)

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(0) // 第一张不再往前
    unmount()
  })
})

describe('useStudySession：背单词 / 背搭配分牌组', () => {  it('背单词只组单词，切到背搭配只组词组/习语', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'run', lemma: 'run', kind: 'word' }),
          vocabItem({ id: 'p1', word: 'fall back on', lemma: 'fall back on', kind: 'phrase' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.queue?.map((it) => it.id)).toEqual(['w1'])

    act(() => api!.switchDeck('collocation'))
    expect(api!.deck).toBe('collocation')
    expect(api!.queue?.map((it) => it.id)).toEqual(['p1'])
    unmount()
  })
})

describe('useStudySession：R 朗读当前单词', () => {
  it('R 和卡片右侧按钮走同一个朗读入口', () => {
    const speak = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} speak={speak} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))

    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).toHaveBeenCalledWith('one')
    unmount()
  })

  it('拼写模式判卷前不朗读（防剧透），判卷后可读', () => {
    const speak = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one' })])} speak={speak} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setSpelling(true))

    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).not.toHaveBeenCalled()

    act(() => api!.setChecked(true))
    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).toHaveBeenCalledWith('one')
    unmount()
  })
})
