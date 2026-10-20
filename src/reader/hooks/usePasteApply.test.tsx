// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { usePasteApply } from './usePasteApply'
import type { ApplyOutcome } from './useApplyTaskResult'

function setup(over: Partial<Parameters<typeof usePasteApply>[0]> = {}) {
  const askedWordsRef = { current: ['asked'] } as MutableRefObject<string[]>
  const askedIdsRef = { current: ['s1'] } as MutableRefObject<string[]>
  const clearPasted = vi.fn()
  const flash = vi.fn()
  const onReport = vi.fn()
  const onMissing = vi.fn()
  const applyAiWeb = vi.fn(() => true)
  const ok: ApplyOutcome = { ok: true, report: ['已应用 2 条'], missing: null }
  const applyTaskResult = vi.fn(() => ok)
  const params = {
    pasted: '',
    clearPasted,
    lastTask: 'translate' as const,
    applyTaskResult,
    askedWordsRef,
    askedIdsRef,
    onReport,
    onMissing,
    applyAiWeb,
    flash,
    ...over,
  }
  const hook = renderHook(() => usePasteApply(params))
  return { ...hook, applyTaskResult, applyAiWeb, clearPasted, flash, onReport, onMissing, askedWordsRef, askedIdsRef }
}

describe('usePasteApply：单任务应用', () => {
  it('空输入不解析、不提示', () => {
    const { result, applyTaskResult, flash } = setup({ pasted: '   ' })
    act(() => result.current.applyPaste())
    expect(applyTaskResult).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  })

  it('成功：回执写回面板、清空输入、提示第一条回执', () => {
    const { result, applyTaskResult, clearPasted, flash, onReport, onMissing, askedWordsRef, askedIdsRef } = setup({
      pasted: '  {"word":"run"}  ',
    })
    act(() => result.current.applyPaste())
    expect(applyTaskResult).toHaveBeenCalledWith('translate', '{"word":"run"}', ['asked'], ['s1'])
    expect(onReport).toHaveBeenCalledWith(['已应用 2 条'])
    expect(onMissing).toHaveBeenCalledWith(null)
    expect(clearPasted).toHaveBeenCalledOnce()
    expect(flash).toHaveBeenCalledWith('已应用 2 条')
    expect(askedWordsRef.current).toEqual(['asked'])
    expect(askedIdsRef.current).toEqual(['s1'])
  })

  it('失败：保留输入，提示回执；没回执时给兜底文案', () => {
    const failed = { ok: false, report: ['缺少 1 个词'], missing: { task: 'lookup' as const, words: ['run'] } }
    const { result, clearPasted, flash, onMissing } = setup({ pasted: 'xxx', applyTaskResult: vi.fn(() => failed) })
    act(() => result.current.applyPaste())
    expect(clearPasted).not.toHaveBeenCalled()
    expect(onMissing).toHaveBeenCalledWith(failed.missing)
    expect(flash).toHaveBeenCalledWith('缺少 1 个词')

    const empty = { ok: false, report: [], missing: null }
    const second = setup({ pasted: 'xxx', applyTaskResult: vi.fn(() => empty) })
    act(() => second.result.current.applyPaste())
    expect(second.flash).toHaveBeenCalledWith('没解析出内容')
  })

  it('语言点 JSON 自动识别：没先点「语言点」也按 language 应用', () => {
    const { result, applyTaskResult } = setup({ pasted: '{"phrases":[{"word":"run out"}]}', lastTask: 'translate' })
    act(() => result.current.applyPaste())
    expect(applyTaskResult).toHaveBeenCalledWith('language', expect.any(String), expect.any(Array), expect.any(Array))
  })

  it('带 translation 的 JSON 不误判成语言点', () => {
    const { result, applyTaskResult } = setup({
      pasted: '{"translation":"x","phrases":[]}',
      lastTask: 'translate',
    })
    act(() => result.current.applyPaste())
    expect(applyTaskResult).toHaveBeenCalledWith('translate', expect.any(String), expect.any(Array), expect.any(Array))
  })
})

describe('usePasteApply：统一入口', () => {
  it('工作包（@@@ANSWER）交给网页版解析，成功清空、不走单任务', () => {
    const { result, applyAiWeb, clearPasted, applyTaskResult } = setup({ pasted: '@@@ANSWER xxx' })
    act(() => result.current.applyAnyPaste())
    expect(applyAiWeb).toHaveBeenCalledWith('@@@ANSWER xxx')
    expect(applyTaskResult).not.toHaveBeenCalled()
    expect(clearPasted).toHaveBeenCalledOnce()
  })

  it('工作包解析失败时保留输入框内容', () => {
    const { result, clearPasted } = setup({ pasted: '{"results":[]}', applyAiWeb: vi.fn(() => false) })
    act(() => result.current.applyAnyPaste())
    expect(clearPasted).not.toHaveBeenCalled()
  })

  it('普通结果退回单任务解析', () => {
    const { result, applyAiWeb, applyTaskResult } = setup({ pasted: '{"word":"run"}' })
    act(() => result.current.applyAnyPaste())
    expect(applyAiWeb).not.toHaveBeenCalled()
    expect(applyTaskResult).toHaveBeenCalledOnce()
  })

  it('空输入两个入口都不动作', () => {
    const { result, applyAiWeb, applyTaskResult } = setup({ pasted: '' })
    act(() => result.current.applyAnyPaste())
    expect(applyAiWeb).not.toHaveBeenCalled()
    expect(applyTaskResult).not.toHaveBeenCalled()
  })
})
