// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { INITIAL, type SessionState } from '../state/sessionConfig'

/**
 * 跟读页 `/` 的装配测试：store 用假的，只验「页面把状态摆出来 + 快捷键接到哪个动作」。
 * 会话状态机本身在 `state/session*.test.ts`，这里不重复测。
 */
const h = vi.hoisted(() => ({
  state: { status: 'empty' } as unknown as SessionState,
  calls: [] as string[],
  listeners: new Set<() => void>(),
}))

vi.mock('../state/session', async () => {
  const { INITIAL } = await import('../state/sessionConfig')
  h.state = { ...INITIAL }
  class FakeSessionStore {
    getState = () => h.state
    subscribe = (cb: () => void) => {
      h.listeners.add(cb)
      return () => h.listeners.delete(cb)
    }
    setHangoverMs = () => {}
    setTakeBoost = () => {}
    setMicOptions = () => {}
    load = () => h.calls.push('load')
    toggleChunkPlay = () => h.calls.push('play')
    toggleRecording = () => h.calls.push('record')
    next = () => h.calls.push('next')
    prev = () => h.calls.push('prev')
    compareAB = () => h.calls.push('compare')
    select = (i: number) => h.calls.push(`select:${i}`)
    dismissLowMic = () => {}
  }
  return { SessionStore: FakeSessionStore }
})

vi.mock('../adapters/browserAudio', () => ({
  BrowserPlayer: class {},
  BrowserRecorder: class {},
  // 设备枚举挂起：测试不关心它，异步 resolve 会触发 act 警告
  listAudioInputs: () => new Promise(() => {}),
}))

vi.mock('./FishLayer', () => ({ default: () => null }))

import App from './App'

const readyState = (): SessionState => ({
  ...INITIAL,
  status: 'ready',
  fileName: 'demo.mp3',
  duration: 12,
  chunks: [
    { index: 0, start: 0, end: 6 },
    { index: 1, start: 6, end: 12 },
  ],
  current: 1,
})

const renderApp = () =>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )

describe('跟读页 App', () => {
  beforeEach(() => {
    h.calls.length = 0
    h.state = { ...INITIAL }
    // jsdom 没有实现滚动；ChunkList 会把当前块滚进视口
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('空状态：显示选音频入口和备份条', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: '跟读练习' })).toBeTruthy()
    expect(screen.getByText('选择音频')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出备份' })).toBeTruthy()
  })

  it('就绪：显示文件名、块数和当前块', () => {
    h.state = readyState()
    const { container } = renderApp()
    expect(screen.getByText('demo.mp3')).toBeTruthy()
    expect(screen.getByText(/2 块 · 0:12/)).toBeTruthy()
    expect(container.querySelector('.big b')?.textContent).toBe('2')
  })

  it('点左侧块列表：把块号交给 store.select', () => {
    h.state = readyState()
    const { container } = renderApp()
    const rows = container.querySelectorAll('.list .row')
    expect(rows).toHaveLength(2)
    fireEvent.click(rows[0])
    expect(h.calls).toContain('select:0')
  })

  it('空格 / R / D 分别接到播放、录音、下一块', () => {
    h.state = readyState()
    renderApp()
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(window, { key: 'd' })
    expect(h.calls).toEqual(['play', 'record', 'next'])
  })

  it('焦点在输入框时不抢快捷键', () => {
    h.state = readyState()
    const { container } = renderApp()
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()
    fireEvent.keyDown(input!, { key: ' ' })
    expect(h.calls).toEqual([])
  })
})
