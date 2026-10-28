// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import { createLibrary } from '../../core/vocab'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import { createAiTasks, type AiTasksParams } from './aiTasks'

function stubClipboard(impl: (text: string) => Promise<void> = async () => {}) {
  const writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

const libraryWith = (...items: VocabLibrary['items']): VocabLibrary => ({ ...createLibrary(), items })

function setup(over: Partial<AiTasksParams> = {}) {
  const askedWordsRef = { current: [] } as MutableRefObject<string[]>
  const askedIdsRef = { current: [] } as MutableRefObject<string[]>
  const flash = vi.fn()
  const setLastTask = vi.fn()
  const persist = vi.fn()
  const base: AiTasksParams = {
    exact: '',
    useExact: false,
    sentence: null,
    visibleBatch: [],
    library: libraryWith(),
    persist,
    articleIdentity: 'a1',
    articleTitle: 'Article A',
    articleKey: null,
    doc: null,
    vocabLevel: 'cet6',
    confusableBatch: [],
    confusableTodo: [],
    lemmaCandidates: [],
    posCandidates: [],
    flash,
    setLastTask,
    setBatch: vi.fn(),
    askedWordsRef,
    askedIdsRef,
    pasteMissing: null,
    ...over,
  }
  return { tasks: createAiTasks(base), flash, setLastTask, persist, askedWordsRef, askedIdsRef }
}

describe('aiTasks.copyLanguagePrompt', () => {
  it('没打开文章：提示，不碰剪贴板', async () => {
    const writeText = stubClipboard()
    const { tasks, flash } = setup({ doc: null })
    await tasks.copyLanguagePrompt()
    expect(flash).toHaveBeenCalledWith('先打开一篇文章')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('有文章：复制提示词，记任务与问过的句子', async () => {
    const writeText = stubClipboard()
    const doc = { sentences: [sentenceFixture('s1', 'First.'), sentenceFixture('s2', 'Second.')] }
    const { tasks, setLastTask, askedWordsRef, askedIdsRef, flash } = setup({ doc })
    await tasks.copyLanguagePrompt()
    expect(writeText).toHaveBeenCalledOnce()
    const text = writeText.mock.calls[0][0]
    expect(text).toContain('First.')
    expect(text).toContain('Second.')
    expect(setLastTask).toHaveBeenCalledWith('language')
    expect(askedIdsRef.current).toEqual(['s1', 's2'])
    expect(askedWordsRef.current).toEqual([])
    expect(flash).toHaveBeenCalledWith('已复制语言点分析提示词；把 AI 的 JSON 粘回「应用结果」')
  })

  it('剪贴板失败：给出 localhost/https 提示', async () => {
    stubClipboard(async () => {
      throw new Error('denied')
    })
    const { tasks, flash } = setup({ doc: { sentences: [sentenceFixture('s1')] } })
    await tasks.copyLanguagePrompt()
    expect(flash).toHaveBeenCalledWith('复制失败：浏览器需要 localhost 或 https')
  })
})

describe('aiTasks.copyMissingAgain', () => {
  it('没有缺失词：不复制', async () => {
    const writeText = stubClipboard()
    const { tasks } = setup({ pasteMissing: null })
    await tasks.copyMissingAgain()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('按缺失词重组提示词，并记下重问范围', async () => {
    const writeText = stubClipboard()
    const item = vocabItem({ word: 'running', lemma: 'run', meaning: '跑' })
    const { tasks, setLastTask, askedWordsRef, askedIdsRef, flash } = setup({
      library: libraryWith(item),
      pasteMissing: { task: 'lookup', words: ['run'] },
    })
    await tasks.copyMissingAgain()
    const text = writeText.mock.calls[0][0]
    expect(text).toContain('run')
    expect(setLastTask).toHaveBeenCalledWith('lookup')
    expect(askedWordsRef.current).toEqual(['run'])
    expect(askedIdsRef.current).toEqual([])
    expect(flash).toHaveBeenCalledWith('已复制缺失的 1 个词，去 AI 后再贴回')
  })

  it('剪贴板失败：提示但不抛错', async () => {
    stubClipboard(async () => {
      throw new Error('denied')
    })
    const { tasks, flash } = setup({ pasteMissing: { task: 'confusable', words: ['run'] } })
    await tasks.copyMissingAgain()
    expect(flash).toHaveBeenCalledWith('复制失败：浏览器需要 localhost 或 https')
  })
})

describe('aiTasks.commitBatch：保留待选来源', () => {
  it('词典挑词 / 手动点选 / AI 自动标词分别写入 via 和 origin', () => {
    const { tasks, persist } = setup({
      visibleBatch: [
        { word: 'run', sentence: 'I run.', sentenceId: 's1', via: 'dict' },
        { word: 'walk', sentence: 'I walk.', sentenceId: 's2', via: 'manual' },
        { word: 'talk', sentence: 'I talk.', sentenceId: 's3', via: 'ai' },
      ],
    })
    tasks.commitBatch()
    const lib = persist.mock.calls[0][0] as VocabLibrary
    expect(lib.articleEntries).toMatchObject([
      { lemma: 'run', origin: 'auto', via: 'dict' },
      { lemma: 'walk', origin: 'manual', via: 'manual' },
      { lemma: 'talk', origin: 'auto', via: 'ai' },
    ])
  })

  it('旧待选没有 via：标成 batch，不冒充手动', () => {
    const { tasks, persist } = setup({
      visibleBatch: [{ word: 'run', sentence: 'I run.', sentenceId: 's1' }],
    })
    tasks.commitBatch()
    const lib = persist.mock.calls[0][0] as VocabLibrary
    expect(lib.articleEntries?.[0]).toMatchObject({ origin: 'auto', via: 'batch' })
  })
})
