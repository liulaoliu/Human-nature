// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { installFakeStorage } from '../testStorage'
import { sentenceFixture } from '../../core/testFixtures'
import { articleKey } from '../../core/docSignature'
import { useSpeedReadWords, type UseSpeedReadWordsOptions } from './useSpeedReadWords'

/**
 * 速读选词层：按词下标选择 / 合成词组 / 入库 / 本页清单持久化 / 两步确认移出。
 * 渲染与快捷键在面板层（`SpeedReadPanel.test.tsx`），这里只钉数据与操作。
 */
const sentence = sentenceFixture('s1', 'Hello world again.')

let restoreStorage: () => void = () => {}

function options(over: Partial<UseSpeedReadWordsOptions> = {}): UseSpeedReadWordsOptions {
  return {
    docKey: 'doc-1',
    sentence,
    selectionResetKey: 0,
    isKnown: () => false,
    wordsInSentence: () => [],
    onAddItems: vi.fn(),
    onRemoveWord: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  restoreStorage = installFakeStorage()
})

afterEach(() => {
  restoreStorage()
  vi.restoreAllMocks()
})

describe('useSpeedReadWords：选择与入库', () => {
  it('按词下标多选、合成词组后作为一条加入生词本并清空选择', () => {
    const onAddItems = vi.fn()
    const { result } = renderHook(() => useSpeedReadWords(options({ onAddItems })))

    expect(result.current.spans.map((s) => s.text)).toEqual(['Hello', 'world', 'again'])
    act(() => {
      result.current.toggleSel(0)
      result.current.toggleSel(1)
    })
    expect(result.current.selWords).toEqual(['Hello', 'world'])

    act(() => result.current.mergePhrase())
    expect(result.current.selWords).toEqual(['Hello world'])

    act(() => result.current.addSelected())
    expect(onAddItems).toHaveBeenCalledWith([
      { word: 'Hello world', sentenceId: 's1', sentenceText: 'Hello world again.' },
    ])
    expect(result.current.selWords).toEqual([])
  })

  it('右键直接入库：只加那一个词，并把它从选择里去掉', () => {
    const onAddItems = vi.fn()
    const { result } = renderHook(() => useSpeedReadWords(options({ onAddItems })))
    act(() => result.current.toggleSel(1))
    act(() => result.current.addDirect(1))
    expect(onAddItems).toHaveBeenCalledWith([
      { word: 'world', sentenceId: 's1', sentenceText: 'Hello world again.' },
    ])
    expect(result.current.selWords).toEqual([])
  })

  it('手打词去空格后入库；空白不提交', () => {
    const onAddItems = vi.fn()
    const { result } = renderHook(() => useSpeedReadWords(options({ onAddItems })))
    act(() => result.current.addCustom('   '))
    expect(onAddItems).not.toHaveBeenCalled()

    act(() => result.current.addCustom('  phrase  '))
    expect(onAddItems).toHaveBeenCalledWith([
      { word: 'phrase', sentenceId: 's1', sentenceText: 'Hello world again.' },
    ])
    expect(result.current.wordDraft).toBe('')
  })

  it('换句时清空选择；clearSelection 也清空', () => {
    const opts = options()
    const { result, rerender } = renderHook((p: UseSpeedReadWordsOptions) => useSpeedReadWords(p), {
      initialProps: opts,
    })
    act(() => result.current.toggleSel(0))
    expect(result.current.selWords).toEqual(['Hello'])

    rerender({ ...opts, selectionResetKey: 1 })
    expect(result.current.selWords).toEqual([])

    act(() => result.current.toggleSel(2))
    act(() => result.current.clearSelection())
    expect(result.current.selWords).toEqual([])
  })
})

describe('useSpeedReadWords：本页清单', () => {
  it('本页清单按 docKey 落盘，重开同一篇仍在；不同篇互不串', () => {
    const opts = options()
    const { result, unmount } = renderHook(() => useSpeedReadWords(opts))
    act(() => result.current.addCustom('run'))
    expect(result.current.collected.map((x) => x.word)).toEqual(['run'])
    unmount()

    const again = renderHook(() => useSpeedReadWords(options())).result
    expect(again.current.collected.map((x) => x.word)).toEqual(['run'])
  })

  it('换篇时重读新文章清单，旧清单不会写到新键上', () => {
    const a = articleKey('doc-1', [sentenceFixture('s1', 'A text.')])
    const b = articleKey('doc-1', [sentenceFixture('s1', 'B text.')])
    const { result, rerender } = renderHook((p: UseSpeedReadWordsOptions) => useSpeedReadWords(p), {
      initialProps: options({ docKey: a }),
    })
    act(() => result.current.addCustom('run'))
    expect(result.current.collected.map((x) => x.word)).toEqual(['run'])

    rerender(options({ docKey: b }))
    expect(result.current.collected).toEqual([])

    // 换回 A：它自己的清单还在，没被 B 的清空覆盖
    rerender(options({ docKey: a }))
    expect(result.current.collected.map((x) => x.word)).toEqual(['run'])
  })

  it('两步确认删除：第一次只标记，第二次才移出生词本', () => {
    const onRemoveWord = vi.fn()
    const { result } = renderHook(() => useSpeedReadWords(options({ onRemoveWord })))
    act(() => result.current.addCustom('run'))

    act(() => result.current.tapDelete(0))
    expect(onRemoveWord).not.toHaveBeenCalled()
    expect(result.current.confirmIdx).toBe(0)

    act(() => result.current.tapDelete(0))
    expect(onRemoveWord).toHaveBeenCalledWith('run')
    expect(result.current.collected).toEqual([])
  })

  it('已在生词本的词 + 本句词条去重（忽略大小写）', () => {
    const { result } = renderHook(() =>
      useSpeedReadWords(
        options({
          isKnown: (w) => w === 'Hello',
          wordsInSentence: () => ['hello', 'Hello world'],
        }),
      ),
    )
    expect(result.current.knownWords).toEqual(['Hello', 'Hello world'])
  })

  it('两步确认移出生词本：第一次只标记，第二次才回调', () => {
    const onRemoveWord = vi.fn()
    const { result } = renderHook(() => useSpeedReadWords(options({ onRemoveWord })))
    act(() => result.current.tapRemove('run'))
    expect(onRemoveWord).not.toHaveBeenCalled()
    expect(result.current.confirmDel).toBe('run')

    act(() => result.current.tapRemove('run'))
    expect(onRemoveWord).toHaveBeenCalledWith('run')
    expect(result.current.confirmDel).toBe('')
  })
})
