// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useDictation } from './useDictation'
import { sentenceFixture } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'

/**
 * 听写会话接线：开篇/判分/错题/兜底提示。
 * 词级 diff 与并句规则在 core/dictation 已单测，这里只钉 hook 的接线。
 */
let api: ReturnType<typeof useDictation> | null = null

const flash = vi.fn()
const speak = vi.fn()
const warmTexts = vi.fn()
const warmTimings = vi.fn()
const mergeBatch = vi.fn()
const batchItemsFromWords = vi.fn(() => [])
const recordActivity = vi.fn()
const recordPractice = vi.fn()
const recordAnswer = vi.fn()
const addMistake = vi.fn()
const dropMistake = vi.fn()
const closeOthers = vi.fn()

const doc = {
  sentences: [sentenceFixture('s1', 'Hello world.'), sentenceFixture('s2', 'Second sentence.')],
}

function Harness() {
  api = useDictation({
    doc,
    articleIdentity: 'A',
    libraryLemmas: new Set<string>(),
    speak,
    warmTexts,
    warmTimings,
    flash,
    mergeBatch,
    batchItemsFromWords,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    closeOthers,
  })
  return null
}

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  api = null
  vi.clearAllMocks()
})

afterEach(() => {
  restoreStorage()
  vi.restoreAllMocks()
})

describe('useDictation：开局', () => {
  it('初始态：没有进行中的听写', () => {
    render(<Harness />)
    expect(api!.queue).toBeNull()
    expect(api!.index).toBe(0)
  })

  it('按整句模式开一篇：队列就是句子数，并预热音频', () => {
    render(<Harness />)
    act(() => api!.start({ mode: 'full', max: 20 }))
    expect(api!.queue).toHaveLength(2)
    expect(api!.queue![0].text).toBe('Hello world.')
    expect(closeOthers).toHaveBeenCalledTimes(1)
    expect(warmTimings).toHaveBeenCalledWith(['Hello world.', 'Second sentence.'])
  })

  it('没有文档时只提示', () => {
    function NoDoc() {
      api = useDictation({
        doc: null,
        libraryLemmas: new Set<string>(),
        speak,
        warmTexts,
        warmTimings,
        flash,
        mergeBatch,
        batchItemsFromWords,
        recordActivity,
        recordPractice,
        addMistake,
        dropMistake,
        closeOthers,
      })
      return null
    }
    render(<NoDoc />)
    act(() => api!.start())
    expect(api!.queue).toBeNull()
    expect(flash).toHaveBeenCalledWith('先打开一篇文章')
  })
})

describe('useDictation：判分', () => {
  it('全对：记活动、清错题、结果 true', () => {
    render(<Harness />)
    act(() => api!.startItems([{ id: 'd1', text: 'Hello world.' }]))
    act(() => api!.setInput('Hello world.'))
    act(() => api!.check())
    expect(api!.checked).toBe(true)
    expect(api!.results).toEqual([true])
    expect(api!.wrongItems).toEqual([])
    expect(recordActivity).toHaveBeenCalledWith('listen', 1)
    expect(recordAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'A', source: 'dictation', kind: 'dictation', cat: 'listen', correct: true }),
    )
    expect(dropMistake).toHaveBeenCalledTimes(1)
    expect(addMistake).not.toHaveBeenCalled()
  })

  it('有错：保存 diff 与错题，记错题本', () => {
    render(<Harness />)
    act(() => api!.startItems([{ id: 'd1', text: 'Hello world.' }]))
    act(() => api!.setInput('Hello'))
    act(() => api!.check())
    expect(api!.results).toEqual([false])
    expect(api!.diff).not.toBeNull()
    expect(api!.wrongItems).toEqual([{ id: 'd1', text: 'Hello world.' }])
    expect(addMistake).toHaveBeenCalledTimes(1)
    expect(dropMistake).not.toHaveBeenCalled()
  })

  it('错题重练：只重开本轮错题', () => {
    render(<Harness />)
    act(() => api!.startItems([{ id: 'd1', text: 'Hello world.' }]))
    act(() => api!.setInput('Hello'))
    act(() => api!.check())
    act(() => api!.retryWrong())
    expect(api!.queue).toEqual([{ id: 'd1', text: 'Hello world.' }])
    expect(api!.results).toEqual([])
  })

  it('关闭：清空队列', () => {
    render(<Harness />)
    act(() => api!.startItems([{ id: 'd1', text: 'Hello world.' }]))
    act(() => api!.close())
    expect(api!.queue).toBeNull()
  })

  it('卸载：清掉自动下一句定时器', () => {
    const clear = vi.spyOn(window, 'clearTimeout')
    const { unmount } = render(<Harness />)
    act(() => api!.startItems([{ id: 'd1', text: 'Hello world.' }]))
    act(() => api!.setInput('Hello world.'))
    act(() => api!.check())
    unmount()
    expect(clear).toHaveBeenCalled()
  })
})
