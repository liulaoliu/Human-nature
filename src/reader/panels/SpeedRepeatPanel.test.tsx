// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { REPEAT_RATES } from '../../core/repeatCycle'
import { sentenceFixture } from '../../core/testFixtures'
import type { RepeatTake } from '../../core/repeatTake'
import SpeedRepeatPanel from './SpeedRepeatPanel'
import type { RepeatSessionApi } from '../hooks/useRepeatSession'

function api(over: Partial<RepeatSessionApi> = {}): RepeatSessionApi {
  return {
    rate: 1,
    setRate: vi.fn(),
    rates: REPEAT_RATES,
    loop: 1,
    setLoop: vi.fn(),
    loopText: '1 遍',
    autoNext: true,
    setAutoNext: vi.fn(),
    boost: 1.5,
    setBoost: vi.fn(),
    playing: null,
    cycleStep: 'idle',
    cycleLabel: '',
    cycleOn: false,
    take: null,
    loadingTake: false,
    recording: false,
    level: 0,
    lowMic: false,
    error: null,
    devices: [],
    deviceId: '',
    setDeviceId: vi.fn(),
    raw: true,
    setRaw: vi.fn(),
    playRef: vi.fn(),
    playTake: vi.fn(),
    toggleCycle: vi.fn(),
    toggleRecord: vi.fn(),
    stop: vi.fn(),
    exit: vi.fn(),
    ...over,
  }
}

const sentence = sentenceFixture('s1', 'Run fast.')
const take: RepeatTake = {
  id: 'doc:1\u0000s1',
  articleKey: 'doc:1',
  sentenceId: 's1',
  sentenceText: 'Run fast.',
  blob: new Blob(['x']),
  mimeType: 'audio/webm',
  durationSec: 2.4,
  createdAt: 1,
}

function renderPanel(over: Partial<RepeatSessionApi> = {}) {
  const a = api(over)
  render(
    <SpeedRepeatPanel
      api={a}
      sentence={sentence}
      index={0}
      total={2}
      ttsState="idle"
      onPrev={vi.fn()}
      onNext={vi.fn()}
    />,
  )
  return a
}

describe('SpeedRepeatPanel：复读控制列', () => {
  it('标准音按钮走 playRef；播放中显示停止', () => {
    const a = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /标准音/ }))
    expect(a.playRef).toHaveBeenCalledWith()

    renderPanel({ playing: 'ref' })
    expect(screen.getAllByRole('button', { name: '■ 停止' }).length).toBeGreaterThan(0)
  })

  it('没录音时显示空提示，录音按钮走 toggleRecord', () => {
    const a = renderPanel()
    expect(screen.getByText('这一句还没有录音')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'A/B' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /● 录音/ }))
    expect(a.toggleRecord).toHaveBeenCalled()
  })

  it('录音中显示停止文案；低麦提示可见', () => {
    renderPanel({ recording: true, level: 0.2, lowMic: true })
    expect(screen.getByRole('button', { name: /停止录音/ })).toBeTruthy()
    expect(screen.getByText(/麦克风声音偏小/)).toBeTruthy()
  })

  it('有录音时显示时长；只有「录音」，没有重录 / A-B / 删除', () => {
    const a = renderPanel({ take })
    expect(screen.getByText(/2\.4s/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /▶ 我的/ }))
    expect(a.playTake).toHaveBeenCalledWith()

    expect(screen.getByRole('button', { name: '● 录音' })).toBeTruthy()
    expect(screen.queryByText(/重录/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'A/B' })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  })

  it('连续跟读开关与关闭复读', () => {
    const a = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /连续跟读/ }))
    expect(a.toggleCycle).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(a.exit).toHaveBeenCalled()

    renderPanel({ cycleOn: true, cycleLabel: '录音中，读完停一下' })
    expect(screen.getByRole('button', { name: /停止连续跟读/ })).toBeTruthy()
    expect(screen.getByText('录音中，读完停一下')).toBeTruthy()
  })

  it('错误信息可见', () => {
    renderPanel({ error: '麦克风没权限' })
    expect(screen.getByText('麦克风没权限')).toBeTruthy()
  })
})
