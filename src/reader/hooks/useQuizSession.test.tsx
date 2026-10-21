// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useQuizSession } from './useQuizSession'
import { createLibrary } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'
import type { VocabLibrary } from '../../types/document'

/**
 * 考试会话的接线测试（出题/判分/错题/失败提示）。
 * 出题规则、SRS 计算在 core/quiz、core/vocab 已有单测；这里只钉 hook 有没有把动作接对。
 */
let api: ReturnType<typeof useQuizSession> | null = null

const flash = vi.fn()
const persist = vi.fn()
const markStudied = vi.fn()
const recordActivity = vi.fn()
const recordPractice = vi.fn()
const recordAnswer = vi.fn()
const addMistake = vi.fn()
const dropMistake = vi.fn()
const closeOthers = vi.fn()
const speak = vi.fn()

function Harness({ library, onRelearn }: { library: VocabLibrary; onRelearn?: (ids: string[]) => void }) {
  api = useQuizSession({
    library,
    articleIdentity: 'A',
    docLemmas: new Set<string>(),
    doc: null,
    closeOthers,
    speak,
    flash,
    persist,
    markStudied,
    recordActivity,
    recordPractice,
    recordAnswer,
    addMistake,
    dropMistake,
    onRelearn,
  })
  return null
}

const lib = (items: VocabLibrary['items']): VocabLibrary => ({ ...createLibrary(), items })
const word = (over: Parameters<typeof vocabItem>[0] = {}) =>
  vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑', ...over })

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

describe('useQuizSession：出题与判分', () => {
  it('初始态：没有进行中的考卷', () => {
    render(<Harness library={lib([word()])} />)
    expect(api!.queue).toBeNull()
    expect(api!.setupOpen).toBe(false)
    expect(api!.index).toBe(0)
  })

  it('开卷成功：按指定词条/题型出 1 题', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    expect(api!.queue).toHaveLength(1)
    expect(api!.queue![0].answer).toBe('run')
    expect(closeOthers).toHaveBeenCalledTimes(1)
  })

  it('开卷失败：没有可出的词时只提示，不建队列', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['nope'], ['spell']))
    expect(api!.queue).toBeNull()
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('出不了题'))
  })

  it('答对：记 SRS/已学，清掉该词的错题', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.setInput('run'))
    act(() => api!.check())
    expect(api!.result).toBe(true)
    expect(recordAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'A', source: 'quiz', kind: 'spell', cat: 'vocab', correct: true }),
    )
    expect(api!.results).toEqual([{ id: 'w1:spell', itemId: 'w1', correct: true }])
    expect(persist).toHaveBeenCalledTimes(1)
    expect(markStudied).toHaveBeenCalledWith('w1')
    expect(dropMistake).toHaveBeenCalledWith('vocab:w1')
    expect(recordActivity).toHaveBeenCalledWith('vocab', 1)
  })

  it('答错：进错题本并标记次日优先', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.setInput('wrong'))
    act(() => api!.check())
    expect(api!.result).toBe(false)
    expect(addMistake).toHaveBeenCalledTimes(1)
    expect(addMistake.mock.calls[0][0]).toMatchObject({ id: 'vocab:w1', kind: 'vocab' })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('错题重做：只用本轮错题重新开一卷', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.setInput('wrong'))
    act(() => api!.check())
    act(() => api!.retryWrong())
    expect(api!.queue).toHaveLength(1)
    expect(api!.results).toEqual([])
    expect(api!.checked).toBe(false)
  })

  it('关闭：清空队列与设置面板', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.close())
    expect(api!.queue).toBeNull()
    expect(api!.setupOpen).toBe(false)
  })

  it('卸载：清掉自动切题/鞭打定时器', () => {
    localStorage.setItem('reader:quizAuto', '1')
    const clear = vi.spyOn(window, 'clearTimeout')
    const { unmount } = render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.setInput('run'))
    act(() => api!.check())
    unmount()
    expect(clear).toHaveBeenCalled()
  })
})

describe('useQuizSession：拼写错 = 不认识，不许重试 / 直接退出', () => {
  it('拼错：写 SRS again + 标签、给判定提示，先锁住下一题与结束', () => {
    render(<Harness library={lib([word()])} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.setInput('ran'))
    act(() => api!.check())

    expect(api!.result).toBe(false)
    expect(api!.spellMiss).toEqual({ itemId: 'w1', word: 'run', input: 'ran' })

    const saved = persist.mock.calls.at(-1)![0] as VocabLibrary
    const w1 = saved.items.find((it) => it.id === 'w1')!
    expect(w1.tags).toContain('不认识')
    expect(w1.reviewState.relearn).toBe(1)
    expect(w1.reviewState.repetitions).toBe(0)

    // 直接切题 / 退出都不行
    act(() => api!.next())
    expect(api!.index).toBe(0)
    act(() => api!.close())
    expect(api!.queue).not.toBeNull()

    act(() => api!.ackSpellMiss())
    expect(api!.spellMiss).toBeNull()
    expect(api!.index).toBe(1)
  })

  it('「从头重学」：关掉考试并把词交给背单词会话', () => {
    const onRelearn = vi.fn()
    render(<Harness library={lib([word()])} onRelearn={onRelearn} />)
    act(() => api!.startItems(['w1'], ['spell']))
    act(() => api!.setInput('ran'))
    act(() => api!.check())
    act(() => api!.relearnSpellMiss())

    expect(onRelearn).toHaveBeenCalledWith(['w1'])
    expect(api!.queue).toBeNull()
  })

  it('其它题型答错仍是普通错题：不触发拼写判定', () => {
    render(<Harness library={lib([word({ usage: ['run a business'] })])} />)
    act(() => api!.startItems(['w1'], ['usage']))
    act(() => api!.setInput('xxx'))
    act(() => api!.check())
    expect(api!.spellMiss).toBeNull()
  })
})
