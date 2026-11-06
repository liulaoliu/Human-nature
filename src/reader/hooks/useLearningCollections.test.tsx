// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { installFakeStorage, makeFakeStorage } from '../testStorage'
import { useLearningCollections } from './useLearningCollections'

let restoreStorage = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage(makeFakeStorage())
})
afterEach(() => {
  restoreStorage()
})

describe('useLearningCollections：localStorage 坏数据不进业务', () => {
  it('null / 对象 / 字符串 / 数组都回落到空集合，不抛', () => {
    const bad: Record<string, string> = {
      'reader:activity': 'null',
      'reader:practice': '{}',
      'reader:mistakes': '"x"',
      'reader:kindStats': '[]',
      'reader:retells': 'null',
      'reader:studyStats': '{}',
      'reader:vocabStats': 'null',
      'reader:intensiveSkimmed': '{}',
    }
    for (const [k, v] of Object.entries(bad)) localStorage.setItem(k, v)

    const { result } = renderHook(() => useLearningCollections())

    expect(result.current.activity).toEqual([])
    expect(result.current.practice).toEqual([])
    expect(result.current.mistakes).toEqual([])
    expect(result.current.kindStats).toEqual({})
    expect(result.current.retells).toEqual([])
    expect(result.current.studyDays).toEqual([])
    expect(result.current.sessions).toEqual([])
    expect(result.current.skimmedArticles).toEqual([])
  })
})
