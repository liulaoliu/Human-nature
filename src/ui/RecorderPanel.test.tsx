// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RecorderPanel } from './RecorderPanel'

const base = {
  recording: false,
  level: 0.42,
  micDevice: '',
  inputs: [
    { deviceId: 'mic-1', label: '内置麦克风' },
    { deviceId: 'mic-2', label: 'USB 麦克风' },
  ],
  micRaw: false,
  takeBoost: 1,
  onToggleRecord: () => {},
  onMicDevice: () => {},
  onMicRaw: () => {},
  onTestMic: () => {},
  onTakeBoost: () => {},
}

describe('RecorderPanel', () => {
  it('录音按钮文案随状态切换，试录在录音时禁用', () => {
    const onToggleRecord = vi.fn()
    const { rerender } = render(<RecorderPanel {...base} onToggleRecord={onToggleRecord} />)
    fireEvent.click(screen.getByRole('button', { name: '● 录音（R）' }))
    expect(onToggleRecord).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '试录 2.5 秒' }).hasAttribute('disabled')).toBe(false)

    rerender(<RecorderPanel {...base} recording onToggleRecord={onToggleRecord} />)
    expect(screen.getByRole('button', { name: '■ 停止并回放（R）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '试录 2.5 秒' }).hasAttribute('disabled')).toBe(true)
  })

  it('电平显示数值与条宽', () => {
    const { container } = render(<RecorderPanel {...base} />)
    expect(screen.getByTitle(/当前输入电平/).textContent).toBe('0.42')
    expect((container.querySelector('.meter .bar') as HTMLElement).style.width).toBe('42%')
  })

  it('设备 / 音质 / 回放放大都回传对应值', () => {
    const onMicDevice = vi.fn()
    const onMicRaw = vi.fn()
    const onTakeBoost = vi.fn()
    render(
      <RecorderPanel
        {...base}
        onMicDevice={onMicDevice}
        onMicRaw={onMicRaw}
        onTakeBoost={onTakeBoost}
      />,
    )
    const [device, boost] = screen.getAllByRole('combobox')
    fireEvent.change(device, { target: { value: 'mic-2' } })
    fireEvent.click(screen.getByRole('button', { name: '原声' }))
    fireEvent.change(boost, { target: { value: '2' } })
    expect(onMicDevice).toHaveBeenCalledWith('mic-2')
    expect(onMicRaw).toHaveBeenCalledWith(true)
    expect(onTakeBoost).toHaveBeenCalledWith(2)
  })
})
