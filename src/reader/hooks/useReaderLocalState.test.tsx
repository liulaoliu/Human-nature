// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useArticleDocState, usePasteState, useReaderHighlightState } from './useReaderLocalState'

describe('useReaderLocalState：从 ReaderApp 抽出的本机组装状态', () => {
  it('粘回框 / 回执 / 缺失项 / 上次任务都能独立更新', () => {
    const { result } = renderHook(() => usePasteState())
    expect(result.current.pasted).toBe('')
    expect(result.current.lastTask).toBeNull()
    expect(result.current.pasteMissing).toBeNull()

    act(() => {
      result.current.setPasted('AI 结果')
      result.current.setLastTask('lookup')
      result.current.setPasteReport(['成功 1 条'])
      result.current.setPasteMissing([{ word: 'bank', reason: '缺释义' }] as never)
      result.current.askedWordsRef.current = ['bank']
      result.current.askedIdsRef.current = ['s1']
    })

    expect(result.current.pasted).toBe('AI 结果')
    expect(result.current.lastTask).toBe('lookup')
    expect(result.current.pasteReport).toEqual(['成功 1 条'])
    expect(result.current.pasteMissing).toHaveLength(1)
    expect(result.current.askedWordsRef.current).toEqual(['bank'])
    expect(result.current.askedIdsRef.current).toEqual(['s1'])
  })

  it('高亮 / 气泡 / 删除确认互不干扰', () => {
    const { result } = renderHook(() => useReaderHighlightState())
    act(() => {
      result.current.setPeekSid('s1')
      result.current.setFocusLemma('bank')
      result.current.setConfirmDel('w1')
      result.current.setLastPicked({ word: 'bank', sid: 's1' })
      result.current.setBubblePos({ top: 10, left: 20 })
    })
    expect(result.current.peekSid).toBe('s1')
    expect(result.current.focusLemma).toBe('bank')
    expect(result.current.confirmDel).toBe('w1')
    expect(result.current.lastPicked).toEqual({ word: 'bank', sid: 's1' })
    expect(result.current.bubblePos).toEqual({ top: 10, left: 20 })
  })

  it('文章 / 正文 / 选区的 setter 正常工作', () => {
    const { result } = renderHook(() => useArticleDocState())
    expect(result.current.doc).toBeNull()
    expect(result.current.useExact).toBe(false)

    act(() => {
      result.current.setArticleKey('005')
      result.current.setDoc({ paragraphs: ['p'], sentences: ['s'] } as never)
      result.current.setSelectedId('s1')
      result.current.setExact('bank')
      result.current.setUseExact(true)
      result.current.setSelSid('s1')
      result.current.setSelIndices([0, 2])
      result.current.setArticleTitle('标题')
      result.current.setSavedId('saved-1')
      result.current.setConfirmDelSave(true)
    })

    expect(result.current.articleKey).toBe('005')
    expect(result.current.doc).not.toBeNull()
    expect(result.current.selectedId).toBe('s1')
    expect(result.current.exact).toBe('bank')
    expect(result.current.useExact).toBe(true)
    expect(result.current.selSid).toBe('s1')
    expect(result.current.selIndices).toEqual([0, 2])
    expect(result.current.articleTitle).toBe('标题')
    expect(result.current.savedId).toBe('saved-1')
    expect(result.current.confirmDelSave).toBe(true)
  })
})
