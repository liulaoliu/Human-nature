// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CycleRow } from './CycleRow'

const base = {
  autoCycle: false,
  hangoverMs: 2500,
  activeHangoverMs: 2500,
  autoRecordMs: 8000,
  cycleStep: 'idle' as const,
  onToggle: () => {},
  onHangover: () => {},
}

describe('CycleRow', () => {
  it('关着时只有开关，没有静音设置', () => {
    render(<CycleRow {...base} />)
    expect(screen.getByRole('checkbox')).toBeTruthy()
    expect(screen.queryByText('说完静音')).toBeNull()
  })

  it('打开后可调静音时长，回传毫秒', () => {
    const onHangover = vi.fn()
    render(<CycleRow {...base} autoCycle onHangover={onHangover} />)
    const select = screen.getByRole('combobox')
    expect((select as HTMLSelectElement).value).toBe('2500')
    fireEvent.change(select, { target: { value: '4000' } })
    expect(onHangover).toHaveBeenCalledWith(4000)
  })

  it('录音 / 标准音 / 回放三步各有提示', () => {
    const { rerender } = render(<CycleRow {...base} autoCycle cycleStep="rec" />)
    expect(screen.getByText(/说完停 2.5 秒自动结束（最长 8 秒）/)).toBeTruthy()

    rerender(<CycleRow {...base} autoCycle cycleStep="ref" />)
    expect(screen.getByText('正在放标准音…')).toBeTruthy()

    rerender(<CycleRow {...base} autoCycle cycleStep="playback" />)
    expect(screen.getByText('回放中（我的录音）…')).toBeTruthy()
  })

  it('开关回传勾选状态', () => {
    const onToggle = vi.fn()
    render(<CycleRow {...base} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
