// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useAiServices } from './useAiServices'

const mocks = vi.hoisted(() => ({
  tasks: {
    copyTranslateAll: vi.fn(),
    copyAutoVocab: vi.fn(),
    copyLanguagePrompt: vi.fn(),
    copyMissingAgain: vi.fn(),
  },
  apply: vi.fn(),
  applyAnyPaste: vi.fn(),
  runLocal: vi.fn(),
  packParams: null as null | Record<string, unknown>,
  pasteParams: null as null | Record<string, unknown>,
}))

vi.mock('./aiTasks', () => ({ createAiTasks: () => mocks.tasks }))
vi.mock('./useApplyTaskResult', () => ({ useApplyTaskResult: () => mocks.apply }))
vi.mock('./useAiPack', () => ({
  useAiPack: (p: Record<string, unknown>) => {
    mocks.packParams = p
    return {
      applyWeb: vi.fn(),
      webPending: false,
      localRunning: false,
      localDone: 1,
      localTotal: 2,
      localRound: 1,
      localPhase: '词',
      localError: '',
      runLocal: mocks.runLocal,
    }
  },
}))
vi.mock('./usePasteApply', () => ({
  usePasteApply: (p: Record<string, unknown>) => {
    mocks.pasteParams = p
    return { applyAnyPaste: mocks.applyAnyPaste }
  },
}))

function setup(over: Record<string, unknown> = {}) {
  const params = {
    exact: '',
    useExact: false,
    sentence: sentenceFixture('s1', 'Hello.'),
    visibleBatch: [{ word: 'run', sentence: 'I run.', sentenceId: 's1' }],
    library: { items: [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })] },
    libraryRef: { current: { items: [] } },
    persist: vi.fn(),
    articleIdentity: 'a1',
    articleTitle: 'A',
    articleKey: null,
    doc: { paragraphs: [], sentences: [sentenceFixture('s1', 'Hello.')] },
    vocabLevel: 'cet4',
    confusableBatch: [],
    confusableTodo: [],
    lemmaCandidates: [],
    posCandidates: [],
    articleWords: [vocabItem({ id: 'v2', word: 'walk', lemma: 'walk' })],
    flash: vi.fn(),
    setLastTask: vi.fn(),
    setBatch: vi.fn(),
    askedWordsRef: { current: [] },
    askedIdsRef: { current: [] },
    pasteMissing: null,
    mergeBatch: vi.fn(),
    batchItemsFromWords: vi.fn(() => []),
    autoVocabDirect: true,
    commitBatchItems: vi.fn(),
    writingModel: 'model',
    writingText: 'text',
    writingTask: null,
    recordActivity: vi.fn(),
    setDoc: vi.fn(),
    setPendingSave: vi.fn(),
    setListenQuiz: vi.fn(),
    setWritingTask: vi.fn(),
    setWritingFeedback: vi.fn(),
    setWritingHistory: vi.fn(),
    download: vi.fn(),
    aiPackScope: 'article' as const,
    confusableBatchSize: 10,
    listenQuiz: null,
    listenCount: 0,
    pasted: 'raw',
    clearPasted: vi.fn(),
    lastTask: null,
    onReport: vi.fn(),
    onMissing: vi.fn(),
    ...over,
  }
  return renderHook(() => useAiServices(params as never))
}

describe('useAiServices：AI 工作包输入', () => {
  it('待选 / 词库 / 本篇词 / 范围 / 听力数都进 jobsInput', () => {
    setup({ listenQuiz: { questions: [{}, {}] }, listenCount: 2 })
    const input = mocks.packParams?.jobsInput as {
      batch: { word: string; sentence: string }[]
      items: unknown[]
      articleWords: unknown[]
      scope: string
      hasListenQuiz: boolean
      listenCount: number
      sentences: unknown[]
    }
    expect(input.batch).toEqual([{ word: 'run', sentence: 'I run.' }])
    expect(input.items).toHaveLength(1)
    expect(input.articleWords).toHaveLength(1)
    expect(input.scope).toBe('article')
    expect(input.hasListenQuiz).toBe(true)
    expect(input.listenCount).toBe(2)
    expect(input.sentences).toHaveLength(1)
  })
})

describe('useAiServices：对外暴露', () => {
  it('复制动作、应用结果、工作包、粘回路由都原样透出', () => {
    const { result } = setup()
    expect(result.current.aiTasksApi).toBe(mocks.tasks)
    expect(result.current.applyTaskResult).toBe(mocks.apply)
    expect(result.current.runAiLocal).toBe(mocks.runLocal)
    expect(result.current.applyAnyPaste).toBe(mocks.applyAnyPaste)
    expect(result.current.aiLocalDone).toBe(1)
    expect(mocks.packParams?.applyTaskResult).toBe(mocks.apply)
  })

  it('粘贴框原样交给 applyPaste，缺失回执走同一回调', () => {
    const onMissing = vi.fn()
    setup({ onMissing, lastTask: 'translate' })
    expect(mocks.pasteParams?.pasted).toBe('raw')
    expect(mocks.pasteParams?.lastTask).toBe('translate')
    expect(mocks.pasteParams?.onMissing).toBe(onMissing)
  })
})
