// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useSessionServices } from './useSessionServices'

const mocks = vi.hoisted(() => ({
  study: { queue: [], pool: [], unflushedSeconds: 0, start: vi.fn(), close: vi.fn() },
  quiz: {
    setScope: vi.fn(),
    setLoopWrong: vi.fn(),
    setupOpen: false,
    setSetupOpen: vi.fn(),
    queue: null,
    setQueue: vi.fn(),
    index: 0,
    articleKinds: [],
    startArticle: vi.fn(),
    startItems: vi.fn(),
    startDrill: vi.fn(),
    startArticleDrill: vi.fn(),
    close: vi.fn(),
  },
  listen: {
    quiz: null,
    setQuiz: vi.fn(),
    open: false,
    setOpen: vi.fn(),
    count: 3,
    setCount: vi.fn(),
    start: vi.fn(),
    startQuestions: vi.fn(),
  },
  quick: { queue: null, setQueue: vi.fn(), close: vi.fn() },
  dict: { queue: null, index: 0, startItems: vi.fn(), close: vi.fn() },
  writing: {
    open: false,
    setOpen: vi.fn(),
    model: '',
    task: null,
    setTask: vi.fn(),
    text: '',
    setFeedback: vi.fn(),
    history: [],
    setHistory: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  },
}))

vi.mock('./useStudySession', () => ({ useStudySession: () => mocks.study }))
vi.mock('./useQuizSession', () => ({ useQuizSession: () => mocks.quiz }))
vi.mock('./useListening', () => ({ useListening: () => mocks.listen }))
vi.mock('./useQuickSession', () => ({ useQuickSession: () => mocks.quick }))
vi.mock('./useDictation', () => ({ useDictation: () => mocks.dict }))
vi.mock('./useWriting', () => ({ useWriting: () => mocks.writing }))
vi.mock('../useHotkeys', () => ({ useHotkeys: () => {} }))

function setup(over: Record<string, unknown> = {}) {
  const flash = vi.fn()
  const setSpeedReadOpen = vi.fn()
  const params = {
    library: { items: [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })] },
    articleIdentity: 'a1',
    articleTitle: 'A',
    docLemmas: new Set<string>(),
    doc: { paragraphs: [], sentences: [sentenceFixture('s1', 'Hello.')] },
    selectedId: null,
    speak: vi.fn(),
    flash,
    persist: vi.fn(),
    markStudied: vi.fn(),
    recordActivity: vi.fn(),
    recordPractice: vi.fn(),
    addMistake: vi.fn(),
    dropMistake: vi.fn(),
    studyFlush: () => 0,
    newLimit: 20,
    newToday: 0,
    bumpNewToday: vi.fn(),
    mergeKindStats: vi.fn(),
    setLastTask: vi.fn(),
    askedWordsRef: { current: [] },
    askedIdsRef: { current: [] },
    setSessions: vi.fn(),
    mistakes: [],
    setIntensiveOpen: vi.fn(),
    setSpeedReadOpen,
    warmTexts: vi.fn(),
    warmTimings: vi.fn(),
    mergeBatch: vi.fn(),
    batchItemsFromWords: vi.fn(() => []),
    backTranslations: [],
    saveBackTranslation: vi.fn(),
    ...over,
  }
  const hook = renderHook(() => useSessionServices(params as never))
  return { ...hook, flash, setSpeedReadOpen, params }
}

describe('useSessionServices：会话转发', () => {
  it('各 hook 结果原样暴露', () => {
    const { result } = setup()
    expect(result.current.studyApi).toBe(mocks.study)
    expect(result.current.quizApi).toBe(mocks.quiz)
    expect(result.current.listenApi).toBe(mocks.listen)
    expect(result.current.quickApi).toBe(mocks.quick)
    expect(result.current.writingApi).toBe(mocks.writing)
    expect(result.current.listenCount).toBe(3)
  })

  it('openListeningMode 记模式并启动听力', () => {
    const { result } = setup()
    act(() => result.current.openListeningMode(true))
    expect(result.current.listenReadMode).toBe(true)
    expect(mocks.listen.start).toHaveBeenCalledOnce()
  })

  it('openSpeedRead 没有正文时只提示，不动会话', () => {
    const { result, flash, setSpeedReadOpen } = setup({ doc: null })
    act(() => result.current.openSpeedRead())
    expect(flash).toHaveBeenCalledWith('先打开一篇文章')
    expect(setSpeedReadOpen).not.toHaveBeenCalled()
  })

  it('openSpeedRead 有正文时关掉其它会话再打开', () => {
    const { result, setSpeedReadOpen } = setup()
    act(() => result.current.openSpeedRead())
    expect(mocks.study.close).toHaveBeenCalled()
    expect(mocks.quiz.setSetupOpen).toHaveBeenCalledWith(false)
    expect(mocks.quiz.setQueue).toHaveBeenCalledWith(null)
    expect(mocks.quick.setQueue).toHaveBeenCalledWith(null)
    expect(mocks.listen.setOpen).toHaveBeenCalledWith(false)
    expect(setSpeedReadOpen).toHaveBeenCalledWith(true)
  })

  it('startDictItems 走听写会话；错题重练走考试会话', () => {
    const { result, flash } = setup({
      mistakes: [{ id: 'm1', kind: 'vocab', at: 't', count: 1, label: 'run', itemId: 'v1' }],
    })
    act(() => result.current.startDictItems([{ id: 'd1', text: 'hello' }]))
    expect(mocks.dict.startItems).toHaveBeenCalledWith([{ id: 'd1', text: 'hello' }])

    act(() => result.current.retryMistakeVocab())
    expect(mocks.quiz.startItems).toHaveBeenCalledWith(['v1'])

    act(() => result.current.retryMistakeListen())
    expect(flash).toHaveBeenCalledWith('没有听力错题')
  })

  it('选词模式开关仍可用', () => {
    const { result } = setup()
    act(() => result.current.toggleVocabMode())
    expect(result.current.vocabMode).toBe(true)
  })
})
