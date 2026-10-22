// @vitest-environment jsdom
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createLibrary } from '../../core/vocab'
import { vocabItem } from '../../core/testFixtures'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { useStudyCardEdit, type UseStudyCardEditOptions } from './useStudyCardEdit'

/** 卡内编辑 / 两步删除：草稿带出、保存落库、删除时同步本轮队列与进度。 */
const items = [
  vocabItem({
    id: 'w1',
    word: 'run',
    lemma: 'run',
    usage: ['run a business', 'run out'],
    phrases: ['run out of'],
    grammarMarks: ['不及物'],
  }),
  vocabItem({ id: 'w2', word: 'walk', lemma: 'walk' }),
]
const library: VocabLibrary = { ...createLibrary(), items }
const persist = vi.fn()
const flash = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

function useHarness(over: Partial<UseStudyCardEditOptions> = {}) {
  const [queue, setQueue] = useState<VocabItem[] | null>(items)
  const [index, setIndex] = useState(0)
  const [roundTotal, setRoundTotal] = useState(items.length)
  const [revealed, setRevealed] = useState(true)
  const [input, setInput] = useState('typed')
  const [checked, setChecked] = useState(true)
  const edit = useStudyCardEdit({
    card: queue?.[index] ?? null,
    library,
    queue,
    index,
    persist,
    flash,
    setQueue,
    setRoundTotal,
    setIndex,
    setRevealed,
    setInput,
    setChecked,
    ...over,
  })
  return { ...edit, queue, index, roundTotal, revealed, input, checked }
}

describe('useStudyCardEdit：编辑', () => {
  it('打开编辑带出当前值（多条用法用「；」拼）', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.openEdit())
    expect(result.current.editOpen).toBe(true)
    expect(result.current.draft?.word).toBe('run')
    expect(result.current.draft?.usage).toBe('run a business；run out')
    expect(result.current.draft?.phrases).toBe('run out of')
  })

  it('保存：拆回数组并持久化；空词形回退原词', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.openEdit())
    act(() => result.current.setDraft({ ...result.current.draft!, word: '  ', usage: 'a；b\nc' }))
    act(() => result.current.saveEdit())

    expect(persist).toHaveBeenCalledTimes(1)
    const saved = persist.mock.calls[0][0] as VocabLibrary
    const edited = saved.items.find((x) => x.id === 'w1')!
    expect(edited.word).toBe('run')
    expect(edited.usage).toEqual(['a', 'b', 'c'])
    expect(flash).toHaveBeenCalledWith('已保存修改')
    expect(result.current.editOpen).toBe(false)
    expect(result.current.draft).toBeNull()
  })

  it('只改释义时，词性等没动的字段不被标成 manual（否则以后再也纠不了）', () => {
    const withPos = [
      vocabItem({ id: 'w1', word: 'consort', lemma: 'consort', partOfSpeech: 'n.', meaning: '配偶', fieldSources: { partOfSpeech: 'dict', meaning: 'dict' } }),
    ]
    const lib: VocabLibrary = { ...createLibrary(), items: withPos }
    const { result } = renderHook(() => useHarness({ card: withPos[0], library: lib }))
    act(() => result.current.openEdit())
    act(() => result.current.setDraft({ ...result.current.draft!, meaning: '交往；厮混' }))
    act(() => result.current.saveEdit())

    const edited = (persist.mock.calls[0][0] as VocabLibrary).items[0]
    expect(edited.meaning).toBe('交往；厮混')
    expect(edited.fieldSources).toEqual({ meaning: 'manual', partOfSpeech: 'dict' })
  })

  it('一个字都没改 → 不写库', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.openEdit())
    act(() => result.current.saveEdit())
    expect(persist).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('没有改动')
  })
})

describe('useStudyCardEdit：两步删除', () => {
  it('第一下只进入确认态，第二下才删除并同步队列/进度/卡片状态', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.removeCard())
    expect(result.current.delArmed).toBe(true)
    expect(persist).not.toHaveBeenCalled()

    act(() => result.current.removeCard())
    expect(persist).toHaveBeenCalledTimes(1)
    expect(result.current.queue?.map((x) => x.id)).toEqual(['w2'])
    expect(result.current.roundTotal).toBe(1)
    expect(result.current.index).toBe(0)
    expect(result.current.revealed).toBe(false)
    expect(result.current.input).toBe('')
    expect(result.current.checked).toBe(false)
    expect(result.current.delArmed).toBe(false)
    expect(flash).toHaveBeenCalledWith('已删除')
  })
})
