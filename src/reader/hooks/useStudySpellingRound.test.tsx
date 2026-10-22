// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useStudySpellingRound, type StudySpellingRound } from './useStudySpellingRound'
import { vocabItem } from '../../core/testFixtures'
import type { VocabItem } from '../../types/document'

/**
 * 组末拼写测试的状态机：拼对放行、拼错落库 + 原文重打（判定不改），
 * 学了多少拼多少（序列长度不限），全拼完回调 onDone。
 */
let api: StudySpellingRound | null = null
const missed: VocabItem[] = []
const done = vi.fn()

function Harness() {
  api = useStudySpellingRound({ onMiss: (item) => missed.push(item), onDone: done })
  return null
}

const word = (id: string, w: string) => vocabItem({ id, word: w, lemma: w, meaning: '释义' + id })
const group = () => [word('a', 'apple'), word('b', 'banana'), word('c', 'cherry')]

beforeEach(() => {
  missed.length = 0
  done.mockClear()
  api = null
})

describe('useStudySpellingRound：序列与推进', () => {
  it('begin 建立测试状态，第一词即当前卡；未开始时 test 为 null', () => {
    render(<Harness />)
    expect(api!.test).toBeNull()
    expect(api!.card).toBeNull()
    act(() => api!.begin(group()))
    expect(api!.test).toEqual({ index: 0, total: 3 })
    expect(api!.card?.word).toBe('apple')
    expect(api!.input).toBe('')
    expect(api!.miss).toBeNull()
  })

  it('拼对 → 下一词；全部拼完 → test 清空 + onDone 一次', () => {
    render(<Harness />)
    act(() => api!.begin(group()))
    for (const [i, w] of ['apple', 'banana', 'cherry'].entries()) {
      act(() => api!.setInput(w))
      act(() => api!.check())
      if (i < 2) {
        expect(api!.test).toEqual({ index: i + 1, total: 3 })
        expect(api!.miss).toBeNull()
      }
    }
    expect(api!.test).toBeNull()
    expect(api!.card).toBeNull()
    expect(done).toHaveBeenCalledTimes(1)
    expect(missed).toHaveLength(0)
  })

  it('大小写 / 空格差异不算错（与 core 口径一致）', () => {
    render(<Harness />)
    act(() => api!.begin(group()))
    act(() => api!.setInput('  APPLE '))
    act(() => api!.check())
    expect(api!.test).toEqual({ index: 1, total: 3 })
    expect(missed).toHaveLength(0)
  })
})

describe('useStudySpellingRound：拼错与重打', () => {
  it('拼错：onMiss 落库一次 + 显示原文；输入为空才展示（组件约定），重打对了放行且不改判定', () => {
    render(<Harness />)
    act(() => api!.begin(group()))
    act(() => api!.setInput('aple'))
    act(() => api!.check())
    expect(missed).toHaveLength(1)
    expect(missed[0].word).toBe('apple')
    expect(api!.miss).toMatchObject({ typed: 'aple', word: 'apple' })
    expect(api!.test).toEqual({ index: 0, total: 3 })

    // 重打：先错一次（原文重新显示），再照原文打对 → 放行，onMiss 不再涨
    act(() => api!.setInput('aplpe'))
    act(() => api!.check())
    expect(missed).toHaveLength(1)
    expect(api!.miss).toMatchObject({ typed: 'aplpe' })

    act(() => api!.setInput('apple'))
    act(() => api!.check())
    expect(missed).toHaveLength(1)
    expect(api!.miss).toBeNull()
    expect(api!.test).toEqual({ index: 1, total: 3 })
    expect(done).not.toHaveBeenCalled()
  })

  it('begin 会清掉上一轮的输入与判错卡', () => {
    render(<Harness />)
    act(() => api!.begin(group()))
    act(() => api!.setInput('aple'))
    act(() => api!.check())
    expect(api!.miss).not.toBeNull()
    act(() => api!.begin(group()))
    expect(api!.miss).toBeNull()
    expect(api!.input).toBe('')
    expect(api!.test).toEqual({ index: 0, total: 3 })
  })

  it('reset 清空一切，onDone 不触发', () => {
    render(<Harness />)
    act(() => api!.begin(group()))
    act(() => api!.setInput('aple'))
    act(() => api!.check())
    act(() => api!.reset())
    expect(api!.test).toBeNull()
    expect(api!.miss).toBeNull()
    expect(done).not.toHaveBeenCalled()
  })
})
