// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useArticleMarks } from './useArticleMarks'
import { createLibrary, markWord } from '../../core/vocab'
import { installFakeStorage } from '../testStorage'
import { TEST_NOW } from '../../core/testFixtures'
import { writeJson } from '../storage'

/**
 * 「从正文标记自动找回」的接线与**三条安全边界**（丢词事故后最重要的一条路）。
 * 自动写库必须苛刻：只在读成功 + 词库确实没单词 + 正文确实有标记 + 只做一次。
 */
const saved = [
  { id: 'A 篇', sentences: [{ id: 's1', text: 'He is ensconced in the job.', vocab: ['ensconced', 'job'] }] },
]

let restore: () => void = () => {}
beforeEach(() => {
  restore = installFakeStorage()
})
afterEach(() => restore())

function setup(over: Partial<Parameters<typeof useArticleMarks>[0]> = {}) {
  const rebuild = vi.fn()
  const flash = vi.fn()
  const props = {
    saved,
    sentences: null,
    articleIdentity: 'A 篇',
    rebuild,
    enrich: undefined,
    library: createLibrary(), // 空词库
    libraryLoad: 'ok' as const,
    flash,
    ...over,
  }
  const view = renderHook((p: typeof props) => useArticleMarks(p), { initialProps: props })
  return { ...view, rebuild, flash, props }
}

describe('useArticleMarks：统计与手动重建', () => {
  it('统计正文标记里的词数（去重）', () => {
    const { result } = setup()
    expect(result.current.markedWordCount).toBe(2)
  })

  it('手动重建：把汇总好的文章交给 rebuild', async () => {
    writeJson('reader:marksAutoHealDone', true) // 关掉自动救回，单独测手动这条路
    const { result, rebuild } = setup()
    result.current.rebuildFromMarks()
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(rebuild.mock.calls[0][0][0].sentences[0].vocab).toEqual(['ensconced', 'job'])
  })
})

describe('useArticleMarks：自动找回（0 点击）的三条边界', () => {
  it('词库空 + 正文有标记 + 读成功 → 自动重建一次并提示', async () => {
    const { rebuild, flash } = setup()
    await waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1))
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('自动找回'))
    expect(rebuild.mock.calls[0][1]).toBeUndefined() // 没传 enrich 就不传
  })

  it('读失败（failed）→ 一个字都不写', () => {
    const { rebuild } = setup({ libraryLoad: 'failed' })
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('词库里本来就有单词 → 不动它', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'A' }, TEST_NOW).library
    const { rebuild } = setup({ library: lib })
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('已经自动救回过了（落盘标记）→ 不再自动动手', () => {
    writeJson('reader:marksAutoHealDone', true)
    const { rebuild } = setup()
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('正文里没有标记 → 不动', () => {
    const { rebuild } = setup({ saved: [{ id: 'A', sentences: [{ id: 's1', text: 'plain', vocab: [] }] }] })
    expect(rebuild).not.toHaveBeenCalled()
  })
})
