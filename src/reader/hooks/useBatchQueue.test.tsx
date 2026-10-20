// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { parseBatchMap, useBatchQueue } from './useBatchQueue'
import { sentenceFixture } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'

/** 待选清单：坏数据守卫、按 lemma 去重、按文章持久化、回填来源句。 */
describe('parseBatchMap', () => {
  it('保留合法条目，丢掉坏条目并计数', () => {
    const { map, dropped } = parseBatchMap(
      JSON.stringify({
        a1: [
          { word: 'run', sentence: 'I run.', sentenceId: 's1' },
          { word: '', sentence: '空词', sentenceId: 's2' },
          { word: 42 },
          'not-an-object',
        ],
        a2: 'not-an-array',
      }),
    )
    expect(map).toEqual({ a1: [{ word: 'run', sentence: 'I run.', sentenceId: 's1' }] })
    expect(dropped).toBe(4)
  })

  it('保留合法 via；非法来源当没记', () => {
    const { map } = parseBatchMap(
      JSON.stringify({
        a1: [
          { word: 'run', sentence: '', sentenceId: null, via: 'dict' },
          { word: 'walk', sentence: '', sentenceId: null, via: '乱写' },
        ],
      }),
    )
    expect(map.a1[0].via).toBe('dict')
    expect(map.a1[1].via).toBeUndefined()
  })

  it('坏 JSON / 非对象都当空表', () => {
    expect(parseBatchMap('{').map).toEqual({})
    expect(parseBatchMap('{"a":1}').map).toEqual({})
    expect(parseBatchMap(null).map).toEqual({})
  })
})

describe('useBatchQueue', () => {
  let restoreStorage = () => {}
  beforeEach(() => {
    restoreStorage = installFakeStorage()
  })
  afterEach(() => {
    restoreStorage()
    vi.restoreAllMocks()
  })

  function setup() {
    return renderHook(() =>
      useBatchQueue({ articleIdentity: 'a1', sentences: [sentenceFixture('s1', 'I run every day.')] }),
    )
  }

  it('按 lemma 加入 / 再点移除', () => {
    const { result } = setup()
    act(() => result.current.addToBatch(['running'], 'I run every day.', 's1'))
    expect(result.current.batch).toEqual([
      { word: 'running', sentence: 'I run every day.', sentenceId: 's1', via: 'manual' },
    ])
    act(() => result.current.addToBatch(['run'], 'I run every day.', 's1'))
    expect(result.current.batch).toEqual([])
  })

  it('批量合并按 lemma 去重', () => {
    const { result } = setup()
    act(() =>
      result.current.mergeBatch([
        { word: 'run', sentence: '', sentenceId: null },
        { word: 'running', sentence: '', sentenceId: null },
        { word: 'walk', sentence: '', sentenceId: null },
      ]),
    )
    expect(result.current.batch.map((b) => b.word)).toEqual(['run', 'walk'])
  })

  it('把词映射成待选项时回填所在句子', () => {
    const { result } = setup()
    const items = result.current.batchItemsFromWords(['run', 'missing'])
    expect(items[0]).toEqual({ word: 'run', sentence: 'I run every day.', sentenceId: 's1', via: 'auto' })
    expect(items[1]).toEqual({ word: 'missing', sentence: '', sentenceId: null, via: 'auto' })
  })

  it('映射待选词时可以指定来源（词典 / AI）', () => {
    const { result } = setup()
    expect(result.current.batchItemsFromWords(['run'], 'dict')[0].via).toBe('dict')
    expect(result.current.batchItemsFromWords(['run'], 'ai')[0].via).toBe('ai')
  })

  it('批量改动后按文章写进 reader:batch', () => {
    const { result } = setup()
    act(() => result.current.addToBatch(['run'], 'I run every day.', 's1'))
    const saved = JSON.parse(localStorage.getItem('reader:batch') ?? '{}')
    expect(saved.a1).toEqual([
      { word: 'run', sentence: 'I run every day.', sentenceId: 's1', via: 'manual' },
    ])
  })

  it('batchSentenceIds 只收有句子 id 的待选项', () => {
    const { result } = setup()
    act(() =>
      result.current.mergeBatch([
        { word: 'run', sentence: 'I run.', sentenceId: 's1' },
        { word: 'walk', sentence: '', sentenceId: null },
      ]),
    )
    expect([...result.current.batchSentenceIds]).toEqual(['s1'])
  })
})
