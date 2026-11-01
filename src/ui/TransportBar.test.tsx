// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AbCompareRow, TransportBar } from './TransportBar'

const base = {
  current: 0,
  chunkCount: 2,
  playing: false,
  autoCycle: false,
  cycleStep: 'idle' as const,
  rate: 1,
  granularity: 'normal' as const,
  splitOpen: false,
  chunkEditCount: 0,
  onPrev: () => {},
  onPlay: () => {},
  onNext: () => {},
  onRate: () => {},
  onGranularity: () => {},
  onToggleSplit: () => {},
}

describe('TransportBar', () => {
  it('普通播放显示「标准音」，首块禁用上一块、末块禁用下一块', () => {
    const { rerender } = render(<TransportBar {...base} />)
    expect(screen.getByRole('button', { name: /标准音/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /上一块/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /下一块/ }).hasAttribute('disabled')).toBe(false)

    rerender(<TransportBar {...base} current={1} />)
    expect(screen.getByRole('button', { name: /上一块/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /下一块/ }).hasAttribute('disabled')).toBe(true)
  })

  it('播放中 / 连续跟读的按钮文案跟着状态变', () => {
    const { rerender } = render(<TransportBar {...base} playing />)
    expect(screen.getByRole('button', { name: /暂停/ })).toBeTruthy()

    rerender(<TransportBar {...base} autoCycle />)
    expect(screen.getByRole('button', { name: /跟读一轮/ })).toBeTruthy()

    rerender(<TransportBar {...base} autoCycle cycleStep="rec" />)
    expect(screen.getByRole('button', { name: /停止本轮/ })).toBeTruthy()
  })

  it('语速 / 切块 / 撕开开关都回传对应值', () => {
    const onRate = vi.fn()
    const onGranularity = vi.fn()
    const onToggleSplit = vi.fn()
    render(
      <TransportBar
        {...base}
        onRate={onRate}
        onGranularity={onGranularity}
        onToggleSplit={onToggleSplit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '1.5x' }))
    fireEvent.click(screen.getByRole('button', { name: '长' }))
    fireEvent.click(screen.getByRole('button', { name: /撕开/ }))
    expect(onRate).toHaveBeenCalledWith(1.5)
    expect(onGranularity).toHaveBeenCalledWith('long')
    expect(onToggleSplit).toHaveBeenCalled()
  })

  it('有手动切分时显示处数', () => {
    render(<TransportBar {...base} chunkEditCount={3} />)
    expect(screen.getByText('已手动切 3 处')).toBeTruthy()
  })
})

describe('AbCompareRow', () => {
  it('对比中才出现「停下」，各按钮各自回传', () => {
    const onCompare = vi.fn()
    const onLoopCompare = vi.fn()
    const onStop = vi.fn()
    const onPlayWhole = vi.fn()
    const { rerender } = render(
      <AbCompareRow
        abPlaying={false}
        onCompare={onCompare}
        onLoopCompare={onLoopCompare}
        onStop={onStop}
        onPlayWhole={onPlayWhole}
      />,
    )
    expect(screen.queryByRole('button', { name: '停下' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '标准 → 我的' }))
    fireEvent.click(screen.getByRole('button', { name: '循环对比' }))
    fireEvent.click(screen.getByRole('button', { name: '整篇连播' }))
    expect(onCompare).toHaveBeenCalled()
    expect(onLoopCompare).toHaveBeenCalled()
    expect(onPlayWhole).toHaveBeenCalled()

    rerender(
      <AbCompareRow
        abPlaying
        onCompare={onCompare}
        onLoopCompare={onLoopCompare}
        onStop={onStop}
        onPlayWhole={onPlayWhole}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '停下' }))
    expect(onStop).toHaveBeenCalled()
  })
})
