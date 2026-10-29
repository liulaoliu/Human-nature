// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import { Harness, api, lib, fakeStorageHarness } from './studySessionHarness'

const storage = fakeStorageHarness()
beforeEach(storage.setup)
afterEach(storage.teardown)

/**
 * 会话的导航与设置接线：Q/E 切卡、分牌组、朗读、卡内编辑暂停计时。
 * 评分与排队算法在 core/vocab（已单测），这里只测 hook 的接线。
 */

describe('useStudySession：单词之间切换', () => {
  it('E 下一个、Q 上一个；组末先拼写（学多少拼多少），拼完才进完成页', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' }),
          vocabItem({ id: 'w2', word: 'two', lemma: 'two', meaning: '二' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.index).toBe(1)

    // 最后一组的组末：E 不再直接翻页，而是停下做组末拼写（默认每组 = 范围全部）
    fireEvent.keyDown(window, { key: 'e' })
    expect(api!.roundTest).toEqual({ index: 0, total: 2 })
    expect(api!.index).toBe(1)

    act(() => api!.onRoundInputChange('one'))
    act(() => api!.onRoundCheck())
    act(() => api!.onRoundInputChange('two'))
    act(() => api!.onRoundCheck())
    expect(api!.roundTest).toBeNull()
    expect(api!.index).toBe(2) // 拼完 = 本轮完成页

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(1)

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(0)

    fireEvent.keyDown(window, { key: 'q' })
    expect(api!.index).toBe(0) // 第一张不再往前
    unmount()
  })
})

describe('useStudySession：背单词 / 背搭配分牌组', () => {  it('背单词只组单词，切到背搭配只组词组/习语', () => {
    const { unmount } = render(
      <Harness
        library={lib([
          vocabItem({ id: 'w1', word: 'run', lemma: 'run', kind: 'word', meaning: '跑' }),
          vocabItem({ id: 'p1', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', meaning: '依赖' }),
        ])}
      />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    expect(api!.queue?.map((it) => it.id)).toEqual(['w1'])

    act(() => api!.switchDeck('collocation'))
    expect(api!.deck).toBe('collocation')
    expect(api!.queue?.map((it) => it.id)).toEqual(['p1'])
    unmount()
  })
})

describe('useStudySession：R 朗读当前单词', () => {
  it('R 和卡片右侧按钮走同一个朗读入口', () => {
    const speak = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} speak={speak} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))

    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).toHaveBeenCalledWith('one')
    unmount()
  })

  it('拼写模式判卷前不朗读（防剧透），判卷后可读', () => {
    const speak = vi.fn()
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} speak={speak} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setSpelling(true))

    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).not.toHaveBeenCalled()

    act(() => api!.setChecked(true))
    fireEvent.keyDown(window, { key: 'r' })
    expect(speak).toHaveBeenCalledWith('one')
    unmount()
  })
})

describe('useStudySession：会话动作', () => {
  it('切拼写模式会清掉上一题输入和判卷状态', () => {
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.setInput('on'))
    act(() => api!.setChecked(true))

    act(() => api!.changeSpelling(true))
    expect(api!.spelling).toBe(true)
    expect(api!.input).toBe('')
    expect(api!.checked).toBe(false)
    unmount()
  })

  it('取消编辑同时关表单、丢草稿', () => {
    const { unmount } = render(
      <Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} />,
    )
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => api!.openEdit())
    expect(api!.editOpen).toBe(true)
    expect(api!.draft?.word).toBe('one')

    act(() => api!.cancelEdit())
    expect(api!.editOpen).toBe(false)
    expect(api!.draft).toBeNull()
    unmount()
  })
})

describe('useStudySession：卡内编辑暂停计时', () => {
  it('编辑 10 秒两只表都不动，关闭编辑后继续', () => {
    vi.useFakeTimers()
    const { unmount } = render(<Harness library={lib([vocabItem({ id: 'w1', word: 'one', lemma: 'one', meaning: '一' })])} />)
    act(() => api!.start({ mode: 'learn', scope: 'all' }))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(api!.cardSeconds).toBe(3)

    act(() => api!.openEdit())
    expect(api!.editOpen).toBe(true)
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(api!.cardSeconds).toBe(3)
    expect(api!.liveSeconds).toBe(3)

    act(() => api!.setEditOpen(false))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(api!.cardSeconds).toBe(5)
    expect(api!.liveSeconds).toBe(5)
    unmount()
  })
})
